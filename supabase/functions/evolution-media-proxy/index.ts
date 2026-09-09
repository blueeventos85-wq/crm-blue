import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function binaryResponse(buffer: ArrayBuffer, contentType: string): Response {
  return new Response(buffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'public, max-age=31536000',
    }
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // ── 1. Ler parâmetros de GET (query) ou POST (body) ──
  const url = new URL(req.url)
  let mediaUrl = ''
  let anonKey = ''
  let messageId = ''
  let instanceName = ''
  let contentTypeParam = ''

  if (req.method === 'POST') {
    try {
      const body = await req.json()
      mediaUrl = body.mediaUrl || body.url || ''
      anonKey = body.key || body.anonKey || ''
      messageId = body.messageId || ''
      instanceName = body.instanceName || ''
      contentTypeParam = body.contentType || ''
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }
  } else {
    mediaUrl = url.searchParams.get('url') || url.searchParams.get('media_url') || ''
    anonKey = url.searchParams.get('key') || url.searchParams.get('anon_key') || ''
    messageId = url.searchParams.get('messageId') || ''
    instanceName = url.searchParams.get('instanceName') || ''
    contentTypeParam = url.searchParams.get('contentType') || ''
  }

  console.log('[media-proxy] === REQUISIÇÃO ===', req.method)
  console.log('[media-proxy] params:', {
    mediaUrl: mediaUrl ? mediaUrl.substring(0, 150) : '(none)',
    messageId: messageId || '(none)',
    instanceName: instanceName || '(none)',
    contentType: contentTypeParam || '(none)',
  })

  // ── 2. Autenticação ──
  let authOk = false
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = JSON.parse(atob(auth.split('.')[1]))
      if (payload.role === 'anon' || payload.role === 'authenticated') authOk = true
    } catch { /* invalid JWT */ }
  }
  if (!authOk && anonKey) {
    const envKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (envKey && anonKey === envKey) {
      authOk = true
    } else {
      try {
        const payload = JSON.parse(atob(anonKey.split('.')[1]))
        if (payload.role === 'anon' || payload.role === 'authenticated') authOk = true
      } catch { /* invalid JWT */ }
    }
  }
  if (!authOk) return jsonResponse({ error: 'Unauthorized' }, 401)

  // ── 3. Env vars ──
  const evoUrl = Deno.env.get('EVOLUTION_API_URL') || ''
  const evoKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
  if (!evoUrl || !evoKey) return jsonResponse({ error: 'EVOLUTION_API_URL/EVOLUTION_GLOBAL_API_KEY not set' }, 500)

  // Host da própria Evolution API
  let evoHost = ''
  try { evoHost = new URL(evoUrl).host } catch { /* ignore */ }

  // ── 4. Determinar se a URL é da Evolution API (busca direta) ou externa (fallback) ──
  const parsed = mediaUrl ? new URL(mediaUrl) : null
  const isEvoHost = parsed && evoHost && parsed.host === evoHost

  // Se messageId existe, SEMPRE usar fallback ( URLs de CDN do WhatsApp são temporárias )
  // Se messageId NÃO existe, tentar busca direta apenas se a URL é da própria Evolution API
  const shouldTryDirect = !messageId && isEvoHost

  if (mediaUrl && !isEvoHost) {
    console.log('[media-proxy] Host externo detectado (' + (parsed?.host || '?') + '), usando fallback via messageId')
  }

  // ── 5. Busca direta (apenas para URLs da Evolution API e sem messageId) ──
  if (shouldTryDirect && parsed) {
    console.log('[media-proxy] Busca direta via URL da Evolution API...')
    try {
      const mediaResp = await fetch(parsed.toString(), {
        headers: { 'apikey': evoKey },
        redirect: 'follow',
      })

      if (mediaResp.ok) {
        const mediaBuffer = await mediaResp.arrayBuffer().catch(() => null)
        if (mediaBuffer && mediaBuffer.byteLength > 0) {
          const ct = mediaResp.headers.get('content-type') || 'application/octet-stream'
          console.log('[media-proxy] SUCESSO (busca direta):', mediaBuffer.byteLength, 'bytes')
          return binaryResponse(mediaBuffer, ct)
        }
        console.log('[media-proxy] Busca direta retornou body vazio')
      } else {
        console.log('[media-proxy] Busca direta retornou', mediaResp.status)
      }
    } catch (e) {
      console.error('[media-proxy] Busca direta falhou:', e.message)
    }
    // Se chegou aqui, busca direta falhou — tentar fallback
  }

  // ── 6. Fallback: getBase64FromMediaMessage ──
  if (!messageId) {
    return jsonResponse({
      error: 'No media available',
      hint: 'Provide messageId for fallback, or a URL from the Evolution API host',
    }, 404)
  }

  // Resolver instanceName
  if (!instanceName && supabaseUrl && serviceKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('provider_config')
        .eq('provider', 'evolution_api')
        .limit(1)
        .single()

      if (config?.provider_config?.instanceName) {
        instanceName = config.provider_config.instanceName
        console.log('[media-proxy] instanceName via DB:', instanceName)
      }
    } catch (e) {
      console.error('[media-proxy] Erro ao buscar instanceName:', e.message)
    }
  }

  if (!instanceName) {
    return jsonResponse({
      error: 'Could not determine instanceName for fallback',
      hint: 'Pass instanceName parameter or ensure whatsapp_config has an instance',
    }, 400)
  }

  const fallbackUrl = `${evoUrl}/chat/getBase64FromMediaMessage/${instanceName}`
  console.log('[media-proxy] Fallback:', fallbackUrl, '| messageId:', messageId)

  try {
    const fallbackResp = await fetch(fallbackUrl, {
      method: 'POST',
      headers: {
        'apikey': evoKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          key: {
            id: messageId
          }
        }
      }),
      redirect: 'follow',
    })

    console.log('[media-proxy] Fallback status:', fallbackResp.status)

    if (!fallbackResp.ok) {
      const errBody = await fallbackResp.text().catch(() => '')
      console.error('[media-proxy] Fallback retornou erro:', fallbackResp.status, errBody.substring(0, 300))
      return jsonResponse({
        error: `getBase64FromMediaMessage returned ${fallbackResp.status}`,
        detail: errBody.substring(0, 300),
      }, 404)
    }

    const fallbackData = await fallbackResp.json()
    console.log('[media-proxy] Fallback response keys:', Object.keys(fallbackData))

    // Extrair base64 de多种 formatos de resposta
    let base64Raw = ''
    if (fallbackData.base64) {
      base64Raw = fallbackData.base64
    } else if (fallbackData.data?.base64) {
      base64Raw = fallbackData.data.base64
    } else if (typeof fallbackData === 'string') {
      base64Raw = fallbackData
    }

    if (!base64Raw) {
      console.error('[media-proxy] Fallback não retornou base64:', JSON.stringify(fallbackData).substring(0, 300))
      return jsonResponse({
        error: 'getBase64FromMediaMessage did not return base64 data',
        response: JSON.stringify(fallbackData).substring(0, 300),
      }, 404)
    }

    // Converter para binário e retornar
    if (base64Raw.startsWith('data:')) {
      const mimeMatch = base64Raw.match(/^data:([^;]+);base64,(.+)$/)
      if (mimeMatch) {
        const mime = mimeMatch[1]
        const b64 = mimeMatch[2]
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        console.log('[media-proxy] SUCESSO (data URI):', bin.byteLength, 'bytes', mime)
        return binaryResponse(bin.buffer, mime)
      }
      return jsonResponse({ dataUri: base64Raw }, 200)
    }

    // Base64 puro
    const mime = contentTypeParam.startsWith('image') ? 'image/jpeg'
      : contentTypeParam.startsWith('audio') ? 'audio/ogg'
      : contentTypeParam.startsWith('video') ? 'video/mp4'
      : 'application/octet-stream'
    const bin = Uint8Array.from(atob(base64Raw), c => c.charCodeAt(0))
    console.log('[media-proxy] SUCESSO (base64):', bin.byteLength, 'bytes', mime)
    return binaryResponse(bin.buffer, mime)

  } catch (e) {
    console.error('[media-proxy] Fallback exception:', e.message)
    return jsonResponse({ error: 'Fallback failed: ' + e.message }, 500)
  }
})

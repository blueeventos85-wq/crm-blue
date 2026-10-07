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
    // Erros/expirações NUNCA podem ficar no cache do navegador: senão uma
    // mídia indisponível volta a falhar mesmo depois de voltar a existir.
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

function binaryResponse(buffer: ArrayBuffer, contentType: string): Response {
  return new Response(buffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      // URL estável (messageId) → o navegador guarda os bytes e re-render
      // não baixa de novo
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
  })
}

// Teto do cache em Storage (vídeo do WhatsApp: 64MB; teto do app: 500MB)
const MAX_CACHE_BYTES = 200 * 1024 * 1024

// Chave determinística do objeto cacheado — SEM expor URL/token nos logs
function cacheKeyFor(messageId: string, mediaUrl: string): string {
  if (messageId) return ('msg-' + messageId).replace(/[^\w.-]/g, '_').slice(0, 120)
  let h = 0x811c9dc5
  for (let i = 0; i < mediaUrl.length; i++) {
    h ^= mediaUrl.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'url-' + (h >>> 0).toString(36)
}

function mimeFrom(contentTypeParam: string, fallback = 'application/octet-stream'): string {
  if (contentTypeParam.startsWith('image')) return 'image/jpeg'
  if (contentTypeParam.startsWith('audio')) return 'audio/ogg'
  if (contentTypeParam.startsWith('video')) return 'video/mp4'
  if (contentTypeParam.startsWith('application')) return contentTypeParam
  return fallback
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

  // Log enxuto e sem URLs assinadas/links do CDN (podem conter token)
  console.log('[media-proxy]', req.method, 'msg:', messageId ? 'sim' : 'não', 'url:', mediaUrl ? 'sim' : 'não', 'tipo:', contentTypeParam || '-')

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
  const bucket = Deno.env.get('MEDIA_BUCKET') || 'chat-media'
  if (!evoUrl || !evoKey) return jsonResponse({ error: 'EVOLUTION_API_URL/EVOLUTION_GLOBAL_API_KEY not set' }, 500)

  const supabase = (supabaseUrl && serviceKey)
    ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null

  // Host da própria Evolution API
  let evoHost = ''
  try { evoHost = new URL(evoUrl).host } catch { /* ignore */ }

  // ── 4. Cache em Storage (chat-media/received/<messageId>) ──
  // A mesma mídia é pedida a cada re-render e a cada troca de conversa; depois
  // do primeiro download ela sai do Storage e nunca mais paga o
  // getBase64FromMediaMessage (medido: 0,3–0,5s por imagem). Toda falha de
  // cache é best-effort: derruba o cache, nunca o fluxo de envio/resposta.
  const cacheName = cacheKeyFor(messageId, mediaUrl)
  const cachePath = `received/${cacheName}`

  if (supabase) {
    let cacheHit = false
    try {
      // supabase-js não expõe "stat" → list com busca por prefixo
      const { data: rows } = await supabase.storage.from(bucket).list('received', { search: cacheName, limit: 5 })
      cacheHit = (rows || []).some(r => r.name === cacheName)
    } catch { cacheHit = false }

    if (cacheHit) {
      try {
        const { data: cachedFile, error: readErr } = await supabase.storage.from(bucket).download(cachePath)
        if (!readErr && cachedFile && cachedFile.size > 0) {
          const buf = await cachedFile.arrayBuffer()
          console.log('[media-proxy] cache hit:', buf.byteLength, 'bytes')
          return binaryResponse(buf, cachedFile.type || mimeFrom(contentTypeParam))
        }
        if (readErr) console.warn('[media-proxy] cache read:', readErr.message)
      } catch (e) {
        console.warn('[media-proxy] cache read exception:', e.message)
      }
    }
  }

  // Responde binário gravando-o no cache (best effort) antes de sair
  const respondMedia = async (buffer: ArrayBuffer, mime: string): Promise<Response> => {
    if (supabase && buffer.byteLength > 0 && buffer.byteLength <= MAX_CACHE_BYTES) {
      try {
        const { error: upErr } = await supabase.storage.from(bucket).upload(cachePath, buffer, {
          contentType: mime,
          upsert: true,
          cacheControl: '31536000'
        })
        if (upErr) console.warn('[media-proxy] cache write:', upErr.message)
      } catch (e) {
        console.warn('[media-proxy] cache write exception:', e.message)
      }
    }
    return binaryResponse(buffer, mime)
  }

  // ── 4. Determinar se a URL é da Evolution API (busca direta) ou externa (fallback) ──
  const parsed = mediaUrl ? new URL(mediaUrl) : null
  const isEvoHost = parsed && evoHost && parsed.host === evoHost

  // Se messageId existe, SEMPRE usar fallback ( URLs de CDN do WhatsApp são temporárias )
  // Se messageId NÃO existe, tentar busca direta apenas se a URL é da própria Evolution API
  const shouldTryDirect = !messageId && isEvoHost

  // ── 6. Busca direta (apenas para URLs da Evolution API e sem messageId) ──
  if (shouldTryDirect && parsed) {
    try {
      const mediaResp = await fetch(parsed.toString(), {
        headers: { 'apikey': evoKey },
        redirect: 'follow',
      })

      if (mediaResp.ok) {
        const mediaBuffer = await mediaResp.arrayBuffer().catch(() => null)
        if (mediaBuffer && mediaBuffer.byteLength > 0) {
          const ct = mediaResp.headers.get('content-type') || mimeFrom(contentTypeParam)
          console.log('[media-proxy] busca direta:', mediaBuffer.byteLength, 'bytes')
          return await respondMedia(mediaBuffer, ct)
        }
      } else {
        console.log('[media-proxy] busca direta status:', mediaResp.status)
      }
    } catch (e) {
      console.error('[media-proxy] busca direta falhou:', e.message)
    }
    // Se chegou aqui, busca direta falhou — tentar fallback
  }

  // ── 7. Fallback: getBase64FromMediaMessage ──
  if (!messageId) {
    return jsonResponse({
      error: 'No media available',
      hint: 'Provide messageId for fallback, or a URL from the Evolution API host',
    }, 404)
  }

  // Resolver instanceName
  if (!instanceName && supabase) {
    try {
      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('provider_config')
        .eq('provider', 'evolution_api')
        .limit(1)
        .single()

      if (config?.provider_config?.instanceName) {
        instanceName = config.provider_config.instanceName
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
  console.log('[media-proxy] fallback via getBase64FromMediaMessage')

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

    if (!fallbackResp.ok) {
      const errBody = await fallbackResp.text().catch(() => '')
      console.error('[media-proxy] fallback status:', fallbackResp.status, errBody.substring(0, 200))
      return jsonResponse({
        error: `getBase64FromMediaMessage returned ${fallbackResp.status}`,
      }, 404)
    }

    const fallbackData = await fallbackResp.json()

    // Extrair base64 de vários formatos de resposta
    let base64Raw = ''
    if (fallbackData.base64) {
      base64Raw = fallbackData.base64
    } else if (fallbackData.data?.base64) {
      base64Raw = fallbackData.data.base64
    } else if (typeof fallbackData === 'string') {
      base64Raw = fallbackData
    }

    if (!base64Raw) {
      console.error('[media-proxy] fallback sem base64 — chaves:', Object.keys(fallbackData || {}).join(','))
      return jsonResponse({
        error: 'getBase64FromMediaMessage did not return base64 data',
      }, 404)
    }

    // Converter para binário e retornar
    if (base64Raw.startsWith('data:')) {
      const mimeMatch = base64Raw.match(/^data:([^;]+);base64,(.+)$/)
      if (mimeMatch) {
        const mime = mimeMatch[1]
        const bin = Uint8Array.from(atob(mimeMatch[2]), c => c.charCodeAt(0))
        console.log('[media-proxy] fallback ok (data URI):', bin.byteLength, 'bytes')
        return await respondMedia(bin.buffer, mime)
      }
      return jsonResponse({ dataUri: base64Raw }, 200)
    }

    // Base64 puro
    const mime = mimeFrom(contentTypeParam)
    const bin = Uint8Array.from(atob(base64Raw), c => c.charCodeAt(0))
    console.log('[media-proxy] fallback ok (base64):', bin.byteLength, 'bytes')
    return await respondMedia(bin.buffer, mime)

  } catch (e) {
    console.error('[media-proxy] fallback exception:', e.message)
    return jsonResponse({ error: 'Fallback failed: ' + e.message }, 500)
  }
})

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── 1. Parse do body ──
  let membroId: string | null = null
  let centrosCustoId: string | null = null
  let instanceName = ''
  let qrcode = true
  let integration = 'WHATSAPP-BAILEYS'

  try {
    const body = await req.json()
    membroId = body.membroId || null
    centrosCustoId = body.centrosCustoId || null
    instanceName = body.instanceName || ''
    qrcode = body.qrcode !== false
    integration = body.integration || 'WHATSAPP-BAILEYS'
  } catch {
    return jsonResp({ error: 'Corpo da requisição inválido (JSON esperado)', success: false }, 400)
  }

  if (!instanceName) {
    return jsonResp({ error: 'instanceName é obrigatório', success: false }, 400)
  }
  if (!membroId && !centrosCustoId) {
    return jsonResp({ error: 'membroId ou centrosCustoId é obrigatório', success: false }, 400)
  }

  // ── 2. Variáveis de ambiente ──
  const apiUrl = Deno.env.get('EVOLUTION_API_URL')
  const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')

  if (!apiUrl || !apiKey) {
    return jsonResp({
      error: 'Variáveis EVOLUTION_API_URL e EVOLUTION_GLOBAL_API_KEY não configuradas no servidor',
      success: false
    }, 500)
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResp({
      error: 'Variáveis SUPABASE_URL e SERVICE_ROLE_KEY não configuradas no servidor',
      success: false
    }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // ── 3. Verificar se instância já existe ──
  let configId: string | null = null
  let instanceExists = false

  try {
    let existingQuery = supabase
      .from('whatsapp_config')
      .select('id, provider_config, status')
      .eq('provider', 'evolution_api')

    if (centrosCustoId) {
      existingQuery = existingQuery.eq('centros_custo_id', centrosCustoId)
    } else if (membroId) {
      existingQuery = existingQuery.eq('membro_id', membroId)
    }

    const { data: existingConfig, error: cfgErr } = await existingQuery.maybeSingle()

    if (cfgErr) {
      console.error('[connect] Erro ao buscar config:', cfgErr.message)
    }

    if (existingConfig) {
      configId = existingConfig.id
      const pcfg = existingConfig.provider_config || {}
      if (pcfg.instanceName === instanceName) {
        instanceExists = true
      }
    }
  } catch (err) {
    console.error('[connect] Erro ao verificar config existente:', err)
    // Continuar mesmo assim — pode ser uma instância nova
  }

  // ── 4. Criar instância na Evolution API (se não existir) ──
  if (!instanceExists) {
    console.log('[connect] Criando instância:', instanceName)

    try {
      const createResponse = await fetch(`${apiUrl}/instance/create`, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instanceName,
          integration,
          qrcode,
          reject_call: false,
          always_online: true,
          webhook: {
            enabled: true,
            url: `${supabaseUrl}/functions/v1/evolution-webhook`,
            byEvents: false,
            base64: false,
            events: [
              'QRCODE_UPDATED',
              'CONNECTION_UPDATE',
              'MESSAGES_UPSERT',
              'SEND_MESSAGE'
            ]
          }
        })
      })

      if (!createResponse.ok) {
        const errText = await createResponse.text().catch(() => 'Erro desconhecido')
        console.error('[connect] Erro ao criar instância:', createResponse.status, errText)
        return jsonResp({
          error: `Falha ao criar instância na Evolution API (HTTP ${createResponse.status}): ${errText}`,
          success: false
        }, 502)
      }

      const createData = await createResponse.json().catch(() => ({}))
      console.log('[connect] Instância criada:', JSON.stringify(createData).substring(0, 200))

      // Salvar ou atualizar config no banco
      const providerConfig = {
        instanceName,
        instanceId: createData.instance?.instanceId || '',
        integration,
        owner: createData.instance?.owner || ''
      }

      try {
        if (configId) {
          await supabase
            .from('whatsapp_config')
            .update({
              provider_config: providerConfig,
              status: 'connecting',
              updated_at: new Date().toISOString()
            })
            .eq('id', configId)
        } else {
          const insertPayload: Record<string, unknown> = {
            provider: 'evolution_api',
            provider_config: providerConfig,
            status: 'connecting',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
          if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
          if (membroId) insertPayload.membro_id = membroId

          const { data: newConfig } = await supabase
            .from('whatsapp_config')
            .insert([insertPayload])
            .select('id')
            .single()

          configId = newConfig?.id || null
        }
      } catch (dbErr) {
        console.error('[connect] Erro ao salvar config no banco:', dbErr)
        // Não retornar erro — a instância foi criada com sucesso na Evolution API
      }

    } catch (fetchErr) {
      console.error('[connect] Erro de conexão com Evolution API:', fetchErr)
      return jsonResp({
        error: `Não foi possível conectar à Evolution API: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        success: false
      }, 502)
    }
  }

  // ── 5. Buscar QR Code ──
  console.log('[connect] Buscando QR Code para:', instanceName)

  try {
    const qrResponse = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: { 'apikey': apiKey }
    })

    if (!qrResponse.ok) {
      const errText = await qrResponse.text().catch(() => 'Erro desconhecido')
      console.error('[connect] Erro ao buscar QR Code:', qrResponse.status, errText)
      // Instância existe mas QR ainda não disponível — retornar sucesso parcial
      return jsonResp({
        success: true,
        configId,
        instanceName,
        message: 'Instância configurada, aguardando QR Code ficar disponível',
        qr: null
      })
    }

    let qrData: unknown
    try {
      qrData = await qrResponse.json()
    } catch {
      // Resposta pode ser texto puro (base64)
      const text = await qrResponse.text().catch(() => '')
      qrData = text
    }

    console.log('[connect] QR Code raw:', JSON.stringify(qrData).substring(0, 200))

    // Extrair QR Code do formato da resposta (pode variar conforme versão da API)
    let qrBase64: string | null = null

    if (typeof qrData === 'string') {
      qrBase64 = qrData
    } else if (qrData && typeof qrData === 'object') {
      const d = qrData as Record<string, unknown>
      const dataNested = d.data as Record<string, unknown> | undefined
      if (typeof d.base64 === 'string') qrBase64 = d.base64
      else if (typeof d.qrcode === 'string') qrBase64 = d.qrcode
      else if (dataNested && typeof dataNested.base64 === 'string') qrBase64 = dataNested.base64
      else if (dataNested && typeof dataNested.qrcode === 'string') qrBase64 = dataNested.qrcode
    }

    // Garantir que o prefixo data:image exista
    if (qrBase64 && !qrBase64.startsWith('data:')) {
      qrBase64 = 'data:image/png;base64,' + qrBase64
    }

    console.log('[connect] QR Code extraído:', qrBase64 ? qrBase64.substring(0, 50) + '...' : 'null')

    const pairingCode = (qrData && typeof qrData === 'object')
      ? ((qrData as Record<string, unknown>).pairingCode ||
         ((qrData as Record<string, unknown>).data as Record<string, unknown>)?.pairingCode || null)
      : null

    return jsonResp({
      success: true,
      configId,
      instanceName,
      qr: qrBase64,
      pairingCode
    })

  } catch (qrErr) {
    console.error('[connect] Erro ao buscar QR Code:', qrErr)
    return jsonResp({
      success: true,
      configId,
      instanceName,
      message: 'Instância configurada, mas falha ao buscar QR Code',
      qr: null
    })
  }
})

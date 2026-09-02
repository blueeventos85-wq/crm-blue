import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { membroId, centrosCustoId, instanceName, qrcode = true, integration = 'WHATSAPP-BAILEYS' } = await req.json()

    if (!instanceName) {
      return new Response(JSON.stringify({ error: 'instanceName é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!membroId && !centrosCustoId) {
      return new Response(JSON.stringify({ error: 'membroId ou centrosCustoId é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const apiUrl = Deno.env.get('EVOLUTION_API_URL')!
    const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY')!

    if (!apiUrl || !apiKey) {
      return new Response(JSON.stringify({ error: 'EVOLUTION_API_URL e EVOLUTION_GLOBAL_API_KEY devem estar configuradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // 1. Verificar se instância já existe
    let existingQuery = supabase
      .from('whatsapp_config')
      .select('id, provider_config, status')
      .eq('provider', 'evolution_api')

    if (centrosCustoId) {
      existingQuery = existingQuery.eq('centros_custo_id', centrosCustoId)
    } else if (membroId) {
      existingQuery = existingQuery.eq('membro_id', membroId)
    }

    const { data: existingConfig } = await existingQuery.single()

    let instanceExists = false
    let configId = existingConfig?.id || null

    if (existingConfig) {
      const pcfg = existingConfig.provider_config || {}
      if (pcfg.instanceName === instanceName) {
        instanceExists = true
      }
    }

    // 2. Criar instância na Evolution API (se não existir)
    if (!instanceExists) {
      console.log('[connect] Criando instância:', instanceName)

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
            url: 'https://wozwysgubvqxczyjrmtn.supabase.co/functions/v1/evolution-webhook',
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
        const errText = await createResponse.text()
        console.error('[connect] Erro ao criar instância:', errText)
        return new Response(JSON.stringify({ error: `Erro ao criar instância: ${errText}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const createData = await createResponse.json()
      console.log('[connect] Instância criada:', createData)

      // Salvar ou atualizar config no banco
      const providerConfig = {
        instanceName,
        instanceId: createData.instance?.instanceId || '',
        integration,
        owner: createData.instance?.owner || ''
      }

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
        const insertPayload: Record<string, any> = {
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

        configId = newConfig?.id
      }
    }

    // 3. Buscar QR Code
    console.log('[connect] Buscando QR Code para:', instanceName)

    const qrResponse = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: {
        'apikey': apiKey
      }
    })

    if (!qrResponse.ok) {
      const errText = await qrResponse.text()
      console.error('[connect] Erro ao buscar QR Code:', errText)
      return new Response(JSON.stringify({
        success: true,
        configId,
        message: 'Instância criada, aguardando QR Code',
        qr: null
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const qrData = await qrResponse.json()
    console.log('[connect] QR Code raw:', JSON.stringify(qrData).substring(0, 200))

    // Extrair QR Code do formato da resposta (pode variar conforme versão da API)
    let qrBase64 = null
    if (typeof qrData === 'string') {
      qrBase64 = qrData
    } else if (qrData.base64) {
      qrBase64 = qrData.base64
    } else if (qrData.qrcode) {
      qrBase64 = qrData.qrcode
    } else if (qrData.data && qrData.data.base64) {
      qrBase64 = qrData.data.base64
    } else if (qrData.data && qrData.data.qrcode) {
      qrBase64 = qrData.data.qrcode
    }

    // Garantir que o prefixo data:image exista
    if (qrBase64 && !qrBase64.startsWith('data:')) {
      qrBase64 = 'data:image/png;base64,' + qrBase64
    }

    console.log('[connect] QR Code extraído:', qrBase64 ? qrBase64.substring(0, 50) + '...' : 'null')

    return new Response(JSON.stringify({
      success: true,
      configId,
      instanceName,
      qr: qrBase64,
      pairingCode: qrData.pairingCode || qrData.data?.pairingCode || null
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[connect] Erro:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

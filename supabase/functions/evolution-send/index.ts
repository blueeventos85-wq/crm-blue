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
    const { membroId, conversationId, contentText, mediaUrl, contentType = 'text', centrosCustoId, number: payloadNumber, instanceName: payloadInstanceName } = await req.json()

    console.log('[send] Payload recebido:', { membroId, conversationId, contentType, centrosCustoId, payloadNumber, payloadInstanceName })

    if (!membroId || !conversationId || (!contentText && !mediaUrl)) {
      return new Response(JSON.stringify({ error: 'membroId, conversationId e conteúdo são obrigatórios' }), {
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

    // 1. Buscar conversa
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, centros_custo_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (convError) {
      console.error('[send] Erro ao buscar conversa:', convError)
    }

    if (!conversation) {
      return new Response(JSON.stringify({ error: 'Conversa não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[send] Conversa encontrada:', { id: conversation.id, ccId: conversation.centros_custo_id, contactId: conversation.contact_id })

    // 2. Buscar contato separadamente
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', conversation.contact_id)
      .maybeSingle()

    if (contactError) {
      console.error('[send] Erro ao buscar contato:', contactError)
    }

    const phone = payloadNumber || contact?.phone
    if (!phone) {
      return new Response(JSON.stringify({ error: 'Telefone do contato não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[send] Telefone do contato:', phone)

    // 3. Buscar instância do WhatsApp
    const effectiveCCId = centrosCustoId || conversation.centros_custo_id

    let configQuery = supabase
      .from('whatsapp_config')
      .select('id, provider_config, status, centros_custo_id, membro_id')
      .eq('provider', 'evolution_api')
      .eq('status', 'connected')

    if (effectiveCCId) {
      configQuery = configQuery.eq('centros_custo_id', effectiveCCId)
    } else {
      configQuery = configQuery.eq('membro_id', membroId)
    }

    const { data: config, error: configError } = await configQuery.maybeSingle()

    if (configError) {
      console.error('[send] Erro ao buscar config:', configError)
    }

    if (!config) {
      console.error('[send] Config não encontrada. effectiveCCId:', effectiveCCId, 'membroId:', membroId)
      return new Response(JSON.stringify({ error: 'WhatsApp não conectado para este centro de custo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const instanceName = payloadInstanceName || config?.provider_config?.instanceName
    if (!instanceName) {
      console.error('[send] instanceName não encontrado. payload:', payloadInstanceName, 'config:', config?.provider_config)
      return new Response(JSON.stringify({ error: 'InstanceName não encontrado na config' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[send] Config encontrada. instanceName:', instanceName)

    // 4. Enviar mensagem via Evolution API
    const jid = `${phone}@s.whatsapp.net`
    let apiUrlEndpoint = ''
    let payload: Record<string, any> = {}

    if (contentType === 'text' || !mediaUrl) {
      apiUrlEndpoint = `${apiUrl}/message/sendText/${instanceName}`
      payload = {
        number: jid,
        text: contentText || ''
      }
    } else if (contentType === 'image') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${instanceName}`
      payload = {
        number: jid,
        mediatype: 'image',
        media: mediaUrl,
        caption: contentText || ''
      }
    } else if (contentType === 'video') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${instanceName}`
      payload = {
        number: jid,
        mediatype: 'video',
        media: mediaUrl,
        caption: contentText || ''
      }
    } else if (contentType === 'audio') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${instanceName}`
      payload = {
        number: jid,
        mediatype: 'audio',
        media: mediaUrl
      }
    } else if (contentType === 'document') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${instanceName}`
      payload = {
        number: jid,
        mediatype: 'document',
        media: mediaUrl,
        fileName: contentText || 'documento'
      }
    } else {
      apiUrlEndpoint = `${apiUrl}/message/sendText/${instanceName}`
      payload = {
        number: jid,
        text: contentText || ''
      }
    }

    console.log('[send] Enviando para Evolution API:', { endpoint: apiUrlEndpoint, number: jid, type: contentType })

    const sendResponse = await fetch(apiUrlEndpoint, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const errText = await sendResponse.text()
    console.log('[send] Resposta Evolution API:', { status: sendResponse.status, body: errText })

    if (!sendResponse.ok) {
      return new Response(JSON.stringify({ error: `Erro ao enviar: ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let sendData
    try { sendData = JSON.parse(errText) } catch { sendData = {} }
    const externalMsgId = sendData.key?.id || sendData.id || ''

    // 5. Salvar mensagem no banco
    const { data: savedMsg, error: msgError } = await supabase
      .from('messages')
      .insert([{
        conversation_id: conversationId,
        membro_id: membroId,
        sender_type: 'member',
        content_type: contentType,
        content_text: contentText || '',
        media_url: mediaUrl || '',
        message_id: externalMsgId,
        status: 'sent',
        created_at: new Date().toISOString()
      }])
      .select('id')
      .single()

    if (msgError) {
      console.error('[send] Erro ao salvar mensagem:', msgError)
    }

    console.log('[send] Mensagem enviada e salva:', { conversationId, phone, contentType })

    return new Response(JSON.stringify({
      success: true,
      messageId: savedMsg?.id,
      externalMessageId: externalMsgId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[send] Erro geral:', err.message, err.stack)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function cleanBase64(data: string): string {
  if (!data) return ''
  if (data.includes(';base64,')) {
    return data.split(';base64,')[1]
  }
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { membroId, conversationId, contentText, mediaUrl, contentType = 'text', centrosCustoId, number: payloadNumber, instanceName: payloadInstanceName, ptt = false, mimeType, fileName, quoted = null, replyMeta = null } = body

    console.log('[send] Payload recebido:', {
      membroId,
      conversationId,
      contentType,
      centrosCustoId,
      payloadNumber: payloadNumber || '(none)',
      payloadInstanceName: payloadInstanceName || '(none)',
      ptt,
      mediaUrlSize: mediaUrl ? `${Math.round(mediaUrl.length / 1024)}KB` : '(none)',
      mediaUrlPrefix: mediaUrl ? mediaUrl.substring(0, 40) : '(none)',
      quoted: quoted ? (quoted.key?.id || '(sem id)') : '(none)'
    })

    if (!membroId || !conversationId || (!contentText && !mediaUrl)) {
      console.error('[send] Validação falhou: membroId:', !!membroId, 'conversationId:', !!conversationId, 'contentText:', !!contentText, 'mediaUrl:', !!mediaUrl)
      return new Response(JSON.stringify({ error: 'membroId, conversationId e conteúdo são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const apiUrl = Deno.env.get('EVOLUTION_API_URL') || ''
    const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') || ''

    console.log('[send] Env vars:', { apiUrl: apiUrl ? apiUrl.substring(0, 50) : '(empty)', apiKey: apiKey ? 'SET' : '(empty)' })

    if (!apiUrl || !apiKey) {
      console.error('[send] Variáveis de ambiente não configuradas')
      return new Response(JSON.stringify({ error: 'EVOLUTION_API_URL e EVOLUTION_GLOBAL_API_KEY devem estar configuradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[send] SUPABASE_URL ou SERVICE_ROLE_KEY não configuradas')
      return new Response(JSON.stringify({ error: 'Variáveis SUPABASE não configuradas' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // 1. Buscar conversa
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, centros_custo_id, group_jid, group_name')
      .eq('id', conversationId)
      .maybeSingle()

    if (convError) {
      console.error('[send] Erro ao buscar conversa:', convError)
    }

    if (!conversation) {
      console.error('[send] Conversa não encontrada:', conversationId)
      return new Response(JSON.stringify({ error: 'Conversa não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[send] Conversa:', { id: conversation.id, ccId: conversation.centros_custo_id, contactId: conversation.contact_id })

    // 2. Buscar contato
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, phone, is_group, group_jid')
      .eq('id', conversation.contact_id)
      .maybeSingle()

    if (contactError) {
      console.error('[send] Erro ao buscar contato:', contactError)
    }

    // 2b. Grupo (JID @g.us) NÃO passa pela sanitização numérica 55+DDD —
    // o JID completo é enviado direto para a Evolution API.
    const isGroupJid = (s: string) => /@g\.us\b/i.test(s)
    const rawNumber = String(payloadNumber || '').trim()
    const rawContactPhone = String(contact?.phone || '').trim()
    const isGroup =
      contact?.is_group === true ||
      !!conversation.group_jid ||
      isGroupJid(rawNumber) ||
      isGroupJid(rawContactPhone)

    let phone: string
    if (isGroup) {
      let jid =
        (isGroupJid(rawNumber) ? rawNumber : '') ||
        String(conversation.group_jid || '').trim() ||
        String(contact?.group_jid || '').trim() ||
        (isGroupJid(rawContactPhone) ? rawContactPhone : '')
      if (jid && !jid.includes('@')) jid = `${jid}@g.us`
      if (!jid) {
        console.error('[send] group_jid não encontrado. conversation:', conversation, 'contact:', contact)
        return new Response(JSON.stringify({ error: 'group_jid não encontrado para esta conversa de grupo' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      phone = jid
      console.log('[send] Grupo detectado — remoteJid:', phone, '| group_name:', conversation.group_name)
    } else {
      phone = (rawNumber || rawContactPhone).replace(/\D/g, '')
      if (!phone) {
        console.error('[send] Telefone não encontrado. payloadNumber:', payloadNumber, 'contact.phone:', contact?.phone)
        return new Response(JSON.stringify({ error: 'Telefone do contato não encontrado' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    console.log('[send] Destinatário:', phone, isGroup ? '(grupo)' : '(individual)')

    // 3. Buscar config WhatsApp
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
      console.error('[send] Config não encontrada. ccId:', effectiveCCId, 'membroId:', membroId)
      return new Response(JSON.stringify({ error: 'WhatsApp não conectado para este centro de custo' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const instanceName = payloadInstanceName || config?.provider_config?.instanceName
    if (!instanceName) {
      console.error('[send] instanceName não encontrado. payload:', payloadInstanceName, 'provider_config:', config?.provider_config)
      return new Response(JSON.stringify({ error: 'InstanceName não encontrado na config' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[send] instanceName:', instanceName)
    // Instâncias podem conter espaços/caracteres especiais (ex: "crm Pedro") —
    // codificar garante URL válida sem depender do auto-encode do fetch.
    const encInstance = encodeURIComponent(instanceName)

    // 4. Montar payload para Evolution API
    let apiUrlEndpoint = ''
    let payload: Record<string, any> = {}

    if (contentType === 'text' || !mediaUrl) {
      apiUrlEndpoint = `${apiUrl}/message/sendText/${encInstance}`
      payload = {
        number: phone,
        text: contentText || ''
      }
    } else if (contentType === 'audio' || ptt) {
      apiUrlEndpoint = `${apiUrl}/message/sendWhatsAppAudio/${encInstance}`
      payload = {
        number: phone,
        audio: cleanBase64(mediaUrl)
      }
    } else if (contentType === 'image') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${encInstance}`
      payload = {
        number: phone,
        mediatype: 'image',
        mimetype: mimeType || 'image/jpeg',
        media: cleanBase64(mediaUrl),
        caption: contentText || ''
      }
    } else if (contentType === 'video') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${encInstance}`
      payload = {
        number: phone,
        mediatype: 'video',
        mimetype: mimeType || 'video/mp4',
        media: cleanBase64(mediaUrl),
        caption: contentText || ''
      }
    } else if (contentType === 'document') {
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${encInstance}`
      payload = {
        number: phone,
        mediatype: 'document',
        mimetype: mimeType || 'application/pdf',
        media: cleanBase64(mediaUrl),
        fileName: fileName || contentText || 'documento'
      }
    } else {
      apiUrlEndpoint = `${apiUrl}/message/sendText/${encInstance}`
      payload = {
        number: phone,
        text: contentText || ''
      }
    }

    // 4b. Resposta encadeada (quoted reply) — padrão Evolution API v2.3.7.
    // Aceito em sendText, sendMedia e sendWhatsAppAudio.
    if (quoted && quoted.key?.id) {
      payload.quoted = quoted
    }

    // Log do payload (truncar media para não explodir o console)
    const logPayload = { ...payload }
    if (logPayload.media && logPayload.media.length > 100) {
      logPayload.media = logPayload.media.substring(0, 60) + `... (${Math.round(logPayload.media.length / 1024)}KB)`
    }
    console.log('[send] → Evolution API:', { endpoint: apiUrlEndpoint, payload: logPayload })

    // 5. Chamar Evolution API
    let sendResponse: Response
    try {
      sendResponse = await fetch(apiUrlEndpoint, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (fetchErr) {
      console.error('[send] Fetch exception:', fetchErr)
      return new Response(JSON.stringify({
        error: 'Falha ao conectar com Evolution API',
        details: fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fallback: se sendWhatsAppAudio retornou 404, tentar via sendMedia
    if (!sendResponse.ok && sendResponse.status === 404 && (contentType === 'audio' || ptt)) {
      console.log('[send] sendWhatsAppAudio retornou 404, tentando fallback via sendMedia')
      apiUrlEndpoint = `${apiUrl}/message/sendMedia/${encInstance}`
      payload = {
        number: phone,
        mediatype: 'audio',
        mimetype: mimeType || 'audio/ogg; codecs=opus',
        media: cleanBase64(mediaUrl),
        ptt: true
      }
      if (quoted && quoted.key?.id) {
        payload.quoted = quoted
      }
      try {
        sendResponse = await fetch(apiUrlEndpoint, {
          method: 'POST',
          headers: {
            'apikey': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })
      } catch (fetchErr) {
        console.error('[send] Fallback fetch exception:', fetchErr)
        return new Response(JSON.stringify({
          error: 'Falha ao conectar com Evolution API (fallback)',
          details: fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const evoResponseText = await sendResponse.text()
    console.log('[send] ← Evolution API:', {
      status: sendResponse.status,
      ok: sendResponse.ok,
      body: evoResponseText.substring(0, 500)
    })

    if (!sendResponse.ok) {
      console.error('[send] ✗ Evolution API erro:', sendResponse.status, evoResponseText)
      return new Response(JSON.stringify({
        error: 'Evolution API retornou erro',
        status: sendResponse.status,
        details: evoResponseText
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let sendData: Record<string, any>
    try { sendData = JSON.parse(evoResponseText) } catch { sendData = {} }
    const externalMsgId = sendData.key?.id || sendData.id || ''

    console.log('[send] ✓ Enviado. externalMsgId:', externalMsgId)

    // 6. Salvar mensagem no banco (protegido)
    const mimeTypes: Record<string, string> = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/ogg; codecs=opus',
      document: 'application/pdf'
    }

    try {
      const msgRow: Record<string, any> = {
        conversation_id: conversationId,
        membro_id: membroId,
        sender_type: 'member',
        content_type: contentType,
        content_text: contentText || '',
        media_url: mediaUrl || '',
        mime_type: mimeTypes[contentType] || null,
        message_id: externalMsgId,
        status: 'sent',
        created_at: new Date().toISOString()
      }

      // Persistir vínculo da resposta encadeada (quoted reply)
      const quotedMessageId = replyMeta?.message_id || quoted?.key?.id || null
      const quotedContent = replyMeta?.content || quoted?.message?.conversation || null
      const quotedSender = replyMeta?.sender || null
      if (quotedMessageId) msgRow.quoted_message_id = quotedMessageId
      if (quotedContent) msgRow.quoted_content = quotedContent
      if (quotedSender) msgRow.quoted_sender = quotedSender

      let { error: msgError } = await supabase
        .from('messages')
        .insert([msgRow])

      // Resiliência: migração quoted_* ainda não aplicada → não perder a mensagem
      if (msgError && /quoted_/.test(msgError.message || '')) {
        console.warn('[send] Colunas quoted_* indisponíveis — inserindo sem elas:', msgError.message)
        delete msgRow.quoted_message_id
        delete msgRow.quoted_content
        delete msgRow.quoted_sender
        ;({ error: msgError } = await supabase.from('messages').insert([msgRow]))
      }

      if (msgError) {
        console.error('[send] DB insert error (não crítico):', msgError)
      }
    } catch (dbErr) {
      console.error('[send] DB exception (não crítico):', dbErr)
    }

    return new Response(JSON.stringify({
      success: true,
      messageId: null,
      externalMessageId: externalMsgId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[send] ERRO GERAL:', err.message, err.stack)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

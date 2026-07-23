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
    const body = await req.json()
    console.log('[evolution-webhook] Payload recebido:', JSON.stringify(body).substring(0, 500))

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Extrair dados do webhook da Evolution API
    // Formato padrão: { event: 'messages.upsert', data: { key: { remoteJid, fromMe }, message: { ... }, pushName } }
    const event = body.event || ''

    if (event === 'messages.upsert') {
      const msgData = body.data || {}
      const key = msgData.key || {}
      const remoteJid = key.remoteJid || ''
      const fromMe = key.fromMe || false
      const pushName = msgData.pushName || ''
      const message = msgData.message || {}

      // Extrair texto da mensagem (suporta vários formatos da Evolution API)
      let content = ''
      if (message.conversation) {
        content = message.conversation
      } else if (message.extendedTextMessage && message.extendedTextMessage.text) {
        content = message.extendedTextMessage.text
      } else if (message.imageMessage && message.imageMessage.caption) {
        content = message.imageMessage.caption
      } else if (message.videoMessage && message.videoMessage.caption) {
        content = message.videoMessage.caption
      } else if (message.documentMessage && message.documentMessage.fileName) {
        content = `[Documento: ${message.documentMessage.fileName}]`
      } else if (message.audioMessage) {
        content = '[Áudio]'
      }

      if (!content && !remoteJid) {
        console.log('[evolution-webhook] Mensagem ignorada: sem conteúdo ou remoteJid')
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Limpar o número do remoteJid (remover @s.whatsapp.net etc)
      const phone = remoteJid.replace(/@.*$/, '')

      // Buscar chat existente pelo phone do contato
      const { data: existingChat, error: chatError } = await supabaseAdmin
        .from('chats')
        .select('id, tenant_id')
        .eq('contact_phone', phone)
        .single()

      let chatId = null
      let tenantId = null

      if (existingChat) {
        chatId = existingChat.id
        tenantId = existingChat.tenant_id
      } else {
        // Criar novo chat automaticamente
        const { data: newChat, error: newChatError } = await supabaseAdmin
          .from('chats')
          .insert([{
            contact_name: pushName || phone,
            contact_phone: phone,
            tenant_id: '00000000-0000-0000-0000-000000000000',
            status: 'open',
            last_message: content,
            last_message_at: new Date().toISOString()
          }])
          .select()
          .single()

        if (newChatError) {
          console.error('[evolution-webhook] Erro ao criar chat:', newChatError)
          return new Response(JSON.stringify({ error: newChatError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        chatId = newChat.id
        tenantId = newChat.tenant_id
      }

      // Inserir mensagem
      const { error: msgError } = await supabaseAdmin
        .from('messages')
        .insert([{
          chat_id: chatId,
          sender_type: fromMe ? 'agent' : 'lead',
          sender_name: fromMe ? 'Atendente' : (pushName || phone),
          content: content,
          status: 'delivered'
        }])

      if (msgError) {
        console.error('[evolution-webhook] Erro ao inserir mensagem:', msgError)
        return new Response(JSON.stringify({ error: msgError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Atualizar last_message e last_message_at no chat
      await supabaseAdmin
        .from('chats')
        .update({
          last_message: content,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', chatId)

      console.log('[evolution-webhook] Mensagem salva:', { chatId, phone, fromMe, content: content.substring(0, 50) })

      return new Response(JSON.stringify({ ok: true, chatId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Evento não reconhecido
    console.log('[evolution-webhook] Evento ignorado:', event)
    return new Response(JSON.stringify({ ok: true, event }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[evolution-webhook] Erro:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

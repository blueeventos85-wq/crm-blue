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
    console.log('[webhook] Event:', body.event, '| Instance:', body.instance)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const event = body.event || ''
    const instanceName = body.instance || ''

    // ── messages.upsert / MESSAGES_UPSERT: mensagem recebida ou enviada ──
    if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
      const msgData = body.data || {}
      const key = msgData.key || {}
      const remoteJid = key.remoteJid || ''
      const fromMe = key.fromMe || false
      const pushName = msgData.pushName || ''
      const msgTimestamp = msgData.messageTimestamp
      const msgId = key.id || ''

      // Ignorar mensagens de grupo
      if (remoteJid.includes('@g.us')) {
        console.log('[webhook] Ignorando mensagem de grupo:', remoteJid)
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Extrair conteúdo da mensagem
      const message = msgData.message || {}
      const { contentType, contentText, mediaUrl } = extractMessageContent(message)

      if (!contentText && !mediaUrl && !remoteJid) {
        console.log('[webhook] Mensagem ignorada: sem conteúdo')
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Limpar phone do remoteJid
      const phone = remoteJid.replace(/@.*$/, '')

      // Buscar instância para obter o membro_id e centros_custo_id
      const { data: configs, error: configError } = await supabase
        .from('whatsapp_config')
        .select('id, membro_id, centros_custo_id, provider_config')
        .eq('provider', 'evolution_api')

      if (configError) {
        console.error('[webhook] Erro ao buscar configs:', configError)
      }

      const config = (configs || []).find(c => {
        const pcfg = c.provider_config || {}
        return pcfg.instanceName === instanceName
      })

      if (!config) {
        console.log('[webhook] Config não encontrada para instância:', instanceName)
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'config_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const membroId = config.membro_id
      const centrosCustoId = config.centros_custo_id || null

      // Buscar ou criar contato
      let contactId = await findOrCreateContact(supabase, membroId, centrosCustoId, phone, pushName)

      // Buscar ou criar conversa
      let conversationId = await findOrCreateConversation(supabase, membroId, centrosCustoId, contactId, contentText)

      // Inserir mensagem
      const senderType = fromMe ? 'member' : 'contact'
      const messageTimestamp = msgTimestamp
        ? new Date(typeof msgTimestamp === 'number' ? msgTimestamp * 1000 : msgTimestamp).toISOString()
        : new Date().toISOString()

      const { error: msgError } = await supabase
        .from('messages')
        .insert([{
          conversation_id: conversationId,
          membro_id: membroId,
          sender_type: senderType,
          content_type: contentType,
          content_text: contentText,
          media_url: mediaUrl,
          message_id: msgId,
          status: 'delivered',
          created_at: messageTimestamp
        }])

      if (msgError) {
        console.error('[webhook] Erro ao inserir mensagem:', msgError)
        return new Response(JSON.stringify({ error: msgError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log('[webhook] Mensagem salva:', { conversationId, phone, fromMe, contentType })
      return new Response(JSON.stringify({ ok: true, conversationId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── messages.update / SEND_MESSAGE: atualização de status (entregue/lido) ──
    if (event === 'messages.update' || event === 'SEND_MESSAGE') {
      const msgData = body.data || {}
      const key = msgData.key || {}
      const msgId = key.id || ''
      const status = msgData.status || ''

      if (!msgId) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Mapear status da Evolution API para nosso schema
      const statusMap: Record<string, string> = {
        'SENT': 'sent',
        'SERVER_ACK': 'sent',
        'DELIVERY_ACK': 'delivered',
        'READ': 'read',
        'PLAYED': 'read',
        'ERROR': 'failed'
      }
      const mappedStatus = statusMap[status] || 'sent'

      const { error: updateError } = await supabase
        .from('messages')
        .update({ status: mappedStatus })
        .eq('message_id', msgId)

      if (updateError) {
        console.error('[webhook] Erro ao atualizar status:', updateError)
      } else {
        console.log('[webhook] Status atualizado:', { msgId, status: mappedStatus })
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── connection.update / CONNECTION_UPDATE: status da conexão ──
    if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
      const state = body.data?.state || ''
      const statusMap: Record<string, string> = {
        'open': 'connected',
        'close': 'disconnected',
        'connecting': 'connecting'
      }
      const mappedStatus = statusMap[state] || 'disconnected'

      // Buscar config pelo instanceName
      const { data: allConfigs } = await supabase
        .from('whatsapp_config')
        .select('id, provider_config')
        .eq('provider', 'evolution_api')

      const config = (allConfigs || []).find(c => {
        const pcfg = c.provider_config || {}
        return pcfg.instanceName === instanceName
      })

      if (config) {
        await supabase
          .from('whatsapp_config')
          .update({
            status: mappedStatus,
            connected_at: mappedStatus === 'connected' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', config.id)

        console.log('[webhook] Conexão atualizada:', { instanceName, status: mappedStatus, configId: config.id })
      } else {
        console.log('[webhook] Config não encontrada para conexão:', instanceName)
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Evento não reconhecido ──
    console.log('[webhook] Evento ignorado:', event)
    return new Response(JSON.stringify({ ok: true, event }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[webhook] Erro:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// ── Helpers ──

function extractMessageContent(message: Record<string, any>): {
  contentType: string
  contentText: string
  mediaUrl: string
} {
  if (message.conversation) {
    return { contentType: 'text', contentText: message.conversation, mediaUrl: '' }
  }

  if (message.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: message.extendedTextMessage.text, mediaUrl: '' }
  }

  if (message.imageMessage) {
    return {
      contentType: 'image',
      contentText: message.imageMessage.caption || '',
      mediaUrl: message.imageMessage.url || ''
    }
  }

  if (message.videoMessage) {
    return {
      contentType: 'video',
      contentText: message.videoMessage.caption || '',
      mediaUrl: message.videoMessage.url || ''
    }
  }

  if (message.audioMessage) {
    return {
      contentType: 'audio',
      contentText: '',
      mediaUrl: message.audioMessage.url || ''
    }
  }

  if (message.documentMessage) {
    return {
      contentType: 'document',
      contentText: message.documentMessage.fileName || '',
      mediaUrl: message.documentMessage.url || ''
    }
  }

  if (message.stickerMessage) {
    return {
      contentType: 'sticker',
      contentText: '',
      mediaUrl: message.stickerMessage.url || ''
    }
  }

  if (message.locationMessage) {
    return {
      contentType: 'location',
      contentText: message.locationMessage.name || '',
      mediaUrl: ''
    }
  }

  return { contentType: 'text', contentText: '', mediaUrl: '' }
}

async function findOrCreateContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  phone: string,
  pushName: string
): Promise<string> {
  // Buscar contato existente (por centros_custo_id ou membro_id)
  let query = supabase.from('contacts').select('id').eq('phone', phone)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.single()

  if (existing) {
    if (pushName) {
      await supabase
        .from('contacts')
        .update({ name: pushName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .neq('name', pushName)
    }
    return existing.id
  }

  // Criar novo contato
  const insertPayload: Record<string, any> = {
    phone,
    name: pushName || phone,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId

  const { data: newContact } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .single()

  return newContact.id
}

async function findOrCreateConversation(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  contactId: string,
  lastMessageText: string
): Promise<string> {
  // Buscar conversa aberta existente
  let query = supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('status', 'open')
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.single()

  if (existing) {
    return existing.id
  }

  // Criar nova conversa
  const insertPayload: Record<string, any> = {
    contact_id: contactId,
    status: 'open',
    unread_count: 0,
    last_message_text: lastMessageText || '',
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId

  const { data: newConv } = await supabase
    .from('conversations')
    .insert([insertPayload])
    .select('id')
    .single()

  return newConv.id
}

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
      const { contentType, contentText, mediaUrl, mimeType } = extractMessageContent(message)

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

      if (!centrosCustoId && !membroId) {
        console.log('[webhook] Config sem centros_custo_id e membro_id:', config.id)
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_tenant' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // 1. Buscar ou criar contato (prioridade: centros_custo_id) — NÃO cria lead automaticamente
      const contactId = await findOrCreateContact(supabase, membroId, centrosCustoId, phone, pushName, null)

      // 2. Buscar ou criar conversa (prioridade: centros_custo_id) — sem lead_id inicial
      const conversationId = await findOrCreateConversation(supabase, membroId, centrosCustoId, contactId, contentText, null)

      // leadId permanece null — lead só será criado via botão "Sincronizar como Lead" no frontend
      const leadId = null

      // 3. Inserir mensagem
      const senderType = fromMe ? 'member' : 'contact'
      const messageTimestamp = msgTimestamp
        ? new Date(typeof msgTimestamp === 'number' ? msgTimestamp * 1000 : msgTimestamp).toISOString()
        : new Date().toISOString()

      const msgPayload: Record<string, any> = {
        conversation_id: conversationId,
        membro_id: membroId,
        sender_type: senderType,
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        mime_type: mimeType || null,
        message_id: msgId,
        status: 'delivered',
        created_at: messageTimestamp
      }

      const { error: msgError } = await supabase
        .from('messages')
        .insert([msgPayload])

      if (msgError) {
        console.error('[webhook] Erro ao inserir mensagem:', msgError)
        return new Response(JSON.stringify({ error: msgError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log('[webhook] Mensagem salva:', { conversationId, phone, fromMe, contentType, leadId })

      // Atualizar conversa: last_message, last_message_at, unread_count
      const lastMessageSummary = contentText
        || (contentType === 'image' ? '[Imagem]' :
          contentType === 'audio' ? '[Áudio]' :
          contentType === 'video' ? '[Vídeo]' :
          contentType === 'document' ? '[Documento]' :
          contentType === 'sticker' ? '[Figurinha]' :
          contentType === 'location' ? '[Localização]' : '')

      const convUpdates: Record<string, any> = {
        last_message_text: lastMessageSummary,
        last_message_at: messageTimestamp,
        updated_at: new Date().toISOString()
      }
      if (!fromMe) {
        // Incrementar não-lidas apenas para mensagens recebidas
        const { data: convRow } = await supabase
          .from('conversations')
          .select('unread_count')
          .eq('id', conversationId)
          .maybeSingle()
        convUpdates.unread_count = (convRow?.unread_count || 0) + 1
      }

      const { error: convUpdateError } = await supabase
        .from('conversations')
        .update(convUpdates)
        .eq('id', conversationId)
      if (convUpdateError) {
        console.error('[webhook] Erro ao atualizar conversa:', convUpdateError)
      }

      return new Response(JSON.stringify({ ok: true, conversationId, leadId }), {
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
  mimeType: string
} {
  if (message.conversation) {
    return { contentType: 'text', contentText: message.conversation, mediaUrl: '', mimeType: '' }
  }

  if (message.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: message.extendedTextMessage.text, mediaUrl: '', mimeType: '' }
  }

  if (message.imageMessage) {
    return {
      contentType: 'image',
      contentText: message.imageMessage.caption || '',
      mediaUrl: message.imageMessage.mediaUrl || message.imageMessage.url || '',
      mimeType: message.imageMessage.mimetype || 'image/jpeg'
    }
  }

  if (message.videoMessage) {
    return {
      contentType: 'video',
      contentText: message.videoMessage.caption || '',
      mediaUrl: message.videoMessage.mediaUrl || message.videoMessage.url || '',
      mimeType: message.videoMessage.mimetype || 'video/mp4'
    }
  }

  if (message.audioMessage) {
    return {
      contentType: 'audio',
      contentText: '',
      mediaUrl: message.audioMessage.mediaUrl || message.audioMessage.url || '',
      mimeType: message.audioMessage.mimetype || 'audio/ogg; codecs=opus'
    }
  }

  if (message.documentMessage) {
    return {
      contentType: 'document',
      contentText: message.documentMessage.fileName || '',
      mediaUrl: message.documentMessage.mediaUrl || message.documentMessage.url || '',
      mimeType: message.documentMessage.mimetype || 'application/octet-stream'
    }
  }

  if (message.stickerMessage) {
    return {
      contentType: 'sticker',
      contentText: '',
      mediaUrl: message.stickerMessage.mediaUrl || message.stickerMessage.url || '',
      mimeType: message.stickerMessage.mimetype || 'image/webp'
    }
  }

  if (message.locationMessage) {
    return {
      contentType: 'location',
      contentText: message.locationMessage.name || '',
      mediaUrl: '',
      mimeType: ''
    }
  }

  return { contentType: 'text', contentText: '', mediaUrl: '', mimeType: '' }
}

// ── findOrCreateContact: prioridade centros_custo_id, vincula lead ──
async function findOrCreateContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  phone: string,
  pushName: string,
  leadId: string | null
): Promise<string> {
  // Buscar contato existente — SEMPRE priorizar centros_custo_id
  let query = supabase.from('contacts').select('id').eq('phone', phone)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    // Fallback legado: só quando não há centros_custo_id
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.maybeSingle()

  if (existing) {
    // Atualizar nome e vincular lead se necessário
    const updates: Record<string, any> = {}
    if (pushName) updates.name = pushName
    if (leadId && !existing.lead_id) updates.lead_id = leadId
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      await supabase.from('contacts').update(updates).eq('id', existing.id)
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
  if (leadId) insertPayload.lead_id = leadId

  const { data: newContact, error: contactError } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  if (contactError) {
    console.error('[webhook] Erro ao criar contato:', contactError)
    throw new Error('Failed to create contact: ' + contactError.message)
  }

  return newContact.id
}

// ── findOrCreateConversation: prioridade centros_custo_id, vincula lead ──
async function findOrCreateConversation(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  contactId: string,
  lastMessageText: string,
  leadId: string | null
): Promise<string> {
  // REGRA: "Meu WhatsApp, meu lead" — buscar por contact_id + membro_id
  // Se o mesmo contato fala com dois corretores diferentes, cria conversas separadas
  let query = supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('status', 'open')

  if (membroId) {
    query = query.eq('membro_id', membroId)
  } else if (centrosCustoId) {
    // Fallback legado: quando não há membro_id (não deveria acontecer)
    query = query.eq('centros_custo_id', centrosCustoId)
  }
  const { data: existing } = await query.maybeSingle()

  if (existing) {
    // Vincular lead se necessário
    if (leadId && !existing.lead_id) {
      await supabase
        .from('conversations')
        .update({ lead_id: leadId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
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
  if (leadId) insertPayload.lead_id = leadId

  const { data: newConv, error: convError } = await supabase
    .from('conversations')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  if (convError) {
    console.error('[webhook] Erro ao criar conversa:', convError)
    throw new Error('Failed to create conversation: ' + convError.message)
  }

  return newConv.id
}
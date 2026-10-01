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

      // Detectar se é grupo
      const isGroup = remoteJid.includes('@g.us')

      // Extrair conteúdo da mensagem
      const message = msgData.message || {}

      // ── protocolMessage (REVOKE): "apagado para todos" embutido em messages.upsert ──
      // A Evolution às vezes envia a revogação aqui em vez do evento messages.delete.
      // Marca a mensagem ORIGINAL como apagada e NÃO cria bolha nova no chat.
      const proto = message.protocolMessage
      if (proto && (proto.type === 'REVOKE' || proto.type === 0)) {
        const revokeId = String(proto.key?.id || '')
        if (revokeId) {
          const { error: revokeErr } = await supabase
            .from('messages')
            .update({ is_deleted: true, content_text: null, media_url: null })
            .eq('message_id', revokeId)
          if (revokeErr) {
            console.error('[webhook] Erro ao processar protocolMessage (REVOKE):', revokeErr)
          } else {
            console.log('[webhook] protocolMessage REVOKE aplicado em:', revokeId)
          }
        } else {
          console.log('[webhook] protocolMessage REVOKE sem key.id — ignorado')
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { contentType, contentText, mediaUrl, mimeType } = extractMessageContent(message)

      if (!contentText && !mediaUrl && !remoteJid) {
        console.log('[webhook] Mensagem ignorada: sem conteúdo')
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

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

      let contactId: string
      let phone: string
      let contactName: string

      if (isGroup) {
        // === GRUPO ===
        // Para grupos, usar o remoteJid como group_jid
        // O "phone" será o group_jid para fins de identificação única
        phone = remoteJid
        // IMPORTANTE: NÃO usar pushName aqui — em mensagens de grupo o pushName é
        // o nome de QUEM enviou a mensagem (ex: operador), não o nome do grupo.
        // O nome real do grupo é preenchido por `groups.update` ou `wa-sync-contacts`.
        contactName = ''
        // Buscar ou criar contato de grupo
        contactId = await findOrCreateGroupContact(supabase, membroId, centrosCustoId, remoteJid, contactName)
      } else {
        // === CONTATO INDIVIDUAL ===
        // Limpar phone do remoteJid
        phone = remoteJid.replace(/@.*$/, '')
        // Em mensagens enviadas (fromMe) o pushName é o próprio operador (ex: "Pedro
        // Henrique") — jamais sobrescrever o nome do contato com ele.
        contactName = fromMe ? '' : (pushName || '')
        // Buscar ou criar contato individual
        contactId = await findOrCreateContact(supabase, membroId, centrosCustoId, phone, contactName, null)
      }

      // Avatar do contato: quando o payload de mensagem traz a foto de perfil
      const incomingAvatar = String(msgData.profilePictureUrl || msgData.avatarUrl || '')
      if (!isGroup && /^https?:\/\//i.test(incomingAvatar)) {
        const { error: avErr } = await supabase
          .from('contacts')
          .update({ avatar_url: incomingAvatar, updated_at: new Date().toISOString() })
          .eq('id', contactId)
        if (avErr && !/avatar_url/.test(avErr.message || '')) {
          console.error('[webhook] Erro ao salvar avatar do contato:', avErr)
        }
      }

      // 2. Buscar ou criar conversa (prioridade: centros_custo_id) — sem lead_id inicial
      const conversationId = await findOrCreateConversation(supabase, membroId, centrosCustoId, contactId, contentText, null, isGroup, remoteJid)

      // leadId permanece null — lead só será criado via botão "Sincronizar como Lead" no frontend
      const leadId = null

      // 3. Inserir mensagem
      const senderType = fromMe ? 'member' : 'contact'
      const messageTimestamp = msgTimestamp
        ? new Date(typeof msgTimestamp === 'number' ? msgTimestamp * 1000 : msgTimestamp).toISOString()
        : new Date().toISOString()

      // Identificação do remetente em mensagens de GRUPO (recebidas):
      // participant = JID de quem enviou (ex: 558599999999@s.whatsapp.net)
      const participantJid = (isGroup && !fromMe)
        ? String(key.participant || msgData.participant || '')
        : ''
      const senderName = participantJid ? (pushName || '') : '' // pushName do remetente || null
      const senderPhone = participantJid
        ? participantJid.split('@')[0].split(':')[0].replace(/\D/g, '')
        : ''
      const senderJid = participantJid || null

      // Vínculo de resposta encadeada (quoted reply) — contextInfo da mensagem
      const { quotedMessageId, quotedContent, quotedSender } = extractQuotedInfo(message)

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
        sender_jid: senderJid,
        sender_name: senderName || null,
        sender_phone: senderPhone || null,
        quoted_message_id: quotedMessageId || null,
        quoted_content: quotedContent || null,
        quoted_sender: quotedSender || null,
        created_at: messageTimestamp
      }

      let { error: msgError } = await supabase
        .from('messages')
        .insert([msgPayload])

      // Resiliência: colunas novas (sender_* / quoted_*) ainda não migradas
      // → remove a coluna citada pelo erro e tenta de novo, sem perder a mensagem.
      let guard = 0
      while (msgError && guard < 8) {
        guard++
        const missing = /(sender_jid|sender_name|sender_phone|sender_avatar_url|quoted_message_id|quoted_content|quoted_sender)/.exec(msgError.message || '')
        if (!missing) break
        console.warn('[webhook] Coluna opcional indisponível — inserindo sem ela:', missing[1])
        delete msgPayload[missing[1]]
        ;({ error: msgError } = await supabase.from('messages').insert([msgPayload]))
      }

      if (msgError) {
        console.error('[webhook] Erro ao inserir mensagem:', msgError)
        return new Response(JSON.stringify({ error: msgError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      console.log('[webhook] Mensagem salva:', { conversationId, phone, fromMe, contentType, leadId, isGroup })

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
        updated_at: new Date().toISOString(),
        // Mensagem nova devolve a conversa à lista principal (padrão WhatsApp)
        is_archived: false
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

      let { error: convUpdateError } = await supabase
        .from('conversations')
        .update(convUpdates)
        .eq('id', conversationId)
      // Resiliência: migração is_archived pendente → repetir sem a coluna
      if (convUpdateError && /is_archived/.test(convUpdateError.message || '')) {
        console.warn('[webhook] is_archived indisponível — repetindo update sem a coluna:', convUpdateError.message)
        const { is_archived: _omit, ...restUpdates } = convUpdates
        const retry = await supabase
          .from('conversations')
          .update(restUpdates)
          .eq('id', conversationId)
        convUpdateError = retry.error
      }
      if (convUpdateError) {
        console.error('[webhook] Erro ao atualizar conversa:', convUpdateError)
      }

      return new Response(JSON.stringify({ ok: true, conversationId, leadId, isGroup }), {
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

    // ── messages.delete / MESSAGES_DELETE: mensagem apagada pelo contato ──
    if (event === 'messages.delete' || event === 'MESSAGES_DELETE') {
      try {
        const raw = body.data
        const items: any[] = Array.isArray(raw) ? raw
          : Array.isArray(raw?.date) ? raw.date
          : raw && typeof raw === 'object' ? [raw]
          : []

        const ids: string[] = []
        for (const it of items) {
          const id = it?.key?.id || it?.id || it?.messageId || it?.message?.key?.id
          if (id) ids.push(String(id))
        }

        if (ids.length) {
          const { error: delError } = await supabase
            .from('messages')
            .update({ is_deleted: true, content_text: null, media_url: null })
            .in('message_id', ids)

          if (delError) {
            console.error('[webhook] Erro ao marcar mensagem como apagada:', delError)
          } else {
            console.log('[webhook] Mensagens marcadas como apagadas:', ids)
          }
        } else {
          console.log('[webhook] messages.delete sem ids reconhecíveis:', String(JSON.stringify(raw) || '').substring(0, 300))
        }
      } catch (delErr) {
        console.error('[webhook] Erro ao processar messages.delete:', delErr)
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── groups.update / GROUPS_UPDATE: renomeação de grupo WhatsApp ──
    if (
      event === 'groups.update' || event === 'GROUPS_UPDATE' ||
      event === 'groups.upsert' || event === 'GROUPS_UPSERT' ||
      event === 'group-update' || event === 'GROUP_UPDATE'
    ) {
      let updatedContacts = 0
      let updatedConversations = 0
      try {
        const raw = body.data
        const items: any[] = Array.isArray(raw) ? raw
          : raw && typeof raw === 'object' ? [raw]
          : []

        for (const g of items) {
          const rawId = g?.id || g?.jid || g?.remoteJid || ''
          const jid = String(rawId).includes('@g.us')
            ? String(rawId)
            : rawId ? `${rawId}@g.us` : ''
          if (!jid) continue
          const subject = String(g?.subject || g?.title || g?.name || '').trim()
          const pic: string | null =
            g?.pictureUrl || g?.imgUrl || g?.profilePicUrl || g?.picture || g?.avatar || null
          if (!subject && !pic) continue

          const now = new Date().toISOString()

          const { data: groupContacts, error: gcErr } = await supabase
            .from('contacts')
            .select('id')
            .eq('group_jid', jid)
            .eq('is_group', true)
          if (gcErr) {
            console.error('[webhook] Erro ao buscar contatos do grupo:', gcErr)
          }
          const contactUpdate: Record<string, any> = { updated_at: now }
          if (subject) contactUpdate.name = subject
          if (pic) contactUpdate.avatar_url = pic
          for (const row of groupContacts || []) {
            let { error: uErr } = await supabase
              .from('contacts')
              .update(contactUpdate)
              .eq('id', row.id)
            // Resiliência: migração de avatar_url pendente
            if (uErr && /avatar_url/.test(uErr.message || '')) {
              delete contactUpdate.avatar_url
              ;({ error: uErr } = await supabase
                .from('contacts')
                .update(contactUpdate)
                .eq('id', row.id))
            }
            if (uErr) console.error('[webhook] Erro ao atualizar nome do grupo:', uErr)
            else updatedContacts++
          }

          const convUpdate: Record<string, any> = { updated_at: now }
          if (subject) { convUpdate.group_name = subject; convUpdate.title = subject }
          if (pic) convUpdate.avatar_url = pic
          let { error: convErr } = await supabase
            .from('conversations')
            .update(convUpdate)
            .eq('group_jid', jid)
          // Resiliência: migração de avatar_url pendente → repetir sem a coluna
          if (convErr && /avatar_url/.test(convErr.message || '')) {
            delete convUpdate.avatar_url
            ;({ error: convErr } = await supabase
              .from('conversations')
              .update(convUpdate)
              .eq('group_jid', jid))
          }
          // Resiliência: migração de title pendente → repetir sem a coluna
          if (convErr && /title/.test(convErr.message || '')) {
            delete convUpdate.title
            ;({ error: convErr } = await supabase
              .from('conversations')
              .update(convUpdate)
              .eq('group_jid', jid))
          }
          if (convErr) console.error('[webhook] Erro ao atualizar group_name:', convErr)
          else updatedConversations++

          console.log('[webhook] groups.update:', { jid, subject, hasPic: !!pic, updatedContacts, updatedConversations })
        }
      } catch (grpErr) {
        console.error('[webhook] Erro ao processar groups.update:', grpErr)
      }

      return new Response(JSON.stringify({ ok: true, updatedContacts, updatedConversations }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── contacts.update / CONTACTS_UPDATE: foto de perfil alterada ──
    // Salva profilePictureUrl direto em contacts.avatar_url.
    if (event === 'contacts.update' || event === 'CONTACTS_UPDATE') {
      let updatedAvatars = 0
      try {
        const raw = body.data
        const items: any[] = Array.isArray(raw) ? raw
          : raw && typeof raw === 'object' ? [raw]
          : []
        const now = new Date().toISOString()
        for (const it of items) {
          const jid = String(it?.id || it?.jid || it?.remoteJid || '')
          const url = it?.profilePictureUrl || it?.avatarUrl || it?.pictureUrl || null
          if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue
          const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
          if (!digits) continue
          const { error } = await supabase
            .from('contacts')
            .update({ avatar_url: url, updated_at: now })
            .eq('phone', digits)
            .eq('is_group', false)
          if (error) {
            if (/avatar_url/.test(error.message || '')) {
              console.log('[webhook] avatar_url indisponível (migração pendente):', error.message)
              break
            }
            console.error('[webhook] Erro ao salvar avatar do contato:', error)
          } else updatedAvatars++
        }
        console.log('[webhook] contacts.update: avatares salvos:', updatedAvatars)
      } catch (cuErr) {
        console.error('[webhook] Erro ao processar contacts.update:', cuErr)
      }

      return new Response(JSON.stringify({ ok: true, updatedAvatars }), {
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

// ── extractQuotedInfo: extrai vínculo de resposta encadeada (quoted reply) ──
// O WhatsApp entrega o contexto em `contextInfo` dentro do tipo da mensagem
// (extendedTextMessage, imageMessage, videoMessage, audioMessage, documentMessage,
// stickerMessage) — com stanzaId, participant e quotedMessage.
function extractQuotedInfo(message: Record<string, any>): {
  quotedMessageId: string
  quotedContent: string
  quotedSender: string
} {
  const ctx =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.audioMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo ||
    message.contextInfo ||
    null

  if (!ctx) return { quotedMessageId: '', quotedContent: '', quotedSender: '' }

  const quotedMessageId = String(ctx.stanzaId || ctx.id || '')
  const participantJid = String(ctx.participant || '')
  const quotedSender = participantJid
    ? participantJid.split('@')[0].split(':')[0].replace(/\D/g, '')
    : ''

  const qm = ctx.quotedMessage || {}
  let quotedContent = ''
  if (qm.conversation) {
    quotedContent = String(qm.conversation)
  } else if (qm.extendedTextMessage?.text) {
    quotedContent = String(qm.extendedTextMessage.text)
  } else if (qm.imageMessage) {
    quotedContent = qm.imageMessage.caption || '📷 Foto'
  } else if (qm.videoMessage) {
    quotedContent = qm.videoMessage.caption || '🎥 Vídeo'
  } else if (qm.audioMessage) {
    quotedContent = '🎤 Áudio'
  } else if (qm.documentMessage) {
    quotedContent = qm.documentMessage.fileName || '📄 Documento'
  } else if (qm.stickerMessage) {
    quotedContent = '🖼️ Figura'
  } else if (qm.locationMessage) {
    quotedContent = qm.locationMessage.name || '📍 Localização'
  } else if (qm.contactMessage) {
    quotedContent = qm.contactMessage.displayName || '👤 Contato'
  }

  if (!quotedMessageId && !quotedContent) {
    return { quotedMessageId: '', quotedContent: '', quotedSender: '' }
  }

  return { quotedMessageId, quotedContent, quotedSender }
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
  // Para contatos individuais: phone não deve ser um group_jid (@g.us)
  let query = supabase.from('contacts').select('id, name').eq('phone', phone).eq('is_group', false)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    // Fallback legado: só quando não há centros_custo_id
    query = query.eq('membro_id', membroId)
  }
  query = query.limit(1)
  const { data: existing } = await query.maybeSingle()

  if (existing) {
    // Atualizar nome e vincular lead se necessário
    const updates: Record<string, any> = {}
    if (pushName) {
      // Sempre guardar o pushName original (coluna push_name)
      updates.push_name = pushName
      // Só sobrescrever `name` se ele estiver vazio, for apenas o telefone
      // ou um valor genérico — nunca um nome já curado no CRM.
      const currentName = String(existing.name || '').trim()
      const isGeneric = !currentName || currentName === phone || /^\d+$/.test(currentName)
      if (isGeneric) updates.name = pushName
    }
    if (leadId && !existing.lead_id) updates.lead_id = leadId
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      const { error: upErr } = await supabase.from('contacts').update(updates).eq('id', existing.id)
      // Resiliência: migração de push_name pendente → repetir sem a coluna
      if (upErr && /push_name/.test(upErr.message || '')) {
        delete updates.push_name
        await supabase.from('contacts').update(updates).eq('id', existing.id)
      }
    }
    return existing.id
  }

  // Criar novo contato individual
  const insertPayload: Record<string, any> = {
    phone,
    name: pushName || phone,
    push_name: pushName || '',
    is_group: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId
  if (leadId) insertPayload.lead_id = leadId

  let { data: newContact, error: contactError } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  // Resiliência: migração de push_name pendente → inserir sem a coluna
  if (contactError && /push_name/.test(contactError.message || '')) {
    delete insertPayload.push_name
    ;({ data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert([insertPayload])
      .select('id')
      .maybeSingle())
  }

  if (contactError) {
    console.error('[webhook] Erro ao criar contato:', contactError)
    throw new Error('Failed to create contact: ' + contactError.message)
  }

  return newContact.id
}

// ── findOrCreateGroupContact: cria/busca contato para grupo WhatsApp ──
async function findOrCreateGroupContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  groupJid: string,
  groupName: string
): Promise<string> {
  // Buscar grupo existente pelo group_jid
  let query = supabase.from('contacts').select('id').eq('group_jid', groupJid).eq('is_group', true)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.maybeSingle()

  if (existing) {
    // Atualizar nome do grupo apenas quando temos o subject real
    // (nunca vem de pushName de mensagem — ver chamada em messages.upsert)
    if (groupName && groupName !== existing.name) {
      await supabase
        .from('contacts')
        .update({ name: groupName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }

  // Criar novo contato de grupo — sem nome ainda (group_jid identifica).
  // O nome real chega via groups.update ou wa-sync-contacts.
  const insertPayload: Record<string, any> = {
    phone: groupJid,
    name: groupName || '',
    is_group: true,
    group_jid: groupJid,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId

  const { data: newContact, error: contactError } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  if (contactError) {
    console.error('[webhook] Erro ao criar contato de grupo:', contactError)
    throw new Error('Failed to create group contact: ' + contactError.message)
  }

  console.log('[webhook] Grupo criado:', { groupJid, groupName, contactId: newContact.id })
  return newContact.id
}

// ── findOrCreateConversation: prioridade centros_custo_id, vincula lead ──
async function findOrCreateConversation(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  contactId: string,
  lastMessageText: string,
  leadId: string | null,
  isGroup: boolean = false,
  groupJid: string | null = null
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
    // Atualizar group_jid da conversa se for grupo.
    // NUNCA gravar lastMessageText em group_name — o texto da última mensagem
    // aparecia como título da conversa no CRM. O nome real do grupo vem de
    // groups.update / wa-sync-contacts.
    if (isGroup && groupJid) {
      const grpUpdate: Record<string, any> = {
        group_jid: groupJid,
        is_group: true,
        remote_jid: groupJid,
        updated_at: new Date().toISOString(),
      }
      let { error: grpErr } = await supabase
        .from('conversations')
        .update(grpUpdate)
        .eq('id', existing.id)
      // Resiliência: migração de is_group/remote_jid pendente → repetir só com group_jid
      if (grpErr && /(is_group|remote_jid)/.test(grpErr.message || '')) {
        ;({ error: grpErr } = await supabase
          .from('conversations')
          .update({ group_jid: groupJid, updated_at: new Date().toISOString() })
          .eq('id', existing.id))
      }
      if (grpErr) console.error('[webhook] Erro ao atualizar grupo da conversa:', grpErr.message)
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
  if (isGroup) {
    insertPayload.group_jid = groupJid
    insertPayload.group_name = ''
    insertPayload.is_group = true
    insertPayload.remote_jid = groupJid
  }

  // Insert resiliente: remove colunas opcionais ausentes (migração pendente)
  const optionalConvCols = ['is_group', 'remote_jid', 'title']
  let newConv: any = null
  let convError: any = null
  for (let i = 0; i <= optionalConvCols.length; i++) {
    const res = await supabase
      .from('conversations')
      .insert([insertPayload])
      .select('id')
      .maybeSingle()
    newConv = res.data
    convError = res.error
    if (!convError) break
    const missing = optionalConvCols.find(col => new RegExp(`\\b${col}\\b`).test(convError.message || ''))
    if (missing) { delete insertPayload[missing]; continue }
    break
  }

  if (convError) {
    console.error('[webhook] Erro ao criar conversa:', convError)
    throw new Error('Failed to create conversation: ' + convError.message)
  }

  return newConv.id
}
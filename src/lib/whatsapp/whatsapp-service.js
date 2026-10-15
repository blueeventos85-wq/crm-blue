/* ============================================
   WHATSAPP SERVICE — Blue CRM
   Serviço client-side para integração WhatsApp
   via Evolution API (Supabase Edge Functions)
   Suporte multi-empresas via centros_custo_id
   ============================================ */

/* ── Estado local ── */
let _waConfigCache = null
let _waConversationsCache = []
let _waMessagesCache = {}

/* ============================================
   HELPER: invocar Edge Function autenticada
   ============================================ */
async function waInvokeFunction(functionName, body) {
  if (!_supabase) throw new Error('Supabase client não inicializado')

  try {
    const { data, error } = await _supabase.functions.invoke(functionName, {
      body
    })

    if (error) {
      // Extrair detalhes reais do erro (corpo da resposta da Edge Function)
      let errorDetails = error.message || `Erro ao chamar ${functionName}`
      try {
        if (error.context && typeof error.context.json === 'function') {
          const errBody = await error.context.json()
          errorDetails = JSON.stringify(errBody)
        } else if (error.context && typeof error.context.text === 'function') {
          const errText = await error.context.text()
          if (errText) {
            try {
              const parsed = JSON.parse(errText)
              errorDetails = JSON.stringify(parsed)
            } catch {
              errorDetails = errText
            }
          }
        }
      } catch (_) { /* manter errorDetails original */ }
      console.error(`[WA] Erro completo retornado:`, errorDetails)
      return { success: false, error: errorDetails, data: null }
    }

    return data
  } catch (err) {
    console.error(`[WA] Exceção ao chamar ${functionName}:`, err)
    return { success: false, error: err instanceof Error ? err.message : String(err), data: null }
  }
}

/* ============================================
   1. CONFIG: buscar configuração WhatsApp
   ============================================ */
async function waFetchConfig(membroId, centrosCustoId) {
  if (!_supabase) return null

  let query = _supabase
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution_api')

  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  } else {
    return null
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[WA] Config query error:', error.message, error.code)
    return null
  }

  console.log('[WA] Config encontrada:', data ? { id: data.id, status: data.status, instance: data.provider_config?.instanceName } : 'null')
  _waConfigCache = data
  return data
}

/* ============================================
   2. CONNECT: criar instância e pegar QR Code
   ============================================ */
async function waConnect(membroId, instanceName, centrosCustoId, integration) {
  if (!instanceName) throw new Error('instanceName é obrigatório')
  if (!membroId && !centrosCustoId) throw new Error('membroId ou centrosCustoId é obrigatório')

  const cleanName = String(instanceName).trim()
  const cleanIntegration = String(integration || '').trim() || 'WHATSAPP-BAILEYS'

  console.log('[WA] Conectando instância:', cleanName, '| CC:', centrosCustoId, '| integração:', cleanIntegration)

  const result = await waInvokeFunction('evolution-connect', {
    membroId,
    centrosCustoId,
    instanceName: cleanName,
    integration: cleanIntegration,
    qrcode: true
  })

  // waInvokeFunction agora retorna { success: false, error: ... } em vez de throw
  if (result && result.success === false) {
    throw new Error(result.error || 'Falha ao conectar com a Evolution API')
  }

  if (result?.success) {
    _waConfigCache = null
    console.log('[WA] Conexão iniciada:', result)
  }

  return result
}

/* ============================================
   1b. CONFIG: listar TODAS as configs (multi-instância)
   ============================================ */
async function waFetchAllConfigs(membroId) {
  if (!_supabase) return []

  let query = _supabase
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution_api')

  if (membroId) {
    // Membro vê as configs das empresas em que participa + as próprias (fallback legado)
    const { data: vinculos } = await _supabase
      .from('membro_centros_custo')
      .select('centro_custo_id')
      .eq('membro_id', membroId)

    const ccIds = (vinculos || []).map(v => v.centro_custo_id).filter(Boolean)
    if (ccIds.length) {
      query = query.or(`centros_custo_id.in.(${ccIds.join(',')}),membro_id.eq.${membroId}`)
    } else {
      query = query.eq('membro_id', membroId)
    }
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) {
    console.warn('[WA] All configs query error:', error.message)
    return []
  }

  return data || []
}

/* ============================================
   2b. LINK INSTANCE: vincular instância existente
       na Evolution a uma empresa (sem QR)
   ============================================ */
async function waInstanceLink({ membroId, centrosCustoId, instanceName, numero }) {
  if (!instanceName || !String(instanceName).trim()) {
    throw new Error('instanceName é obrigatório')
  }
  if (!centrosCustoId) {
    throw new Error('centrosCustoId é obrigatório')
  }

  console.log('[WA] Vinculando instância existente:', instanceName, '| CC:', centrosCustoId)

  const result = await waInvokeFunction('wa-instance-link', {
    membroId: membroId || null,
    centrosCustoId,
    instanceName: String(instanceName).trim(),
    numero: numero || null
  })

  if (result && result.success === false) {
    throw new Error(result.error || 'Falha ao vincular instância')
  }

  _waConfigCache = null
  console.log('[WA] Instância vinculada:', result)
  return result
}

/* ============================================
   2c. SET WEBHOOK: re-sincronizar webhook + estado
       da instância já vinculada (botão "Sincronizar")
   ============================================ */
async function waSetWebhook(membroId, centrosCustoId) {
  const config = await waFetchConfig(membroId, centrosCustoId)
  if (!config) throw new Error('Configuração não encontrada')

  const instanceName = config.provider_config?.instanceName
  if (!instanceName) throw new Error('Config sem instanceName')

  console.log('[WA] Re-sincronizando webhook da instância:', instanceName)

  const result = await waInvokeFunction('wa-instance-link', {
    membroId: membroId || null,
    centrosCustoId: config.centros_custo_id,
    instanceName,
    numero: config.provider_config?.numero || null
  })

  if (result && result.success === false) {
    throw new Error(result.error || 'Falha ao sincronizar webhook')
  }

  _waConfigCache = null
  return result
}

/* ============================================
   2d. UNLINK: remover vínculo config ↔ empresa
       (a instância continua viva na Evolution)
   ============================================ */
async function waUnlinkInstance(configId) {
  if (!configId) throw new Error('configId é obrigatório')

  const { error } = await _supabase
    .from('whatsapp_config')
    .delete()
    .eq('id', configId)

  if (error) throw error

  _waConfigCache = null
  console.log('[WA] Config desvinculada/removida:', configId)
}

/* ============================================
   3. DISCONNECT: desconectar instância
   ============================================ */
async function waDisconnect(membroId, centrosCustoId) {
  const config = await waFetchConfig(membroId, centrosCustoId)
  if (!config) throw new Error('Configuração não encontrada')

  const { error } = await _supabase
    .from('whatsapp_config')
    .update({
      status: 'disconnected',
      connected_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', config.id)

  if (error) throw error

  _waConfigCache = null
  console.log('[WA] Desconectado')
}

/* ============================================
   4. SEND TEXT: enviar mensagem de texto
   ============================================ */
async function waSendText(membroId, conversationId, text, centrosCustoId, number, instanceName, quoted = null, replyMeta = null) {
  if (!membroId || !conversationId || !text) {
    throw new Error('membroId, conversationId e text são obrigatórios')
  }

  const payload = {
    membroId,
    conversationId,
    contentText: text,
    contentType: 'text',
    centrosCustoId: centrosCustoId || null,
    number: number || null,
    instanceName: instanceName || null
  }
  if (quoted) payload.quoted = quoted
  if (replyMeta) payload.replyMeta = replyMeta
  console.log('[WA] Payload enviado para evolution-send:', payload)

  const result = await waInvokeFunction('evolution-send', payload)

  if (result && result.success === false) {
    throw new Error(result.error || 'Erro ao enviar mensagem')
  }

  return result
}

/* ============================================
   5. SEND MEDIA: enviar mídia
   ============================================ */
/* Mensagem clara quando o envio falha por limite externo ou tempo do gateway.
   Em arquivos muito grandes a Edge Function pode estourar o tempo de espera
   (~150s) mesmo com a Evolution API concluindo o envio — por isso o aviso de
   conferir antes de reenviar. */
function _waMediaFailureMessage(raw) {
  const msg = String(raw || '').trim()
  if (/504|gateway|timeout|timed out|idle time/i.test(msg)) {
    return 'O envio demorou mais que o tempo limite da Supabase (arquivos grandes podem levar vários minutos). Confira no WhatsApp se a mensagem chegou antes de reenviar; se não chegou, envie um link ou um arquivo menor.'
  }
  if (/payload too large|request entity too large|body too large|413|media_too_large_inline/i.test(msg)) {
    return 'Arquivo grande demais para o serviço de envio. Envie um link para o contato ou um arquivo menor.'
  }
  return msg || 'Erro ao enviar mídia'
}

async function waSendMedia(membroId, conversationId, mediaUrl, contentType = 'image', caption = '', centrosCustoId, number, instanceName, quoted = null, replyMeta = null, extra = null) {
  if (!membroId || !conversationId || !mediaUrl) {
    throw new Error('membroId, conversationId e mediaUrl são obrigatórios')
  }

  const mediaSize = mediaUrl.length > 100 ? `${Math.round(mediaUrl.length / 1024)}KB` : 'small'
  console.log('[WA] Enviando mídia:', { contentType, conversationId, number, instanceName, mediaSize, storagePath: extra?.mediaPath || null })

  const body = {
    membroId,
    conversationId,
    contentText: caption,
    mediaUrl,
    contentType,
    centrosCustoId: centrosCustoId || null,
    number: number || null,
    instanceName: instanceName || null
  }
  if (quoted) body.quoted = quoted
  if (replyMeta) body.replyMeta = replyMeta
  // Extras (opcionais): mídia grande veio do Supabase Storage (mediaPath é o
  // caminho do objeto gravado em messages.media_url — o link é temporário).
  if (extra?.mimeType) body.mimeType = extra.mimeType
  if (extra?.fileName) body.fileName = extra.fileName
  if (extra?.mediaPath) body.mediaPath = extra.mediaPath
  // Miniatura da imagem (base64 JPEG) → messages.media_preview, para a
  // conversa pintar a foto na hora em vez de esperar o proxy baixar tudo
  if (extra?.preview) body.preview = extra.preview

  const result = await waInvokeFunction('evolution-send', body)

  if (result && result.success === false) {
    throw new Error(_waMediaFailureMessage(result.error))
  }

  return result
}

/* ============================================
   5b. SEND VOICE NOTE: enviar áudio como PTT (voice note nativo WhatsApp)
   ============================================ */
async function waSendVoiceNote(membroId, conversationId, mediaUrl, centrosCustoId, number, instanceName, quoted = null, replyMeta = null) {
  if (!membroId || !conversationId || !mediaUrl) {
    throw new Error('membroId, conversationId e mediaUrl são obrigatórios')
  }

  const mediaSize = mediaUrl.length > 100 ? `${Math.round(mediaUrl.length / 1024)}KB` : 'small'
  console.log('[WA] Enviando voice note (PTT):', { conversationId, number, instanceName, mediaSize })

  const body = {
    membroId,
    conversationId,
    contentText: '',
    mediaUrl,
    contentType: 'audio',
    ptt: true,
    centrosCustoId: centrosCustoId || null,
    number: number || null,
    instanceName: instanceName || null
  }
  if (quoted) body.quoted = quoted
  if (replyMeta) body.replyMeta = replyMeta

  const result = await waInvokeFunction('evolution-send', body)

  if (result && result.success === false) {
    throw new Error(result.error || 'Erro ao enviar voice note')
  }

  return result
}

/* ============================================
   5c. DELETE MESSAGE: apagar mensagem (para todos ou do histórico)
   ============================================ */
async function waDeleteMessage(conversationId, messageId, scope = 'me') {
  if (!conversationId || !messageId) {
    throw new Error('conversationId e messageId são obrigatórios')
  }
  if (scope !== 'me' && scope !== 'all') {
    throw new Error('scope deve ser "me" ou "all"')
  }

  console.log('[WA] Apagando mensagem:', { conversationId, messageId, scope })

  const result = await waInvokeFunction('wa-delete', {
    conversationId,
    messageId,
    scope
  })

  if (result && result.success === false) {
    const err = new Error(result.error || 'Erro ao apagar mensagem')
    err.code = result.error
    throw err
  }

  return result
}

/* ============================================
   5d. SYNC CONTACTS: sincronizar nomes de contatos e grupos
   ============================================ */
async function waSyncContacts(centrosCustoId) {
  if (!centrosCustoId) {
    throw new Error('centros_custoId é obrigatório para sincronizar')
  }

  console.log('[WA] Sincronizando contatos e grupos:', centrosCustoId)

  const result = await waInvokeFunction('wa-sync-contacts', {
    centros_custo_id: centrosCustoId
  })

  if (result && result.success === false) {
    const err = new Error(result.error || 'Erro ao sincronizar contatos e grupos')
    err.code = result.error
    err.triedRoutes = result.triedRoutes || null
    throw err
  }

  return result
}

async function waSyncHistory(centrosCustoId, action = 'messages', page = 1) {
  if (!centrosCustoId) {
    throw new Error('centros_custo_id é obrigatório para sincronizar o histórico')
  }

  const result = await waInvokeFunction('wa-sync-history', {
    centros_custo_id: centrosCustoId,
    action,
    page
  })

  if (result && result.success === false) {
    const err = new Error(result.error || 'Erro ao sincronizar histórico de mensagens')
    err.triedRoutes = result.triedRoutes || null
    throw err
  }

  return result
}

/* ============================================
   6. CONTACTS: buscar contatos
   ============================================ */
async function waFetchContacts(membroId, centrosCustoId) {
  let query = _supabase.from('contacts').select('*')

  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  } else {
    return []
  }

  const { data, error } = await query.order('name')

  if (error) {
    console.error('[WA] Erro ao buscar contatos:', error.message)
    return []
  }

  return data || []
}

/* ============================================
   7. CONVERSATIONS: buscar conversas
   ============================================ */
async function waFetchConversations(membroId, centrosCustoId) {
  let query = _supabase
    .from('conversations')
    .select(`
      *,
      contacts(id, phone, name, profile_pic_url)
    `)

  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  } else {
    return []
  }

  const { data, error } = await query.order('last_message_at', { ascending: false })

  if (error) {
    console.error('[WA] Erro ao buscar conversas:', error.message)
    return []
  }

  _waConversationsCache = data || []
  return _waConversationsCache
}

/* ============================================
   8. MESSAGES: buscar mensagens de uma conversa
   ============================================ */
async function waFetchMessages(conversationId, membroId, limit = 50, before = null) {
  if (!conversationId) return []

  let query = _supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query

  if (error) {
    console.error('[WA] Erro ao buscar mensagens:', error.message)
    return []
  }

  return (data || []).reverse()
}

/* ============================================
   9. MARK READ: marcar conversa como lida
   ============================================ */
async function waMarkAsRead(conversationId) {
  if (!conversationId) return

  const { error } = await _supabase
    .from('conversations')
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)

  if (error) {
    console.error('[WA] Erro ao marcar como lida:', error.message)
  }
}

/* ============================================
   10. SUBSCRIBE: escutar novas mensagens (Realtime)
   ============================================ */
let _waSubscription = null

function waSubscribeToMessages(membroId, onNewMessage, centrosCustoId) {
  if (!_supabase) return

  if (_waSubscription) {
    _waSubscription.unsubscribe()
  }

  // Realtime filter: usar filtro por membro_id (RLS já filtra por centros_custo)
  const filter = membroId ? `membro_id=eq.${membroId}` : undefined

  const channelConfig = {
    event: 'INSERT',
    schema: 'public',
    table: 'messages'
  }
  if (filter) channelConfig.filter = filter

  _waSubscription = _supabase
    .channel('wa-messages')
    .on('postgres_changes', channelConfig, (payload) => {
      console.log('[WA] Nova mensagem recebida:', payload)
      if (onNewMessage) onNewMessage(payload.new)
    })
    .subscribe()

  console.log('[WA] Inscrito em mensagens para:', membroId || centrosCustoId)
}

function waUnsubscribeMessages() {
  if (_waSubscription) {
    _waSubscription.unsubscribe()
    _waSubscription = null
    console.log('[WA] Desinscrito de mensagens')
  }
}

/* ============================================
   11. SUBSCRIBE: escutar mudanças de conversa
   ============================================ */
let _waConvSubscription = null

function waSubscribeToConversations(membroId, onUpdate, centrosCustoId) {
  if (!_supabase) return

  if (_waConvSubscription) {
    _waConvSubscription.unsubscribe()
  }

  // Multi-tenancy: priorizar filtro por centros_custo_id (1 conversa visualizada
  // por empresa); fallback por membro_id quando não há CC informado.
  const filter = centrosCustoId
    ? `centros_custo_id=eq.${centrosCustoId}`
    : (membroId ? `membro_id=eq.${membroId}` : undefined)

  const channelConfig = {
    event: '*',
    schema: 'public',
    table: 'conversations'
  }
  if (filter) channelConfig.filter = filter

  _waConvSubscription = _supabase
    .channel('wa-conversations')
    .on('postgres_changes', channelConfig, (payload) => {
      console.log('[WA] Conversa atualizada:', payload)
      if (onUpdate) onUpdate(payload)
    })
    .subscribe()

  console.log('[WA] Inscrito em conversas para:', membroId || centrosCustoId)
}

function waUnsubscribeConversations() {
  if (_waConvSubscription) {
    _waConvSubscription.unsubscribe()
    _waConvSubscription = null
    console.log('[WA] Desinscrito de conversas')
  }
}

/* ============================================
   12. STATUS
   ============================================ */
function waGetStatus() {
  if (!_waConfigCache) return 'disconnected'
  return _waConfigCache.status || 'disconnected'
}

function waGetInstanceName() {
  if (!_waConfigCache) return null
  return _waConfigCache.provider_config?.instanceName || null
}

/* ============================================
   13. INVALIDATE: limpar caches
   ============================================ */
function waInvalidateCache() {
  _waConfigCache = null
  _waConversationsCache = []
  _waMessagesCache = {}
}

/* ============================================
   EXPOSIÇÃO GLOBAL
   ============================================ */
window.waFetchConfig = waFetchConfig
window.waFetchAllConfigs = waFetchAllConfigs
window.waConnect = waConnect
window.waInstanceLink = waInstanceLink
window.waSetWebhook = waSetWebhook
window.waUnlinkInstance = waUnlinkInstance
window.waDisconnect = waDisconnect
window.waSendText = waSendText
window.waSendMedia = waSendMedia
window.waSendVoiceNote = waSendVoiceNote
window.waDeleteMessage = waDeleteMessage
window.waSyncContacts = waSyncContacts
window.waSyncHistory = waSyncHistory
window.waFetchContacts = waFetchContacts
window.waFetchConversations = waFetchConversations
window.waFetchMessages = waFetchMessages
window.waMarkAsRead = waMarkAsRead
window.waSubscribeToMessages = waSubscribeToMessages
window.waUnsubscribeMessages = waUnsubscribeMessages
window.waSubscribeToConversations = waSubscribeToConversations
window.waUnsubscribeConversations = waUnsubscribeConversations
window.waGetStatus = waGetStatus
window.waGetInstanceName = waGetInstanceName
window.waInvalidateCache = waInvalidateCache

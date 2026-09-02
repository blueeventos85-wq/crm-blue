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

  const { data, error } = await _supabase.functions.invoke(functionName, {
    body
  })

  if (error) {
    console.error(`[WA] Erro na function ${functionName}:`, error.message)
    throw new Error(error.message || `Erro ao chamar ${functionName}`)
  }

  return data
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
async function waConnect(membroId, instanceName, centrosCustoId) {
  if (!instanceName) throw new Error('instanceName é obrigatório')
  if (!membroId && !centrosCustoId) throw new Error('membroId ou centrosCustoId é obrigatório')

  console.log('[WA] Conectando instância:', instanceName, '| CC:', centrosCustoId)

  const result = await waInvokeFunction('evolution-connect', {
    membroId,
    centrosCustoId,
    instanceName,
    qrcode: true
  })

  if (result.success) {
    _waConfigCache = null
    console.log('[WA] Conexão iniciada:', result)
  }

  return result
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
async function waSendText(membroId, conversationId, text, centrosCustoId, number, instanceName) {
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
  console.log('[WA] Payload enviado para evolution-send:', payload)

  const result = await waInvokeFunction('evolution-send', payload)

  return result
}

/* ============================================
   5. SEND MEDIA: enviar mídia
   ============================================ */
async function waSendMedia(membroId, conversationId, mediaUrl, contentType = 'image', caption = '', centrosCustoId, number, instanceName) {
  if (!membroId || !conversationId || !mediaUrl) {
    throw new Error('membroId, conversationId e mediaUrl são obrigatórios')
  }

  console.log('[WA] Enviando mídia:', contentType, 'para conversa:', conversationId)

  const result = await waInvokeFunction('evolution-send', {
    membroId,
    conversationId,
    contentText: caption,
    mediaUrl,
    contentType,
    centrosCustoId: centrosCustoId || null,
    number: number || null,
    instanceName: instanceName || null
  })

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

  const filter = membroId ? `membro_id=eq.${membroId}` : undefined

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
window.waConnect = waConnect
window.waDisconnect = waDisconnect
window.waSendText = waSendText
window.waSendMedia = waSendMedia
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

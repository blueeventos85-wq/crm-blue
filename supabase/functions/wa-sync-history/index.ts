import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_SIZE = 50

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jidToPhone(jid: string): string {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function normalizeGroupJid(id: string): string {
  const s = String(id || '')
  if (!s) return ''
  return s.includes('@') ? s : `${s}@g.us`
}

function digits(v: any): string {
  return String(v == null ? '' : v).replace(/\D/g, '')
}

function phonesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 5 && b === '55' + a) return true
  if (b.length >= 5 && a === '55' + b) return true
  return false
}

async function evoRequest(
  apiUrl: string,
  apiKey: string,
  attempts: { method: string; path: string; status: number }[],
  routes: { method: string; path: string; body?: unknown }[],
  timeoutMs = 60000,
): Promise<{ data: any | null; method: string; path: string }> {
  for (const route of routes) {
    const url = `${apiUrl}${route.path}`
    let res: Response
    try {
      res = await fetch(url, {
        method: route.method,
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json',
        },
        body: route.body !== undefined ? JSON.stringify(route.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (fetchErr) {
      attempts.push({ method: route.method, path: route.path, status: -1 })
      console.error('[history] Fetch falhou:', route.method, route.path, fetchErr)
      continue
    }
    attempts.push({ method: route.method, path: route.path, status: res.status })
    if (res.status === 404 || res.status === 405) continue
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const err: any = new Error(`Evolution API respondeu HTTP ${res.status} em ${route.method} ${route.path}`)
      err.evolutionStatus = res.status
      err.evolutionBody = bodyText.substring(0, 500)
      err.evolutionRoute = route.path
      throw err
    }
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { data, method: route.method, path: route.path }
  }
  const err: any = new Error('Nenhuma rota da Evolution API existe para esta operação (todas retornaram 404/405)')
  err.triedRoutes = attempts.map(a => `${a.method} ${a.path} → ${a.status}`)
  throw err
}

function asList(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k]
      if (data[k] && typeof data[k] === 'object') {
        for (const k2 of keys) {
          if (Array.isArray(data[k][k2])) return data[k][k2]
        }
        return [data[k]]
      }
    }
    if (data.id || data.jid || data.phone || data.key) return [data]
  }
  return []
}

function bytesToBase64(bytes: number[]): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  try { return btoa(bin) } catch { return '' }
}

const THUMB_MAX_CHARS = 80_000

function normalizeThumb(raw: any): string {
  try {
    if (!raw) return ''
    if (typeof raw === 'string') {
      const s = raw.trim().replace(/^data:[^,]*,/, '')
      if (!s || s.length > THUMB_MAX_CHARS) return ''
      return /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : ''
    }
    let bytes: number[] | null = null
    if (Array.isArray(raw)) {
      bytes = raw
    } else if (raw.type === 'Buffer' && Array.isArray(raw.data)) {
      bytes = raw.data
    } else if (typeof raw === 'object') {
      const keys = Object.keys(raw)
      if (keys.length && keys.every(k => /^\d+$/.test(k))) {
        bytes = keys.map(k => raw[k]).filter(n => typeof n === 'number')
      }
    }
    if (!bytes || bytes.length < 64 || bytes.length > 60_000) return ''
    return bytesToBase64(bytes)
  } catch {
    return ''
  }
}

function extractMessageContent(message: Record<string, any>): {
  contentType: string
  contentText: string
  mediaUrl: string
  mimeType: string
  mediaPreview: string
} {
  if (message.conversation) {
    return { contentType: 'text', contentText: message.conversation, mediaUrl: '', mimeType: '', mediaPreview: '' }
  }
  if (message.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: message.extendedTextMessage.text, mediaUrl: '', mimeType: '', mediaPreview: '' }
  }
  if (message.imageMessage) {
    return {
      contentType: 'image',
      contentText: message.imageMessage.caption || '',
      mediaUrl: message.imageMessage.mediaUrl || message.imageMessage.url || '',
      mimeType: message.imageMessage.mimetype || 'image/jpeg',
      mediaPreview: normalizeThumb(message.imageMessage.jpegThumbnail),
    }
  }
  if (message.videoMessage) {
    return {
      contentType: 'video',
      contentText: message.videoMessage.caption || '',
      mediaUrl: message.videoMessage.mediaUrl || message.videoMessage.url || '',
      mimeType: message.videoMessage.mimetype || 'video/mp4',
      mediaPreview: normalizeThumb(message.videoMessage.jpegThumbnail),
    }
  }
  if (message.audioMessage) {
    return {
      contentType: 'audio',
      contentText: '',
      mediaUrl: message.audioMessage.mediaUrl || message.audioMessage.url || '',
      mimeType: message.audioMessage.mimetype || 'audio/ogg; codecs=opus',
      mediaPreview: '',
    }
  }
  if (message.documentMessage) {
    return {
      contentType: 'document',
      contentText: message.documentMessage.fileName || '',
      mediaUrl: message.documentMessage.mediaUrl || message.documentMessage.url || '',
      mimeType: message.documentMessage.mimetype || 'application/octet-stream',
      mediaPreview: '',
    }
  }
  if (message.stickerMessage) {
    return {
      contentType: 'sticker',
      contentText: '',
      mediaUrl: message.stickerMessage.mediaUrl || message.stickerMessage.url || '',
      mimeType: message.stickerMessage.mimetype || 'image/webp',
      mediaPreview: normalizeThumb(message.stickerMessage.jpegThumbnail),
    }
  }
  if (message.locationMessage) {
    return {
      contentType: 'location',
      contentText: message.locationMessage.name || '',
      mediaUrl: '',
      mimeType: '',
      mediaPreview: '',
    }
  }
  if (message.contactMessage) {
    return {
      contentType: 'text',
      contentText: message.contactMessage.displayName || '',
      mediaUrl: '',
      mimeType: '',
      mediaPreview: '',
    }
  }
  return { contentType: 'text', contentText: '', mediaUrl: '', mimeType: '', mediaPreview: '' }
}

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
  const quotedSender = participantJid ? jidToPhone(participantJid) : ''

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

async function findOrCreateContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  phone: string,
  pushName: string,
): Promise<string> {
  let query = supabase.from('contacts').select('id, name, lead_id').eq('phone', phone).eq('is_group', false)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.limit(1).maybeSingle()

  if (existing) {
    const updates: Record<string, any> = {}
    if (pushName) {
      updates.push_name = pushName
      const currentName = String(existing.name || '').trim()
      const isGeneric = !currentName || currentName === phone || /^\d+$/.test(currentName)
      if (isGeneric) updates.name = pushName
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      let { error: upErr } = await supabase.from('contacts').update(updates).eq('id', existing.id)
      if (upErr && /push_name/.test(upErr.message || '')) {
        delete updates.push_name
        await supabase.from('contacts').update(updates).eq('id', existing.id)
      }
    }
    return existing.id
  }

  const insertPayload: Record<string, any> = {
    phone,
    name: pushName || phone,
    push_name: pushName || '',
    is_group: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId

  let { data: newContact, error: contactError } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  if (contactError && /push_name/.test(contactError.message || '')) {
    delete insertPayload.push_name
    ;({ data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert([insertPayload])
      .select('id')
      .maybeSingle())
  }

  if (contactError) {
    throw new Error('Failed to create contact: ' + contactError.message)
  }
  return newContact.id
}

async function findOrCreateGroupContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  groupJid: string,
  groupName: string,
): Promise<string> {
  let query = supabase.from('contacts').select('id').eq('group_jid', groupJid).eq('is_group', true)
  if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  } else if (membroId) {
    query = query.eq('membro_id', membroId)
  }
  const { data: existing } = await query.maybeSingle()

  if (existing) {
    if (groupName && groupName !== existing.name) {
      await supabase
        .from('contacts')
        .update({ name: groupName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const insertPayload: Record<string, any> = {
    phone: groupJid,
    name: groupName || '',
    is_group: true,
    group_jid: groupJid,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId
  if (membroId) insertPayload.membro_id = membroId

  const { data: newContact, error: contactError } = await supabase
    .from('contacts')
    .insert([insertPayload])
    .select('id')
    .maybeSingle()

  if (contactError) {
    throw new Error('Failed to create group contact: ' + contactError.message)
  }
  return newContact.id
}

async function findOrCreateConversation(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  contactId: string,
  lastMessageText: string,
  leadId: string | null,
  isGroup: boolean = false,
  groupJid: string | null = null,
): Promise<string> {
  let query = supabase
    .from('conversations')
    .select('id, lead_id, last_message_at')
    .eq('contact_id', contactId)
    .eq('status', 'open')

  if (membroId) {
    query = query.eq('membro_id', membroId)
  } else if (centrosCustoId) {
    query = query.eq('centros_custo_id', centrosCustoId)
  }
  const { data: existingRows } = await query.limit(1)
  const existing = existingRows && existingRows[0]

  if (existing) {
    if (leadId && !existing.lead_id) {
      await supabase
        .from('conversations')
        .update({ lead_id: leadId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const insertPayload: Record<string, any> = {
    contact_id: contactId,
    status: 'open',
    unread_count: 0,
    last_message_text: lastMessageText || '',
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

  const optionalConvCols = ['is_group', 'remote_jid', 'title', 'group_name']
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
    throw new Error('Failed to create conversation: ' + convError.message)
  }
  return newConv.id
}

function tsToIso(ts: any): string {
  const n = typeof ts === 'string' ? Number(ts) : ts
  if (!n || Number.isNaN(n)) return new Date().toISOString()
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

type TenantMaps = {
  contactByPhone: Map<string, string>
  groupByJid: Map<string, string>
  contactById: Map<string, { name: string; pushName: string; leadId: string | null }>
  convByContact: Map<string, string>
  convById: Map<string, { contactId: string; status: string; membroId: string | null; lastMessageAt: string; leadId: string | null }>
}

async function loadTenantMaps(supabase: any, ccId: string, membroId: string | null): Promise<TenantMaps> {
  const maps: TenantMaps = {
    contactByPhone: new Map(),
    groupByJid: new Map(),
    contactById: new Map(),
    convByContact: new Map(),
    convById: new Map(),
  }
  const { data: contactRows, error: cErr } = await supabase
    .from('contacts')
    .select('id, phone, name, push_name, is_group, group_jid, lead_id')
    .eq('centros_custo_id', ccId)
  if (cErr) throw new Error('Falha ao carregar contatos do tenant: ' + cErr.message)
  for (const r of contactRows || []) {
    if (r.is_group && r.group_jid) maps.groupByJid.set(r.group_jid, r.id)
    const pd = digits(r.phone)
    if (!r.is_group && pd) maps.contactByPhone.set(pd, r.id)
    maps.contactById.set(r.id, { name: r.name || '', pushName: r.push_name || '', leadId: r.lead_id || null })
  }
  const { data: convRows, error: vErr } = await supabase
    .from('conversations')
    .select('id, contact_id, status, membro_id, lead_id, last_message_at')
    .eq('centros_custo_id', ccId)
  if (vErr) throw new Error('Falha ao carregar conversas do tenant: ' + vErr.message)
  for (const r of convRows || []) {
    const id = String(r.id)
    maps.convById.set(id, {
      contactId: r.contact_id,
      status: r.status || '',
      membroId: r.membro_id || null,
      lastMessageAt: r.last_message_at || '',
      leadId: r.lead_id || null,
    })
    if (r.status !== 'open' || !r.contact_id) continue
    const prevId = maps.convByContact.get(r.contact_id)
    if (!prevId) {
      maps.convByContact.set(r.contact_id, id)
    } else {
      const prev = maps.convById.get(prevId)!
      if (prev.membroId !== membroId && r.membro_id === membroId) {
        maps.convByContact.set(r.contact_id, id)
      }
    }
  }
  return maps
}

async function maybeUpdateContact(
  supabase: any,
  contactId: string,
  info: { name: string; pushName: string },
  phone: string,
  pushName: string,
): Promise<void> {
  if (!pushName || pushName === info.pushName) return
  const updates: Record<string, any> = { push_name: pushName }
  const isGeneric = !info.name || info.name === phone || /^\d+$/.test(info.name)
  if (isGeneric) updates.name = pushName
  updates.updated_at = new Date().toISOString()
  let { error } = await supabase.from('contacts').update(updates).eq('id', contactId)
  if (error && /push_name/.test(error.message || '')) {
    delete updates.push_name
    ;({ error } = await supabase.from('contacts').update(updates).eq('id', contactId))
  }
  if (!error) {
    info.pushName = pushName
    if (updates.name) info.name = updates.name
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Método não permitido. Use POST.' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const centrosCustoId = body.centros_custo_id || null
    const action = body.action || 'messages'
    const skip = Number.isFinite(Number(body.skip)) ? Math.max(0, Number(body.skip)) : 0
    const page = Number.isFinite(Number(body.page)) && Number(body.page) >= 1
      ? Math.floor(Number(body.page))
      : (skip > 0 ? Math.floor(skip / PAGE_SIZE) + 1 : 1)

    if (!centrosCustoId) {
      return json({ success: false, error: 'Informe centros_custo_id' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!
    const apiUrl = (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '')
    const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') || ''

    if (!apiUrl || !apiKey) {
      return json({ success: false, error: 'EVOLUTION_API_URL / EVOLUTION_GLOBAL_API_KEY não configurados' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: config, error: cfgError } = await supabase
      .from('whatsapp_config')
      .select('id, provider_config, status, centros_custo_id, membro_id')
      .eq('provider', 'evolution_api')
      .eq('status', 'connected')
      .eq('centros_custo_id', centrosCustoId)
      .limit(1)
      .maybeSingle()

    if (cfgError) {
      return json({ success: false, error: `Erro ao buscar configuração: ${cfgError.message}` }, 500)
    }
    if (!config) {
      return json({ success: false, error: 'WhatsApp não conectado para este centro de custo' }, 400)
    }

    const instanceName = config?.provider_config?.instanceName
    if (!instanceName) {
      return json({ success: false, error: 'instanceName não encontrado na configuração' }, 400)
    }
    const ccId = config.centros_custo_id || centrosCustoId
    const membroCfgId = config.membro_id || null
    const enc = encodeURIComponent(instanceName)
    const warnings: string[] = []

    if (action === 'probe') {
      const baseSkip = skip
      const variants: { label: string; body: Record<string, any> }[] = [
        { label: 'take/skip', body: { where: {}, take: 50, skip: baseSkip } },
        { label: 'page/offset', body: { where: {}, page: Math.floor(baseSkip / 50) + 1, offset: 0 } },
        { label: 'page/take', body: { where: {}, page: Math.floor(baseSkip / 50) + 1, take: 50 } },
        { label: 'skip/orderByAsc', body: { where: {}, take: 50, skip: baseSkip, orderBy: { messageTimestamp: 'asc' } } },
        { label: 'take200/skip', body: { where: {}, take: 200, skip: baseSkip } },
        { label: 'number/offset', body: { where: {}, number: 50, offset: baseSkip } },
      ]
      const results: any[] = []
      for (const v of variants) {
        try {
          const { data, path } = await evoRequest(apiUrl, apiKey, [], [
            { method: 'POST', path: `/chat/findMessages/${enc}`, body: v.body },
          ], 30000)
          const recs = asList(data, ['records', 'messages', 'instance', 'data'])
          results.push({
            label: v.label,
            path,
            n: recs.length,
            first: String(recs[0]?.key?.id || ''),
            last: String(recs[recs.length - 1]?.key?.id || ''),
            total: Number(data?.messages?.total ?? data?.total ?? 0),
            pages: Number(data?.messages?.pages ?? data?.pages ?? 0),
            currentPage: Number(data?.messages?.currentPage ?? data?.currentPage ?? 0),
          })
        } catch (e) {
          results.push({ label: v.label, error: e instanceof Error ? e.message : String(e) })
        }
      }
      return json({ success: true, action: 'probe', baseSkip, results })
    }

    if (action === 'chats') {
      const maps = await loadTenantMaps(supabase, ccId, membroCfgId)
      const attempts: { method: string; path: string; status: number }[] = []
      let chatsProcessed = 0
      let createdContacts = 0
      let createdConversations = 0
      try {
        const { data, path } = await evoRequest(apiUrl, apiKey, attempts, [
          { method: 'POST', path: `/chat/findChats/${enc}`, body: { take: 1000, skip: 0 } },
          { method: 'GET', path: `/chat/findChats/${enc}` },
        ], 45000)
        const chats = asList(data, ['chats', 'records', 'instance', 'data'])
        console.log('[history] Chats retornados:', chats.length, '| rota:', `${data ? path : '—'}`)

        for (const chat of chats) {
          const rawId = String(chat?.id || chat?.jid || chat?.remoteJid || chat?.phone || '')
          if (!rawId) continue
          const isGroupChat = rawId.includes('@g.us') || chat?.isGroup === true || chat?.isGroupChat === true
          const jid = isGroupChat
            ? normalizeGroupJid(rawId)
            : (rawId.includes('@') ? rawId : `${jidToPhone(rawId)}@s.whatsapp.net`)
          if (!jid || jid.startsWith('@')) continue
          try {
            if (isGroupChat) {
              const subject = String(chat?.name || chat?.subject || chat?.pushName || '').trim()
              let contactId = maps.groupByJid.get(jid)
              if (!contactId) {
                contactId = await findOrCreateGroupContact(supabase, membroCfgId, ccId, jid, subject)
                maps.groupByJid.set(jid, contactId)
                maps.contactById.set(contactId, { name: subject, pushName: '', leadId: null })
                createdContacts++
              } else if (subject) {
                const info = maps.contactById.get(contactId)
                if (info && info.name !== subject) {
                  await supabase
                    .from('contacts')
                    .update({ name: subject, updated_at: new Date().toISOString() })
                    .eq('id', contactId)
                  info.name = subject
                }
              }
              if (!maps.convByContact.has(contactId)) {
                const newConvId = await findOrCreateConversation(supabase, membroCfgId, ccId, contactId, '', null, true, jid)
                maps.convByContact.set(contactId, newConvId)
                maps.convById.set(newConvId, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null })
                createdConversations++
              }
            } else {
              const phone = jidToPhone(jid)
              if (!phone) continue
              const pushName = String(chat?.name || chat?.pushName || '').trim()
              let contactId = maps.contactByPhone.get(phone)
              if (!contactId) {
                contactId = await findOrCreateContact(supabase, membroCfgId, ccId, phone, pushName)
                maps.contactByPhone.set(phone, contactId)
                maps.contactById.set(contactId, { name: pushName || phone, pushName, leadId: null })
                createdContacts++
              } else {
                const info = maps.contactById.get(contactId)
                if (info) await maybeUpdateContact(supabase, contactId, info, phone, pushName)
              }
              if (!maps.convByContact.has(contactId)) {
                const newConvId = await findOrCreateConversation(supabase, membroCfgId, ccId, contactId, '', null, false, null)
                maps.convByContact.set(contactId, newConvId)
                maps.convById.set(newConvId, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null })
                createdConversations++
              }
            }
            chatsProcessed++
          } catch (chatErr) {
            warnings.push(`chat(${jid}): ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`findChats: ${msg}`)
        console.warn('[history] findChats indisponível:', msg)
      }

      return json({ success: true, action: 'chats', chatsProcessed, createdContacts, createdConversations, warnings: warnings.slice(0, 20) })
    }

    const attempts: { method: string; path: string; status: number }[] = []
    const { data: msgData, path: msgPath, method: msgMethod } = await evoRequest(apiUrl, apiKey, attempts, [
      { method: 'POST', path: `/chat/findMessages/${enc}`, body: { where: {}, page, take: PAGE_SIZE } },
      { method: 'POST', path: `/chat/findMessages/${enc}`, body: { where: {}, page } },
      { method: 'POST', path: `/chat/findMessages/${enc}`, body: { where: {}, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE } },
    ])

    const records = asList(msgData, ['records', 'messages', 'instance', 'data'])
    const total = Number(
      msgData?.messages?.total ?? msgData?.total ?? msgData?.instance?.total ?? 0
    ) || 0

    const { data: leadsRows } = await supabase
      .from('leads')
      .select('id, telefone, centro_custo_id')
      .not('telefone', 'is', null)
      .is('deleted_at', null)
    const leads = leadsRows || []

    const findLeadForPhone = (phoneDigits: string): string | null => {
      if (!phoneDigits) return null
      let fallback: string | null = null
      for (const l of leads) {
        const ld = digits(l.telefone)
        if (!ld) continue
        if (l.centro_custo_id && l.centro_custo_id !== ccId) continue
        if (ld === phoneDigits) return l.id
        if (!fallback && phonesMatch(ld, phoneDigits)) fallback = l.id
      }
      return fallback
    }

    const maps = await loadTenantMaps(supabase, ccId, membroCfgId)
    const contactIdFor = async (jid: string, pushName: string): Promise<{ contactId: string; isGroup: boolean; phone: string } | null> => {
      const isGroup = jid.includes('@g.us')
      if (isGroup) {
        const g = normalizeGroupJid(jid)
        let contactId = maps.groupByJid.get(g)
        if (!contactId) {
          contactId = await findOrCreateGroupContact(supabase, membroCfgId, ccId, g, '')
          maps.groupByJid.set(g, contactId)
          maps.contactById.set(contactId, { name: '', pushName: '', leadId: null })
        }
        return { contactId, isGroup: true, phone: g }
      }
      const phone = jidToPhone(jid)
      if (!phone) return null
      let contactId = maps.contactByPhone.get(phone)
      if (!contactId) {
        contactId = await findOrCreateContact(supabase, membroCfgId, ccId, phone, pushName)
        maps.contactByPhone.set(phone, contactId)
        maps.contactById.set(contactId, { name: pushName || phone, pushName, leadId: null })
        return { contactId, isGroup: false, phone }
      }
      const info = maps.contactById.get(contactId)
      if (info && pushName && !info.pushName) {
        await maybeUpdateContact(supabase, contactId, info, phone, pushName)
      }
      return { contactId, isGroup: false, phone }
    }

    const conversationIdFor = async (contactId: string, contentText: string, isGroup: boolean, jid: string): Promise<string> => {
      const existing = maps.convByContact.get(contactId)
      if (existing) return existing
      const newConvId = await findOrCreateConversation(
        supabase, membroCfgId, ccId, contactId, contentText || '', null, isGroup, isGroup ? jid : null,
      )
      maps.convByContact.set(contactId, newConvId)
      maps.convById.set(newConvId, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null })
      return newConvId
    }

    const toImport: any[] = []
    const seenIds = new Set<string>()
    for (const rec of records) {
      const key = rec?.key || {}
      const remoteJid = String(key.remoteJid || '')
      const msgId = String(key.id || '')
      if (!remoteJid || !msgId || seenIds.has(msgId)) continue
      const message = rec?.message || {}
      if (message.protocolMessage && (message.protocolMessage.type === 'REVOKE' || message.protocolMessage.type === 0)) continue
      seenIds.add(msgId)
      toImport.push(rec)
    }

    let imported = 0
    const existingIds = new Set<string>()
    for (let i = 0; i < toImport.length; i += 100) {
      const chunk = toImport.slice(i, i + 100).map(r => String(r.key.id))
      const { data: existingRows } = await supabase
        .from('messages')
        .select('message_id')
        .in('message_id', chunk)
      for (const row of existingRows || []) {
        if (row.message_id) existingIds.add(row.message_id)
      }
    }

    const convUpdates = new Map<string, { text: string; at: string }>()
    const contactPhones = new Map<string, string>()
    const linkConvIds = new Set<string>()
    const toInsert: Record<string, any>[] = []
    let skipped = 0

    for (const rec of toImport) {
      const key = rec.key || {}
      const remoteJid = String(key.remoteJid || '')
      const msgId = String(key.id || '')
      if (existingIds.has(msgId)) { skipped++; continue }

      const fromMe = key.fromMe === true
      const pushName = String(rec.pushName || rec.pushname || '')
      const isGroup = remoteJid.includes('@g.us')
      const target = await contactIdFor(remoteJid, pushName)
      if (!target) { skipped++; continue }

      const { contentType, contentText, mediaUrl, mimeType, mediaPreview } = extractMessageContent(rec.message || {})
      const conversationId = await conversationIdFor(target.contactId, contentText, isGroup, remoteJid)

      const participantJid = (isGroup && !fromMe) ? String(key.participant || rec.participant || '') : ''
      const senderName = participantJid ? pushName : ''
      const senderPhone = participantJid ? jidToPhone(participantJid) : ''
      const { quotedMessageId, quotedContent, quotedSender } = extractQuotedInfo(rec.message || {})
      const createdAt = tsToIso(rec.messageTimestamp ?? rec.timestamp)

      toInsert.push({
        conversation_id: conversationId,
        membro_id: membroCfgId,
        sender_type: fromMe ? 'member' : 'contact',
        content_type: contentType,
        content_text: contentText || '',
        media_url: mediaUrl || '',
        mime_type: mimeType || null,
        message_id: msgId,
        status: fromMe ? 'sent' : 'delivered',
        sender_jid: participantJid || null,
        sender_name: senderName || null,
        sender_phone: senderPhone || null,
        quoted_message_id: quotedMessageId || null,
        quoted_content: quotedContent || null,
        quoted_sender: quotedSender || null,
        media_preview: mediaPreview || null,
        created_at: createdAt,
      })

      const current = convUpdates.get(conversationId)
      if (!current || createdAt > current.at) {
        convUpdates.set(conversationId, {
          text: contentText || (
            contentType === 'image' ? '[Imagem]' :
            contentType === 'audio' ? '[Áudio]' :
            contentType === 'video' ? '[Vídeo]' :
            contentType === 'document' ? '[Documento]' :
            contentType === 'sticker' ? '[Figurinha]' :
            contentType === 'location' ? '[Localização]' : ''
          ),
          at: createdAt,
        })
      }

      if (!isGroup) {
        contactPhones.set(target.contactId, target.phone)
        linkConvIds.add(conversationId)
      }
    }

    for (let i = 0; i < toInsert.length; i += 50) {
      let chunk = toInsert.slice(i, i + 50)
      let { error: insErr } = await supabase.from('messages').insert(chunk)
      let guard = 0
      while (insErr && guard < 8) {
        guard++
        const missing = /(sender_jid|sender_name|sender_phone|quoted_message_id|quoted_content|quoted_sender|media_preview)/.exec(insErr.message || '')
        if (!missing) break
        const col = missing[1]
        chunk = chunk.map(p => { const c = { ...p }; delete c[col]; return c })
        ;({ error: insErr } = await supabase.from('messages').insert(chunk))
      }
      if (insErr) {
        if (/duplicate|23505/.test(insErr.message || '')) {
          for (const payload of chunk) {
            const { error: rowErr } = await supabase.from('messages').insert([payload])
            if (rowErr) {
              if (/duplicate|23505/.test(rowErr.message || '')) skipped++
              else warnings.push(`msg(${payload.message_id}): ${rowErr.message}`)
            } else imported++
          }
          continue
        }
        warnings.push(`insert mensagens: ${insErr.message}`)
        continue
      }
      imported += chunk.length
    }

    let linked = 0
    const nowIso = new Date().toISOString()
    const leadForContact = new Map<string, string>()
    if (contactPhones.size > 0) {
      const { data: cRows } = await supabase.from('contacts').select('id, lead_id').in('id', [...contactPhones.keys()])
      for (const row of cRows || []) {
        let leadId: string | null = row.lead_id || null
        if (!leadId) {
          const found = findLeadForPhone(digits(contactPhones.get(row.id) || ''))
          if (found) {
            const { error } = await supabase
              .from('contacts')
              .update({ lead_id: found, updated_at: nowIso })
              .eq('id', row.id)
            if (!error) {
              linked++
              leadId = found
              const info = maps.contactById.get(row.id)
              if (info) info.leadId = found
            }
          }
        }
        if (leadId) leadForContact.set(row.id, leadId)
      }
    }
    if (linkConvIds.size > 0) {
      const { data: cvRows } = await supabase.from('conversations').select('id, contact_id, lead_id').in('id', [...linkConvIds])
      for (const row of cvRows || []) {
        if (row.lead_id) continue
        const leadId = leadForContact.get(row.contact_id)
        if (!leadId) continue
        const { error } = await supabase
          .from('conversations')
          .update({ lead_id: leadId, updated_at: nowIso })
          .eq('id', row.id)
        if (!error) {
          const meta = maps.convById.get(String(row.id))
          if (meta) meta.leadId = leadId
        }
      }
    }

    if (convUpdates.size > 0) {
      const { data: cvRows } = await supabase
        .from('conversations')
        .select('id, last_message_at')
        .in('id', [...convUpdates.keys()])
      const fresh = new Map<string, string>()
      for (const r of cvRows || []) fresh.set(String(r.id), r.last_message_at || '')
      for (const [convId, upd] of convUpdates) {
        const currentAt = fresh.get(convId) ?? ''
        if (upd.at >= currentAt) {
          const { error: upErr } = await supabase
            .from('conversations')
            .update({ last_message_text: upd.text, last_message_at: upd.at, updated_at: new Date().toISOString() })
            .eq('id', convId)
          if (upErr) warnings.push(`conv(${convId}): ${upErr.message}`)
        }
      }
    }

    const processed = (page - 1) * PAGE_SIZE + records.length
    const pages = Number(msgData?.messages?.pages ?? msgData?.pages ?? 0) || 0
    const done = records.length === 0 || (pages > 0 ? page >= pages : (total > 0 && processed >= total))

    console.log('[history] Página:', { page, records: records.length, imported, skipped, total, pages, done })

    return json({
      success: true,
      action: 'messages',
      page,
      nextPage: page + 1,
      pages,
      processed,
      pageRecords: records.length,
      total,
      imported,
      skipped,
      linked,
      done,
      sampleIdFirst: String(records[0]?.key?.id || ''),
      sampleIdLast: String(records[records.length - 1]?.key?.id || ''),
      routeUsed: `${msgMethod} ${msgPath}`,
      attempts: attempts.map(a => `${a.method} ${a.path} → ${a.status}`),
      warnings: warnings.slice(0, 20),
    })
  } catch (err) {
    console.error('[history] Erro geral:', err)
    const e: any = err
    return json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      evolutionStatus: e?.evolutionStatus || null,
      evolutionBody: e?.evolutionBody || null,
      triedRoutes: e?.triedRoutes || null,
    }, 500)
  }
})

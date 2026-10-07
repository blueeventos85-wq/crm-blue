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

type ChatJid = { jid: string; isGroup: boolean; ok: boolean }

function resolveChatJid(chat: any): ChatJid {
  const candidates = [chat?.remoteJid, chat?.jid, chat?.phone]
    .map(c => String(c || ''))
    .filter(Boolean)
  const isGroupFlag = chat?.isGroup === true || chat?.isGroupChat === true
  const groupRaw = candidates.find(c => c.includes('@g.us'))
  if (groupRaw) return { jid: normalizeGroupJid(groupRaw), isGroup: true, ok: true }
  if (isGroupFlag) return { jid: '', isGroup: true, ok: false }
  const direct = candidates.find(c => c.endsWith('@s.whatsapp.net'))
  if (direct) return { jid: direct, isGroup: false, ok: true }
  const alts = [chat?.remoteJidAlt, chat?.lastMessage?.key?.remoteJidAlt]
    .map(c => String(c || ''))
    .filter(Boolean)
  const alt = alts.find(c => c.endsWith('@s.whatsapp.net'))
  if (alt) return { jid: alt, isGroup: false, ok: true }
  const bare = candidates
    .filter(c => !c.includes('@'))
    .find(c => /^\+?\d{10,15}$/.test(c))
  if (bare) return { jid: `${digits(bare)}@s.whatsapp.net`, isGroup: false, ok: true }
  const anyAt = candidates.find(c => c.includes('@'))
  if (anyAt) return { jid: anyAt, isGroup: false, ok: true }
  return { jid: '', isGroup: false, ok: false }
}

function resolveMessagePhone(jid: string, altJid: string): string {
  const cleanJid = String(jid || '')
  const cleanAlt = String(altJid || '')
  if (cleanJid.endsWith('@s.whatsapp.net') || !cleanJid.includes('@')) {
    return jidToPhone(cleanJid)
  }
  if (cleanAlt.endsWith('@s.whatsapp.net')) return jidToPhone(cleanAlt)
  if (cleanJid.includes('@')) return jidToPhone(cleanJid)
  return ''
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
): Promise<{ id: string; created: boolean }> {
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
    return { id: existing.id, created: false }
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
  return { id: newContact.id, created: true }
}

async function findOrCreateGroupContact(
  supabase: any,
  membroId: string | null,
  centrosCustoId: string | null,
  groupJid: string,
  groupName: string,
): Promise<{ id: string; created: boolean }> {
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
    return { id: existing.id, created: false }
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
  return { id: newContact.id, created: true }
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
  remoteJid: string | null = null,
): Promise<{ id: string; created: boolean; remoteJid: string }> {
  let query = supabase
    .from('conversations')
    .select('id, lead_id, last_message_at, remote_jid')
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
    return { id: existing.id, created: false, remoteJid: existing.remote_jid || '' }
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
  } else if (remoteJid) {
    insertPayload.remote_jid = remoteJid
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
  return { id: newConv.id, created: true, remoteJid: (isGroup ? groupJid : remoteJid) || '' }
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
  convById: Map<string, { contactId: string; status: string; membroId: string | null; lastMessageAt: string; leadId: string | null; remoteJid: string; groupName: string }>
}

async function fetchTenantRows(
  supabase: any,
  table: string,
  select: string,
  ccId: string,
): Promise<{ data: any[] | null; error: any }> {
  const pageSize = 1000
  const rows: any[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('centros_custo_id', ccId)
      .range(from, from + pageSize - 1)
    if (error) return { data: rows.length ? rows : null, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { data: rows, error: null }
}

async function loadTenantMaps(supabase: any, ccId: string, membroId: string | null): Promise<TenantMaps> {
  const maps: TenantMaps = {
    contactByPhone: new Map(),
    groupByJid: new Map(),
    contactById: new Map(),
    convByContact: new Map(),
    convById: new Map(),
  }
  const { data: contactRows, error: cErr } = await fetchTenantRows(supabase, 'contacts', 'id, phone, name, push_name, is_group, group_jid, lead_id', ccId)
  if (cErr) throw new Error('Falha ao carregar contatos do tenant: ' + cErr.message)
  for (const r of contactRows || []) {
    if (r.is_group && r.group_jid) maps.groupByJid.set(r.group_jid, r.id)
    const pd = digits(r.phone)
    if (!r.is_group && pd) maps.contactByPhone.set(pd, r.id)
    maps.contactById.set(r.id, { name: r.name || '', pushName: r.push_name || '', leadId: r.lead_id || null })
  }
  let { data: convRows, error: vErr } = await fetchTenantRows(supabase, 'conversations', 'id, contact_id, status, membro_id, lead_id, last_message_at, remote_jid, group_name', ccId)
  if (vErr && /(remote_jid|group_name)/.test(vErr.message || '')) {
    ;({ data: convRows, error: vErr } = await fetchTenantRows(supabase, 'conversations', 'id, contact_id, status, membro_id, lead_id, last_message_at', ccId))
  }
  if (vErr) throw new Error('Falha ao carregar conversas do tenant: ' + vErr.message)
  for (const r of convRows || []) {
    const id = String(r.id)
    maps.convById.set(id, {
      contactId: r.contact_id,
      status: r.status || '',
      membroId: r.membro_id || null,
      lastMessageAt: r.last_message_at || '',
      leadId: r.lead_id || null,
      remoteJid: r.remote_jid || '',
      groupName: r.group_name || '',
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

    if (action === 'probe_raw') {
      const out: Record<string, any> = {}
      try {
        const { data } = await evoRequest(apiUrl, apiKey, [], [
          { method: 'POST', path: `/chat/findMessages/${enc}`, body: { where: { key: { id: String(body.message_id || '') } }, take: 1 } },
        ], 30000)
        const recs = asList(data, ['records', 'messages', 'instance', 'data'])
        out.messageRecord = JSON.stringify(recs[0] || null).substring(0, 2500)
      } catch (e) {
        out.messageError = e instanceof Error ? e.message : String(e)
      }
      try {
        const { data } = await evoRequest(apiUrl, apiKey, [], [
          { method: 'POST', path: `/chat/findChats/${enc}`, body: { take: 1000, skip: 0 } },
        ], 45000)
        const chats = asList(data, ['chats', 'records', 'instance', 'data'])
        const gid = (c: any) => String(c?.remoteJid || c?.jid || c?.id || '')
        const groups = chats.filter((c: any) => gid(c).includes('@g.us') || c?.isGroup === true || c?.isGroupChat === true)
        out.groupChats = JSON.stringify(groups.slice(0, 2)).substring(0, 1500)
        out.individualChat = JSON.stringify(chats.find((c: any) => !gid(c).includes('@g.us') && c?.isGroup !== true) || null).substring(0, 800)
        out.groupCount = groups.length
        out.chatCount = chats.length
        const stats = { ok: 0, group: 0, directSwh: 0, viaAlt: 0, viaBare: 0, fail: 0, failLidNoAlt: 0, failNoJidField: 0, failOther: 0 }
        const failSamples: any[] = []
        for (const c of chats) {
          const r = resolveChatJid(c)
          if (r.ok) {
            stats.ok++
            if (r.isGroup) stats.group++
            else if (String(c?.remoteJid || '').endsWith('@s.whatsapp.net')) stats.directSwh++
            else if ((c?.lastMessage?.key?.remoteJidAlt || c?.remoteJidAlt)) stats.viaAlt++
            else stats.viaBare++
          } else {
            stats.fail++
            const raw = String(c?.remoteJid || c?.jid || '')
            if (raw.includes('@lid')) stats.failLidNoAlt++
            else if (!raw) stats.failNoJidField++
            else stats.failOther++
            if (failSamples.length < 2) failSamples.push(JSON.stringify(c).substring(0, 600))
          }
        }
        out.jidStats = stats
        out.failSamples = failSamples
      } catch (e) {
        out.chatsError = e instanceof Error ? e.message : String(e)
      }
      try {
        const { data, path } = await evoRequest(apiUrl, apiKey, [], [
          { method: 'POST', path: `/group/findGroups/${enc}`, body: {} },
          { method: 'GET', path: `/group/findGroups/${enc}` },
        ], 30000)
        const groupsList = asList(data, ['groups', 'records', 'instance', 'data'])
        out.findGroupsPath = path
        out.findGroupsCount = groupsList.length
        out.findGroupsSample = JSON.stringify(groupsList.slice(0, 2)).substring(0, 1200)
      } catch (e) {
        out.findGroupsError = e instanceof Error ? e.message : String(e)
      }
      return json({ success: true, action: 'probe_raw', out })
    }

    if (action === 'repair_contacts') {
      const { data, path } = await evoRequest(apiUrl, apiKey, [], [
        { method: 'POST', path: `/chat/findChats/${enc}`, body: { take: 1000, skip: 0 } },
        { method: 'GET', path: `/chat/findChats/${enc}` },
      ], 45000)
      const chats = asList(data, ['chats', 'records', 'instance', 'data'])
      let fixedPhone = 0
      let fixedName = 0
      let groupNameFixed = 0
      let notFound = 0
      let skippedNoJid = 0

      for (const chat of chats) {
        const resolved = resolveChatJid(chat)
        if (!resolved.ok) { skippedNoJid++; continue }
        const { jid, isGroup } = resolved
        try {
          if (isGroup) {
            const gname = String(chat?.subject || chat?.name || chat?.pushName || '').trim()
            if (!gname) continue
            const { data: gRows } = await supabase
              .from('contacts')
              .select('id, name')
              .eq('group_jid', jid)
              .eq('is_group', true)
              .eq('centros_custo_id', ccId)
            for (const row of gRows || []) {
              const cur = String(row.name || '').trim()
              if (cur === gname) continue
              const { error } = await supabase
                .from('contacts')
                .update({ name: gname, updated_at: new Date().toISOString() })
                .eq('id', row.id)
              if (error) warnings.push(`groupContact(${row.id}): ${error.message}`)
              else groupNameFixed++
            }
            const { data: cvRows } = await supabase
              .from('conversations')
              .select('id, group_name')
              .eq('group_jid', jid)
              .eq('centros_custo_id', ccId)
            for (const row of cvRows || []) {
              if (String(row.group_name || '') === gname) continue
              const { error } = await supabase
                .from('conversations')
                .update({ group_name: gname, updated_at: new Date().toISOString() })
                .eq('id', row.id)
              if (error) warnings.push(`convGroup(${row.id}): ${error.message}`)
              else groupNameFixed++
            }
            continue
          }

          const phone = digits(jidToPhone(jid))
          if (!phone || phone.length < 8) { skippedNoJid++; continue }
          const lmPush = String(chat?.lastMessage?.pushName || '')
          const lmName = (lmPush && !/^\d{4,}$/.test(lmPush) && lmPush !== 'Você') ? lmPush : ''
          const name = String(chat?.name || chat?.pushName || '').trim() || lmName
          const lastMsgId = String(chat?.lastMessage?.key?.id || '')
          let contactRow: Record<string, any> | null = null

          if (lastMsgId) {
            const { data: mRow } = await supabase
              .from('messages')
              .select('conversation_id')
              .eq('message_id', lastMsgId)
              .limit(1)
              .maybeSingle()
            if (mRow?.conversation_id) {
              const { data: cvRow } = await supabase
                .from('conversations')
                .select('id, contact_id')
                .eq('id', mRow.conversation_id)
                .limit(1)
                .maybeSingle()
              if (cvRow?.contact_id) {
                const { data: cRow } = await supabase
                  .from('contacts')
                  .select('id, phone, name, push_name')
                  .eq('id', cvRow.contact_id)
                  .limit(1)
                  .maybeSingle()
                contactRow = cRow || null
              }
            }
          }
          if (!contactRow) {
            const { data: cRow } = await supabase
              .from('contacts')
              .select('id, phone, name, push_name')
              .eq('centros_custo_id', ccId)
              .eq('is_group', false)
              .eq('phone', phone)
              .limit(1)
              .maybeSingle()
            contactRow = cRow || null
          }
          if (!contactRow) { notFound++; continue }

          const curPhone = digits(contactRow.phone)
          const phoneInvalid = curPhone.length < 10 || curPhone.length >= 14
          const updates: Record<string, any> = {}
          if (phoneInvalid && phone !== curPhone) updates.phone = phone
          const curName = String(contactRow.name || '').trim()
          const nameGeneric = !curName || curName === curPhone || /^\d{4,}$/.test(curName)
          if (name && nameGeneric && name !== phone) updates.name = name
          if (name && /^\d{4,}$/.test(String(contactRow.push_name || '')) && !/^\d{4,}$/.test(name)) updates.push_name = name

          if (Object.keys(updates).length) {
            updates.updated_at = new Date().toISOString()
            const { error } = await supabase.from('contacts').update(updates).eq('id', contactRow.id)
            if (error) warnings.push(`contact(${contactRow.id}): ${error.message}`)
            else {
              if (updates.phone) fixedPhone++
              if (updates.name || updates.push_name) fixedName++
            }
          }
        } catch (chatErr) {
          warnings.push(`repair(${jid}): ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`)
        }
      }

      return json({ success: true, action: 'repair_contacts', path, chats: chats.length, fixedPhone, fixedName, groupNameFixed, notFound, skippedNoJid, warnings: warnings.slice(0, 20) })
    }

    if (action === 'chats') {
      const maps = await loadTenantMaps(supabase, ccId, membroCfgId)
      const attempts: { method: string; path: string; status: number }[] = []
      let chatsProcessed = 0
      let createdContacts = 0
      let createdConversations = 0
      let skippedNoJid = 0
      const convMeta = new Map<string, Record<string, any>>()
      const touchedConvIds = new Set<string>()
      const rememberConv = (convId: string, contactId: string) => {
        touchedConvIds.add(convId)
        if (!maps.convById.has(convId)) {
          maps.convById.set(convId, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null, remoteJid: '', groupName: '' })
        }
      }
      try {
        const { data, path } = await evoRequest(apiUrl, apiKey, attempts, [
          { method: 'POST', path: `/chat/findChats/${enc}`, body: { take: 1000, skip: 0 } },
          { method: 'GET', path: `/chat/findChats/${enc}` },
        ], 45000)
        const chats = asList(data, ['chats', 'records', 'instance', 'data'])
        console.log('[history] Chats retornados:', chats.length, '| rota:', `${data ? path : '—'}`)

        for (const chat of chats) {
          const resolved = resolveChatJid(chat)
          if (!resolved.ok) { skippedNoJid++; continue }
          const { jid, isGroup } = resolved
          try {
            if (isGroup) {
              const subject = String(chat?.name || chat?.subject || chat?.pushName || '').trim()
              let contactId = maps.groupByJid.get(jid)
              if (!contactId) {
                const gContact = await findOrCreateGroupContact(supabase, membroCfgId, ccId, jid, subject)
                contactId = gContact.id
                maps.groupByJid.set(jid, contactId)
                maps.contactById.set(contactId, { name: subject, pushName: '', leadId: null })
                if (gContact.created) createdContacts++
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
                const convRes = await findOrCreateConversation(supabase, membroCfgId, ccId, contactId, '', null, true, jid)
                maps.convByContact.set(contactId, convRes.id)
                maps.convById.set(convRes.id, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null, remoteJid: convRes.remoteJid, groupName: subject })
                if (convRes.created) createdConversations++
              }
              const convId = maps.convByContact.get(contactId)
              if (convId) {
                rememberConv(convId, contactId)
                const meta = maps.convById.get(convId)!
                if (subject && meta.groupName !== subject) {
                  convMeta.set(convId, { group_name: subject })
                  meta.groupName = subject
                }
              }
            } else {
              const phone = digits(jidToPhone(jid))
              if (!phone || phone.length < 8) { skippedNoJid++; continue }
              const pushName = String(chat?.name || chat?.pushName || '').trim()
              let contactId = maps.contactByPhone.get(phone)
              if (!contactId) {
                const contactRes = await findOrCreateContact(supabase, membroCfgId, ccId, phone, pushName)
                contactId = contactRes.id
                maps.contactByPhone.set(phone, contactId)
                maps.contactById.set(contactId, { name: pushName || phone, pushName, leadId: null })
                if (contactRes.created) createdContacts++
              } else {
                const info = maps.contactById.get(contactId)
                if (info) await maybeUpdateContact(supabase, contactId, info, phone, pushName)
              }
              if (!maps.convByContact.has(contactId)) {
                const convRes = await findOrCreateConversation(supabase, membroCfgId, ccId, contactId, '', null, false, null, jid)
                maps.convByContact.set(contactId, convRes.id)
                maps.convById.set(convRes.id, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null, remoteJid: convRes.remoteJid, groupName: '' })
                if (convRes.created) createdConversations++
              }
              const convId = maps.convByContact.get(contactId)
              if (convId) {
                rememberConv(convId, contactId)
                const meta = maps.convById.get(convId)!
                if (meta.remoteJid !== jid) {
                  convMeta.set(convId, { remote_jid: jid })
                  meta.remoteJid = jid
                }
              }
            }
            chatsProcessed++
          } catch (chatErr) {
            warnings.push(`chat(${jid}): ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`)
          }
        }

        let metaUpdated = 0
        for (const [convId, patch] of convMeta) {
          const { error } = await supabase
            .from('conversations')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', convId)
          if (error) warnings.push(`convMeta(${convId}): ${error.message}`)
          else metaUpdated++
        }

        let refreshed = 0
        const touched = [...touchedConvIds]
        for (let i = 0; i < touched.length; i += 200) {
          const chunk = touched.slice(i, i + 200)
          const { error } = await supabase.rpc('refresh_conversation_last_message', { p_ids: chunk })
          if (error) warnings.push(`refresh: ${error.message}`)
          else refreshed += chunk.length
        }

        return json({ success: true, action: 'chats', chatsProcessed, createdContacts, createdConversations, skippedNoJid, metaUpdated, refreshed, warnings: warnings.slice(0, 20) })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnings.push(`findChats: ${msg}`)
        console.warn('[history] findChats indisponível:', msg)
        return json({ success: true, action: 'chats', chatsProcessed, createdContacts, createdConversations, skippedNoJid, warnings: warnings.slice(0, 20) })
      }
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
    const convMetaPatches = new Map<string, Record<string, any>>()
    const contactIdFor = async (jid: string, pushName: string, altJid: string): Promise<{ contactId: string; isGroup: boolean; phone: string } | null> => {
      const isGroup = jid.includes('@g.us')
      if (isGroup) {
        const g = normalizeGroupJid(jid)
        let contactId = maps.groupByJid.get(g)
        if (!contactId) {
          contactId = (await findOrCreateGroupContact(supabase, membroCfgId, ccId, g, '')).id
          maps.groupByJid.set(g, contactId)
          maps.contactById.set(contactId, { name: '', pushName: '', leadId: null })
        }
        return { contactId, isGroup: true, phone: g }
      }
      const phone = resolveMessagePhone(jid, altJid)
      if (!phone || phone.length < 8) return null
      let contactId = maps.contactByPhone.get(phone)
      if (!contactId) {
        contactId = (await findOrCreateContact(supabase, membroCfgId, ccId, phone, pushName)).id
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
      if (existing) {
        const meta = maps.convById.get(existing)
        if (meta && !isGroup && jid && meta.remoteJid !== jid) {
          convMetaPatches.set(existing, { remote_jid: jid })
          meta.remoteJid = jid
        }
        return existing
      }
      const convRes = await findOrCreateConversation(
        supabase, membroCfgId, ccId, contactId, contentText || '', null, isGroup, isGroup ? jid : null, isGroup ? null : jid,
      )
      maps.convByContact.set(contactId, convRes.id)
      maps.convById.set(convRes.id, { contactId, status: 'open', membroId: membroCfgId, lastMessageAt: '', leadId: null, remoteJid: convRes.remoteJid || '', groupName: '' })
      if (!isGroup && jid && (convRes.remoteJid || '') !== jid) {
        convMetaPatches.set(convRes.id, { remote_jid: jid })
      }
      return convRes.id
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
    const senderRepair = new Map<string, { name: string | null; jid: string | null; phone: string | null }>()
    const toInsert: Record<string, any>[] = []
    let skipped = 0

    for (const rec of toImport) {
      const key = rec.key || {}
      const remoteJid = String(key.remoteJid || '')
      const msgId = String(key.id || '')
      if (existingIds.has(msgId)) {
        skipped++
        if (remoteJid.includes('@g.us') && key.fromMe !== true) {
          const gPush = String(rec.pushName || rec.pushname || '')
          const gPart = String(key.participant || rec.participant || '')
          const nameOk = !!gPush && !/^\d{4,}$/.test(gPush) && gPush !== 'Você'
          const partPhone = gPart.endsWith('@s.whatsapp.net') ? jidToPhone(gPart) : ''
          const partJid = gPart || null
          if (nameOk || partPhone || (gPart && gPart.includes('@'))) {
            senderRepair.set(msgId, {
              name: nameOk ? gPush : null,
              jid: partJid,
              phone: partPhone || null,
            })
          }
        }
        continue
      }

      const fromMe = key.fromMe === true
      const pushName = String(rec.pushName || rec.pushname || '')
      const isGroup = remoteJid.includes('@g.us')
      const target = await contactIdFor(remoteJid, pushName, String(key.remoteJidAlt || ''))
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

    let senderRepaired = 0
    if (senderRepair.size > 0) {
      const ids = [...senderRepair.keys()]
      for (let i = 0; i < ids.length; i += 100) {
        const chunkIds = ids.slice(i, i + 100)
        const { data: rows } = await supabase
          .from('messages')
          .select('id, message_id, sender_name, sender_jid, sender_phone')
          .in('message_id', chunkIds)
        for (const row of rows || []) {
          const p = senderRepair.get(String(row.message_id))
          if (!p) continue
          const patch: Record<string, any> = {}
          if (!row.sender_name && p.name) patch.sender_name = p.name
          if (!row.sender_jid && p.jid) patch.sender_jid = p.jid
          if (!row.sender_phone && p.phone) patch.sender_phone = p.phone
          if (!Object.keys(patch).length) continue
          const { error } = await supabase.from('messages').update(patch).eq('id', row.id)
          if (error) warnings.push(`senderRepair(${row.message_id}): ${error.message}`)
          else senderRepaired++
        }
      }
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

    let metaUpdated = 0
    for (const [convId, patch] of convMetaPatches) {
      const { error } = await supabase
        .from('conversations')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', convId)
      if (error) warnings.push(`convMeta(${convId}): ${error.message}`)
      else metaUpdated++
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
      senderRepaired,
      metaUpdated,
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

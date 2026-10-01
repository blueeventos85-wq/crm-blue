import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ──

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Extrai phone (só dígitos) de um JID tipo '5511999998888@s.whatsapp.net' */
function jidToPhone(jid: string): string {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

/** Garante sufixo @g.us em IDs de grupo */
function normalizeGroupJid(id: string): string {
  const s = String(id || '')
  if (!s) return ''
  return s.includes('@') ? s : `${s}@g.us`
}

/** Nome está vazio, é o telefone ou só dígitos? */
function isGenericName(name: string, phone: string): boolean {
  const n = String(name || '').trim()
  return !n || n === phone || /^\d{6,}$/.test(n)
}

/** GET/POST na Evolution com fallback de rotas (404/405 → próxima) */
async function evoRequest(
  apiUrl: string,
  apiKey: string,
  attempts: { method: string; path: string; status: number }[],
  routes: { method: string; path: string; body?: unknown }[],
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
        signal: AbortSignal.timeout(30000),
      })
    } catch (fetchErr) {
      attempts.push({ method: route.method, path: route.path, status: -1 })
      console.error('[sync] Fetch falhou:', route.method, route.path, fetchErr)
      continue
    }
    attempts.push({ method: route.method, path: route.path, status: res.status })
    if (res.status === 404 || res.status === 405) {
      console.log('[sync] Rota inexistente (vou tentar a próxima):', route.method, route.path, res.status)
      continue
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const err: any = new Error(`Evolution API respondeu HTTP ${res.status} em ${route.method} ${route.path}`)
      err.evolutionStatus = res.status
      err.evolutionBody = bodyText.substring(0, 500)
      err.evolutionRoute = route.path
      err.evolutionMethod = route.method
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

/**
 * Busca a foto de perfil de um contato (Evolution v2.3.7):
 *   POST /chat/fetchProfilePictureUrl/{instance}  body: { number }
 *   → { profilePictureUrl: 'https://...' }
 * Nunca lança: contatos sem foto (404/nulo/erro) retornam null e não travam a rotina.
 */
async function fetchProfilePictureUrl(
  apiUrl: string,
  apiKey: string,
  enc: string,
  number: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/chat/fetchProfilePictureUrl/${enc}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data: any = await res.json().catch(() => null)
    const url = typeof data === 'string' ? data : (data?.profilePictureUrl || data?.url || null)
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null
  } catch {
    return null
  }
}

/** Normaliza a resposta variável da Evolution para uma lista */
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
    // Objeto único (ex: retorno de findContacts com um contato)
    if (data.id || data.jid || data.phone) return [data]
  }
  return []
}

// ── Handler ──

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
    const membroId = body.membro_id || null

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

    // 1. Resolver a instância ativa (evolution_api conectada)
    if (!centrosCustoId && !membroId) {
      return json({ success: false, error: 'Informe centros_custo_id ou membro_id' }, 400)
    }
    let cfgQuery = supabase
      .from('whatsapp_config')
      .select('id, provider_config, status, centros_custo_id, membro_id')
      .eq('provider', 'evolution_api')
      .eq('status', 'connected')
    if (centrosCustoId) cfgQuery = cfgQuery.eq('centros_custo_id', centrosCustoId)
    else cfgQuery = cfgQuery.eq('membro_id', membroId)
    const { data: config, error: cfgError } = await cfgQuery.limit(1).maybeSingle()

    if (cfgError) {
      console.error('[sync] Erro ao buscar config:', cfgError)
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
    const membroCfgId = config.membro_id || membroId
    const enc = encodeURIComponent(instanceName)
    console.log('[sync] Instância:', instanceName, '| cc:', ccId)

    const warnings: string[] = []
    let groupsCount = 0
    let contactsCount = 0
    let avatarsFetched = 0
    let groupsError: any = null
    let contactsError: any = null
    const avatarTargets: { id: string; phone: string }[] = []
    let avatarColMissing = false

    // ── 2. GRUPOS: GET /group/fetchAllGroups/{instance}?getParticipants=true ──
    // getParticipants=true traz o array participants (jid/admin) e pictureUrl (avatar).
    const groupAttempts: { method: string; path: string; status: number }[] = []
    try {
      const { data, path } = await evoRequest(apiUrl, apiKey, groupAttempts, [
        { method: 'GET', path: `/group/fetchAllGroups/${enc}?getParticipants=true` },
        { method: 'GET', path: `/group/fetchAllGroups/${enc}?getParticipants=false` },
        { method: 'GET', path: `/group/fetchAllGroups/${enc}` },
      ])
      const groups = asList(data, ['groups', 'instance', 'data'])
      console.log('[sync] Grupos retornados:', groups.length, '| rota:', `GET ${path}`)

      for (const g of groups) {
        const jid = normalizeGroupJid(g?.id || g?.jid || g?.remoteJid || '')
        const subject = String(g?.subject || g?.title || g?.name || '').trim()
        if (!jid || !subject) continue
        const pic: string | null =
          g?.pictureUrl || g?.imgUrl || g?.profilePicUrl || g?.picture || g?.avatar || null
        // Participantes: [{ id|jid, admin: true|'admin'|'superadmin'|false }]
        const rawParticipants: any[] = Array.isArray(g?.participants)
          ? g.participants
          : Array.isArray(g?.metadata?.participants)
            ? g.metadata.participants
            : []
        const participants = rawParticipants
          .map((p: any) => ({
            jid: String(p?.id || p?.jid || p?.participant || ''),
            admin: p?.admin === true || p?.admin === 'admin' || p?.admin === 'superadmin',
          }))
          .filter((p: any) => !!p.jid)
        const groupMetadata: Record<string, any> | null = participants.length
          ? { participants }
          : null
        const now = new Date().toISOString()

        // ── contacts: atualizar TODAS as linhas com esse group_jid (cópias por membro)
        let groupContactId: string | null = null
        let findRes = await supabase
          .from('contacts')
          .select('id, name, profile_pic_url, avatar_url')
          .eq('group_jid', jid)
          .eq('is_group', true)
        // Resiliência: migração de avatar_url pendente → repetir select sem a coluna
        if (findRes.error && /avatar_url/.test(findRes.error.message || '')) {
          findRes = await supabase
            .from('contacts')
            .select('id, name, profile_pic_url')
            .eq('group_jid', jid)
            .eq('is_group', true)
        }
        const { data: existingRows, error: findErr } = findRes

        if (findErr) {
          warnings.push(`contacts(${jid}): ${findErr.message}`)
          continue
        }

        if (existingRows && existingRows.length > 0) {
          groupContactId = existingRows[0].id
          for (const row of existingRows) {
            const updates: Record<string, any> = {}
            if (row.name !== subject) updates.name = subject
            if (pic && row.profile_pic_url !== pic) updates.profile_pic_url = pic
            if (pic && row.avatar_url !== pic) updates.avatar_url = pic
            if (Object.keys(updates).length > 0) {
              updates.updated_at = now
              let { error: upErr } = await supabase.from('contacts').update(updates).eq('id', row.id)
              // Resiliência: migração de avatar_url ainda não aplicada
              if (upErr && /avatar_url/.test(upErr.message || '')) {
                delete updates.avatar_url
                const retry = await supabase.from('contacts').update(updates).eq('id', row.id)
                upErr = retry.error
              }
              if (upErr) warnings.push(`contacts(${jid}): ${upErr.message}`)
              else groupsCount++
            } else {
              groupsCount++
            }
          }
        } else if (ccId || membroCfgId) {
          // Inserir contato-grupo novo
          const insertPayload: Record<string, any> = {
            phone: jid,
            name: subject,
            is_group: true,
            group_jid: jid,
            profile_pic_url: pic,
            avatar_url: pic,
            created_at: now,
            updated_at: now,
          }
          if (ccId) insertPayload.centros_custo_id = ccId
          if (membroCfgId) insertPayload.membro_id = membroCfgId
          let { data: newGC, error: insErr } = await supabase
            .from('contacts')
            .insert([insertPayload])
            .select('id')
            .maybeSingle()
          // Resiliência: migração de avatar_url pendente → inserir sem a coluna
          if (insErr && /avatar_url/.test(insErr.message || '')) {
            delete insertPayload.avatar_url
            ;({ data: newGC, error: insErr } = await supabase
              .from('contacts')
              .insert([insertPayload])
              .select('id')
              .maybeSingle())
          }
          if (insErr) warnings.push(`Novo grupo ${jid}: ${insErr.message}`)
          else {
            groupContactId = newGC?.id || null
            groupsCount++
          }
        }

        // ── conversations:
        // UPDATE ... SET group_name, title, avatar_url, metadata
        //       WHERE (group_jid = item.id OR remote_jid = item.id)
        // Se nenhuma linha existir → INSERT (grupo novo na base).
        // Loop resiliente: remove colunas opcionais ausentes (migração pendente)
        // e cai para WHERE só por group_jid se remote_jid não existir.
        let convUpdate: Record<string, any> = {
          group_name: subject,
          title: subject,
          updated_at: now,
        }
        if (pic) convUpdate.avatar_url = pic
        if (groupMetadata) convUpdate.metadata = groupMetadata
        let useSimpleWhere = false
        let convRes: { error: any; data: any } = { error: null, data: null }
        for (let i = 0; i < 5; i++) {
          let q = supabase.from('conversations').update(convUpdate)
          q = useSimpleWhere
            ? q.eq('group_jid', jid)
            : q.or(`group_jid.eq.${jid},remote_jid.eq.${jid}`)
          convRes = await q.select('id')
          if (!convRes.error) break
          const msg = convRes.error.message || ''
          const missing = ['avatar_url', 'metadata', 'title'].find(c => new RegExp(`\\b${c}\\b`).test(msg))
          if (missing) { delete convUpdate[missing]; continue }
          if (!useSimpleWhere && /\bremote_jid\b/.test(msg)) { useSimpleWhere = true; continue }
          break
        }

        if (convRes.error) {
          warnings.push(`conversations(${jid}): ${convRes.error.message}`)
        } else if (!convRes.data || convRes.data.length === 0) {
          // Grupo ainda não tem conversa → inserir registro
          if (groupContactId && (ccId || membroCfgId)) {
            const insertConv: Record<string, any> = {
              contact_id: groupContactId,
              status: 'open',
              unread_count: 0,
              last_message_text: '',
              group_jid: jid,
              remote_jid: jid,
              group_name: subject,
              title: subject,
              is_group: true,
              created_at: now,
              updated_at: now,
            }
            if (pic) insertConv.avatar_url = pic
            if (groupMetadata) insertConv.metadata = groupMetadata
            if (ccId) insertConv.centros_custo_id = ccId
            if (membroCfgId) insertConv.membro_id = membroCfgId

            // Insert resiliente: remove colunas opcionais ausentes (migração pendente)
            const optionalCols = ['is_group', 'title', 'remote_jid', 'avatar_url', 'metadata']
            let insConvErr: any = null
            for (let i = 0; i <= optionalCols.length; i++) {
              const res = await supabase.from('conversations').insert([insertConv])
              insConvErr = res.error
              if (!insConvErr) break
              const missing = optionalCols.find(col => new RegExp(`\\b${col}\\b`).test(insConvErr.message || ''))
              if (missing) { delete insertConv[missing]; continue }
              break
            }
            if (insConvErr) warnings.push(`Nova conversa de grupo ${jid}: ${insConvErr.message}`)
            else {
              groupsCount++
              console.log('[sync] Conversa de grupo criada:', { jid, subject })
            }
          } else {
            warnings.push(`Sem conversa para ${jid} (falta contact_id/tenant)`)
          }
        }
      }
    } catch (err) {
      groupsError = err
      console.error('[sync] Erro na sincronização de grupos:', err.message, err.triedRoutes || '')
    }

    // ── 3. CONTATOS: cascata de rotas (POST /chat/findContacts → GETs legados) ──
    const contactAttempts: { method: string; path: string; status: number }[] = []
    try {
      const { data, path } = await evoRequest(apiUrl, apiKey, contactAttempts, [
        { method: 'POST', path: `/chat/findContacts/${enc}`, body: {} },
        { method: 'GET', path: `/chat/findContacts/${enc}` },
        { method: 'GET', path: `/chat/whatsapp-contacts/${enc}` },
        { method: 'GET', path: `/contact/findAll/${enc}` },
      ])
      const waContacts = asList(data, ['contacts', 'instance', 'data'])
      console.log('[sync] Contatos retornados:', waContacts.length, '| rota:', `${path}`)

      for (const c of waContacts) {
        const jid = String(c?.id || c?.jid || c?.phone || '')
        const phone = jidToPhone(jid)
        const pushName = String(c?.pushName || c?.pushname || c?.name || '').trim()
        if (!phone || !pushName || isGenericName(pushName, phone)) continue
        if (!ccId && !membroCfgId) {
          warnings.push(`contato ${phone}: sem tenant (cc/membro) para busca`)
          continue
        }

        let contactQuery = supabase
          .from('contacts')
          .select('id, name, push_name')
          .eq('phone', phone)
          .eq('is_group', false)
          .limit(1)
        if (ccId) {
          contactQuery = contactQuery.or(`centros_custo_id.eq.${ccId},centros_custo_id.is.null`)
        } else {
          contactQuery = contactQuery.eq('membro_id', membroCfgId)
        }
        const { data: rows, error: findErr } = await contactQuery
        if (findErr) {
          warnings.push(`contato ${phone}: ${findErr.message}`)
          continue
        }
        const row = rows && rows[0]
        if (!row) continue // spec: atualizar apenas contatos já existentes no CRM

        // Alvo para busca de avatar (mesmo sem mudanças de nome)
        avatarTargets.push({ id: row.id, phone })

        const updates: Record<string, any> = {}
        if (row.push_name !== pushName) updates.push_name = pushName
        if (isGenericName(row.name, phone)) updates.name = pushName
        if (Object.keys(updates).length === 0) continue

        updates.updated_at = new Date().toISOString()
        let { error: upErr } = await supabase.from('contacts').update(updates).eq('id', row.id)
        if (upErr && /push_name/.test(upErr.message || '')) {
          // Migração de push_name ainda não aplicada — tentar só o name
          delete updates.push_name
          const retry = await supabase.from('contacts').update(updates).eq('id', row.id)
          upErr = retry.error
        }
        if (upErr) warnings.push(`contato ${phone}: ${upErr.message}`)
        else contactsCount++
      }

      // ── 3b. AVATARES: POST /chat/fetchProfilePictureUrl/{instance} ──
      // Lotes de 5, cap de 200 por sync; sem foto (404/nulo) → ignora.
      const AVATAR_CAP = 200
      const targets = avatarTargets.slice(0, AVATAR_CAP)
      if (avatarTargets.length > AVATAR_CAP) {
        warnings.push(`avatares: limite de ${AVATAR_CAP} por sync (total: ${avatarTargets.length})`)
      }
      for (let i = 0; i < targets.length && !avatarColMissing; i += 5) {
        const batch = targets.slice(i, i + 5)
        await Promise.all(batch.map(async (t) => {
          const url = await fetchProfilePictureUrl(apiUrl, apiKey, enc, t.phone)
          if (!url) return
          const { error } = await supabase
            .from('contacts')
            .update({ avatar_url: url, updated_at: new Date().toISOString() })
            .eq('id', t.id)
          if (error) {
            // Migração de avatar_url pendente → parar as próximas chamadas
            if (/avatar_url/.test(error.message || '')) { avatarColMissing = true; return }
            warnings.push(`avatar(${t.phone}): ${error.message}`)
            return
          }
          avatarsFetched++
        }))
      }
      console.log('[sync] Avatares buscados:', avatarsFetched, '/', targets.length, avatarColMissing ? '(avatar_url pendente)' : '')
    } catch (err) {
      contactsError = err
      console.error('[sync] Erro na sincronização de contatos:', err.message, err.triedRoutes || '')
    }

    // ── 4. Resultado ──
    if (groupsError && contactsError) {
      const e: any = groupsError
      return json({
        success: false,
        error: e.message || 'Falha ao sincronizar grupos e contatos',
        evolutionStatus: e.evolutionStatus || contactsError.evolutionStatus || null,
        evolutionBody: e.evolutionBody || contactsError.evolutionBody || null,
        triedRoutes: e.triedRoutes || contactsError.triedRoutes || [
          ...groupAttempts.map(a => `${a.method} ${a.path} → ${a.status}`),
          ...contactAttempts.map(a => `${a.method} ${a.path} → ${a.status}`),
        ],
        groupsCount: 0,
        contactsCount: 0,
      }, 502)
    }

    console.log('[sync] Concluído:', { groupsCount, contactsCount, warnings: warnings.length })

    return json({
      success: true,
      instanceName,
      groupsCount,
      contactsCount,
      avatarsFetched,
      warnings: warnings.slice(0, 20),
      groupsRoute: groupAttempts.length ? `GET ${groupAttempts.find(a => a.status >= 200 && a.status < 300)?.path || '—'}` : null,
      contactsRoute: contactAttempts.length ? `${contactAttempts.find(a => a.status >= 200 && a.status < 300)?.method || '—'} ${contactAttempts.find(a => a.status >= 200 && a.status < 300)?.path || '—'}` : null,
      partialError: groupsError?.message || contactsError?.message || null,
    })
  } catch (err) {
    console.error('[sync] Erro geral:', err)
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

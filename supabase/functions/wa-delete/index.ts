import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { conversationId, messageId, scope = 'me' } = body

    if (!conversationId || !messageId || (scope !== 'me' && scope !== 'all')) {
      return json({ error: 'conversationId, messageId e scope (me|all) são obrigatórios' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Variáveis SUPABASE não configuradas' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Buscar a mensagem
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, message_id, membro_id')
      .eq('id', messageId)
      .maybeSingle()

    if (msgError) {
      console.error('[delete] Erro ao buscar mensagem:', msgError)
    }
    if (!message) {
      return json({ error: 'Mensagem não encontrada' }, 404)
    }
    if (message.conversation_id !== conversationId) {
      return json({ error: 'Mensagem não pertence à conversa informada' }, 400)
    }

    // 2. Revogar na API (scope 'all')
    if (scope === 'all') {
      if (!message.message_id) {
        return json({ error: 'Mensagem sem identificador externo (message_id)' }, 400)
      }

      const apiUrl = Deno.env.get('EVOLUTION_API_URL') || ''
      const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') || ''
      if (!apiUrl || !apiKey) {
        return json({ error: 'EVOLUTION_API_URL e EVOLUTION_GLOBAL_API_KEY devem estar configuradas' }, 500)
      }

      // 2a. Conversa + contato (telefone ou JID de grupo)
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id, contact_id, centros_custo_id')
        .eq('id', conversationId)
        .maybeSingle()

      if (!conversation) {
        return json({ error: 'Conversa não encontrada' }, 404)
      }

      const { data: contact } = await supabase
        .from('contacts')
        .select('id, phone, is_group, group_jid')
        .eq('id', conversation.contact_id)
        .maybeSingle()

      const isGroup = !!contact?.is_group
      let remoteJid = ''
      if (isGroup) {
        let jid = String(contact?.group_jid || '').trim()
        if (jid && !jid.includes('@')) jid = `${jid}@g.us`
        remoteJid = jid
        if (!remoteJid.endsWith('@g.us')) {
          console.error('[delete] ✗ JID de grupo inválido:', JSON.stringify(remoteJid))
          return json({ error: `JID de grupo inválido: "${remoteJid || '(vazio)'}" — esperado terminar em @g.us` }, 400)
        }
      } else {
        const rawPhone = contact?.phone || ''
        const phone = rawPhone.replace(/\D/g, '')
        if (!phone) {
          return json({ error: 'Telefone do contato não encontrado' }, 404)
        }
        const number = phone.startsWith('55') ? phone : `55${phone}`
        remoteJid = `${number}@s.whatsapp.net`
        if (!remoteJid.endsWith('@s.whatsapp.net')) {
          console.error('[delete] ✗ remoteJid inválido:', JSON.stringify(remoteJid))
          return json({ error: `remoteJid inválido: "${remoteJid}" — esperado terminar em @s.whatsapp.net` }, 400)
        }
      }
      console.log('[delete] remoteJid:', remoteJid)

      // 2b. Config WhatsApp (provider + instância)
      const effectiveCCId = conversation.centros_custo_id
      let configQuery = supabase
        .from('whatsapp_config')
        .select('id, provider, provider_config, status, centros_custo_id, membro_id')
        .eq('status', 'connected')

      if (effectiveCCId) {
        configQuery = configQuery.eq('centros_custo_id', effectiveCCId)
      } else if (message.membro_id) {
        configQuery = configQuery.eq('membro_id', message.membro_id)
      }

      const { data: configs } = await configQuery
      const config = (configs || []).find((c: Record<string, unknown>) =>
        c.provider === 'evolution_api',
      ) || (configs || [])[0]

      if (!config) {
        return json({ error: 'WhatsApp não conectado para este centro de custo' }, 400)
      }

      const provider = (config as Record<string, any>).provider
      if (provider !== 'evolution_api') {
        return json({
          error: 'revoke_unsupported',
          message: 'A Meta Cloud API não suporta apagar para todos. Use "Apagar para mim".',
        }, 422)
      }

      const instanceName = (config as Record<string, any>).provider_config?.instanceName
      if (!instanceName) {
        return json({ error: 'InstanceName não encontrado na config' }, 400)
      }

      // 2c. Validar que message_id é o ID NATIVO do WhatsApp (não o UUID interno do banco)
      const nativeId = String(message.message_id)
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      console.log('[delete] IDs:', { dbId: message.id, storedMessageId: nativeId })
      if (uuidRe.test(nativeId) || nativeId === String(message.id) || nativeId.length < 4 || nativeId === 'true' || nativeId === 'false') {
        console.error('[delete] ✗ message_id não é o ID nativo do WhatsApp:', nativeId)
        return json({
          error: 'message_id inválido: o banco contém o UUID interno, não o ID nativo do WhatsApp (ex.: BAE5… ou 3EB0…)',
          dbId: message.id,
          storedMessageId: nativeId,
        }, 400)
      }

      // 2d. Cascata de rotas canônicas da Evolution API (até uma retornar 2xx)
      // Rota 1: Evolution v2 (message controller)
      // Rota 2: Evolution v2 alternativa (chat controller)
      // Rota 3: Evolution v1 legado (chat controller)
      const encodedInstance = encodeURIComponent(instanceName)
      const evoHeaders = { 'apikey': apiKey, 'Content-Type': 'application/json' }
      const payload = { id: nativeId, remoteJid, fromMe: true }
      const routes = [
        `/message/delete/${encodedInstance}`,
        `/chat/deleteMessage/${encodedInstance}`,
        `/chat/deleteMessageForEveryone/${encodedInstance}`,
      ]

      type Attempt = { method: string; route: string; status: number; ok: boolean; body: string }
      const attempts: Attempt[] = []

      const tryRoute = async (url: string, route: string, method: string): Promise<Attempt> => {
        const resp = await fetch(url, {
          method,
          headers: evoHeaders,
          body: JSON.stringify(payload),
        })
        const text = await resp.text()
        return { method, route, status: resp.status, ok: resp.ok, body: text }
      }

      let finalResult: Attempt | null = null

      try {
        for (const route of routes) {
          const url = `${apiUrl}${route}`

          let result = await tryRoute(url, route, 'DELETE')
          attempts.push(result)

          if (result.status === 404 || result.status === 405) {
            // Express/NestJS responde 404 quando o método não está registrado na rota → tenta POST
            const postResult = await tryRoute(url, route, 'POST')
            attempts.push(postResult)
            if (postResult.status !== 404 && postResult.status !== 405) {
              finalResult = postResult
              break
            }
            continue // DELETE e POST ambos 404/405 → próxima rota
          }

          finalResult = result
          break // 2xx ou erro real (rota existe: 400/401/500…)
        }
      } catch (fetchErr) {
        console.error('[delete] ✗ Fetch exception:', fetchErr, '| Tentativas:', attempts.map(a => `${a.method} ${a.route} → ${a.status}`))
        return json({
          error: 'Falha ao conectar com Evolution API',
          details: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          triedRoutes: attempts.map(a => `${a.method} ${a.route} → ${a.status}`),
        }, 502)
      }

      const triedRoutes = attempts.map(a => `${a.method} ${a.route} → ${a.status}`)
      console.log('[delete] Rotas tentadas:', triedRoutes)

      if (!finalResult || finalResult.status === 404 || finalResult.status === 405) {
        console.error('[delete] ✗ TODAS as rotas retornaram 404/405:', {
          instanceName,
          encodedInstance,
          payload,
          triedRoutes,
          lastBody: finalResult?.body || '',
        })
        return json({
          error: 'Nenhuma rota de exclusão existe nesta Evolution API (todas retornaram 404)',
          instanceName,
          triedRoutes,
          evolutionStatus: finalResult?.status || 404,
          evolutionBody: (finalResult?.body || '').substring(0, 1000),
        }, 404)
      }

      console.log(`[delete] ← Evolution API (${finalResult.method} ${finalResult.route}):`, {
        status: finalResult.status,
        ok: finalResult.ok,
        body: finalResult.body.substring(0, 500),
      })

      if (!finalResult.ok) {
        console.error('[delete] ✗ Erro EXATO da Evolution API:', {
          method: finalResult.method,
          route: finalResult.route,
          payload: { ...payload },
          status: finalResult.status,
          body: finalResult.body,
          triedRoutes,
        })
        return json({
          error: `Evolution API recusou a exclusão (HTTP ${finalResult.status})`,
          evolutionMethod: finalResult.method,
          evolutionRoute: finalResult.route,
          evolutionStatus: finalResult.status,
          evolutionBody: finalResult.body.substring(0, 1000),
          triedRoutes,
        }, 409)
      }

      let revokeData: Record<string, any>
      try { revokeData = JSON.parse(finalResult.body) } catch { revokeData = {} }
      if (revokeData?.success === false) {
        console.error('[delete] ✗ Evolution API retornou success:false:', revokeData)
        return json({
          error: 'Evolution API retornou success=false',
          evolutionMethod: finalResult.method,
          evolutionRoute: finalResult.route,
          evolutionStatus: finalResult.status,
          evolutionBody: String(revokeData?.message || revokeData?.error || finalResult.body).substring(0, 1000),
          triedRoutes,
        }, 409)
      }

      console.log('[delete] ✓ Revogado via', `${finalResult.method} ${finalResult.route}`)
    }

    // 3. DELETE físico da linha (service role, contorna RLS)
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)

    if (deleteError) {
      console.error('[delete] Erro ao remover mensagem:', deleteError)
      return json({ error: 'Erro ao remover mensagem do histórico', details: deleteError.message }, 500)
    }

    console.log('[delete] ✓ Mensagem removida:', { messageId, scope })
    return json({ success: true, scope })
  } catch (err) {
    console.error('[delete] ERRO GERAL:', err instanceof Error ? err.message : String(err))
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

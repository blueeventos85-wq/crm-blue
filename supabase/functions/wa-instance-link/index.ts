import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ============================================================
   wa-instance-link — vincula uma instância JÁ EXISTENTE na
   Evolution API a um centro de custo (empresa), registra o
   webhook da evolution-webhook e grava/atualiza whatsapp_config.
   Uso: conectar a "crm gisele" à Blue PRO sem re-parear QR.
   ============================================================ */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Normaliza nome de instância para comparações tolerantes a
// encoding ("crm%20gisele"), espaços extras e caixa ("CRM Gisele").
function normInstance(raw: unknown): string {
  let s = String(raw ?? '').trim()
  try {
    s = decodeURIComponent(s).trim()
  } catch {
    // valor não é escape válido — mantém como está
  }
  return s.replace(/\s+/g, ' ').toLowerCase()
}

const WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'CHATS_UPSERT',
  'GROUPS_UPDATE',
  'CONTACTS_UPDATE'
]

/* Mapeia o state da Evolution para o status do banco. */
function mapStatus(state: string | null | undefined): 'connected' | 'disconnected' | 'connecting' {
  const s = String(state || '').toLowerCase()
  if (s === 'open') return 'connected'
  if (s === 'connecting' || s === 'qr') return 'connecting'
  return 'disconnected'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── 1. Parse do body ──
  let membroId: string | null = null
  let centrosCustoId: string | null = null
  let instanceName = ''
  let numero = ''

  try {
    const body = await req.json()
    membroId = body.membroId || null
    centrosCustoId = body.centrosCustoId || null
    instanceName = String(body.instanceName || '').trim()
    numero = String(body.numero || '').trim()
  } catch {
    return jsonResp({ error: 'Corpo da requisição inválido (JSON esperado)', success: false }, 400)
  }

  if (!instanceName) {
    return jsonResp({ error: 'instanceName é obrigatório', success: false }, 400)
  }

  // ── 2. Variáveis de ambiente ──
  const apiUrl = Deno.env.get('EVOLUTION_API_URL')
  const apiKey = Deno.env.get('EVOLUTION_GLOBAL_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')

  if (!apiUrl || !apiKey) {
    return jsonResp({
      error: 'Variáveis EVOLUTION_API_URL e EVOLUTION_GLOBAL_API_KEY não configuradas no servidor',
      success: false
    }, 500)
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResp({
      error: 'Variáveis SUPABASE_URL e SERVICE_ROLE_KEY não configuradas no servidor',
      success: false
    }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // ── 3. Estado atual da instância na Evolution ──
  let evolutionState = ''
  try {
    const stateResponse = await fetch(`${apiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
      headers: { 'apikey': apiKey }
    })

    if (stateResponse.status === 404) {
      return jsonResp({
        error: `Instância "${instanceName}" não encontrada na Evolution API. Confira o nome exato (ex.: "crm gisele") ou crie a instância primeiro.`,
        success: false
      }, 404)
    }

    if (!stateResponse.ok) {
      const errText = await stateResponse.text().catch(() => 'Erro desconhecido')
      // Algumas versões da Evolution não têm /connectionState — tenta /instance/info
      const infoResponse = await fetch(`${apiUrl}/instance/info/${encodeURIComponent(instanceName)}`, {
        method: 'GET',
        headers: { 'apikey': apiKey }
      })
      if (!infoResponse.ok) {
        return jsonResp({
          error: `Não foi possível consultar a instância "${instanceName}" na Evolution API (HTTP ${stateResponse.status}): ${errText}`,
          success: false
        }, 502)
      }
      const infoData = await infoResponse.json().catch(() => ({})) as Record<string, unknown>
      const infoInstance = (infoData.instance || infoData) as Record<string, unknown>
      evolutionState = String(infoInstance.state || '')
    } else {
      const stateData = await stateResponse.json().catch(() => ({})) as Record<string, unknown>
      const stateInstance = (stateData.instance || stateData) as Record<string, unknown>
      evolutionState = String(stateInstance.state || '')
    }
  } catch (fetchErr) {
    console.error('[link] Erro de conexão com Evolution API:', fetchErr)
    return jsonResp({
      error: `Não foi possível consultar a Evolution API: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      success: false
    }, 502)
  }

  const status = mapStatus(evolutionState)
  console.log('[link] Instância:', instanceName, '| state Evolution:', evolutionState, '| status:', status)

  // ── 4. Conflitos de vínculo no banco ──
  const { data: configs, error: listErr } = await supabase
    .from('whatsapp_config')
    .select('id, membro_id, centros_custo_id, provider_config')
    .eq('provider', 'evolution_api')

  if (listErr) {
    console.error('[link] Erro ao listar configs:', listErr.message)
    return jsonResp({ error: `Falha ao consultar configs: ${listErr.message}`, success: false }, 500)
  }

  const todas = configs || []
  const mesmaInstancia = todas.find(c => normInstance(c.provider_config?.instanceName) === normInstance(instanceName)) || null

  if (mesmaInstancia && mesmaInstancia.centros_custo_id && centrosCustoId &&
      mesmaInstancia.centros_custo_id !== centrosCustoId) {
    const { data: outraEmpresa } = await supabase
      .from('centros_custo')
      .select('nome')
      .eq('id', mesmaInstancia.centros_custo_id)
      .maybeSingle()
    return jsonResp({
      error: `A instância "${instanceName}" já está vinculada à empresa "${outraEmpresa?.nome || 'outra'}". Desvincule-a lá antes de reatribuir.`,
      success: false
    }, 409)
  }

  // Se o CC de destino ainda não veio no body, usa o da instância existente
  if (!centrosCustoId && mesmaInstancia?.centros_custo_id) {
    centrosCustoId = mesmaInstancia.centros_custo_id
  }
  if (!centrosCustoId && !mesmaInstancia?.centros_custo_id) {
    return jsonResp({
      error: 'centrosCustoId é obrigatório para vincular uma instância nova',
      success: false
    }, 400)
  }

  const ocupada = todas.find(c =>
    c.centros_custo_id === centrosCustoId && normInstance(c.provider_config?.instanceName) !== normInstance(instanceName)
  ) || null

  if (ocupada) {
    const nomeOcupante = ocupada.provider_config?.instanceName || '?'
    return jsonResp({
      error: `Esta empresa já possui a instância "${nomeOcupante}". Desvincule ou remova-a antes de vincular "${instanceName}".`,
      success: false
    }, 409)
  }

  // ── 5. Registrar webhook apontando para a evolution-webhook ──
  try {
    const hookResponse = await fetch(`${apiUrl}/instance/setWebhook`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // instanceName no body: versões da Evolution aplicam o webhook por
        // instância; espaços no nome (ex.: "crm gisele") são tolerados aqui
        // porque o corpo é JSON (não URL).
        instanceName,
        webhook: {
          enabled: true,
          url: `${supabaseUrl}/functions/v1/evolution-webhook`,
          byEvents: false,
          base64: false,
          events: WEBHOOK_EVENTS
        }
      })
    })

    if (!hookResponse.ok) {
      const errText = await hookResponse.text().catch(() => 'Erro desconhecido')
      console.error('[link] Erro ao registrar webhook:', hookResponse.status, errText)
      // Não aborta: o vínculo no banco é mais importante; o usuário pode
      // re-tocar "Sincronizar webhook" depois. Avisa no retorno.
    } else {
      console.log('[link] Webhook registrado em', instanceName)
    }
  } catch (hookErr) {
    console.error('[link] Falha ao chamar setWebhook:', hookErr)
  }

  // ── 6. Gravar/atualizar whatsapp_config ──
  let configId: string | null = mesmaInstancia?.id || null
  try {
    const providerConfig = {
      ...((mesmaInstancia?.provider_config as Record<string, unknown>) || {}),
      instanceName,
      integration: ((mesmaInstancia?.provider_config as Record<string, unknown>)?.integration as string) || 'WHATSAPP-BAILEYS',
      ...(numero ? { numero } : {})
    }

    if (configId) {
      const { error: upErr } = await supabase
        .from('whatsapp_config')
        .update({
          centros_custo_id: centrosCustoId,
          provider_config: providerConfig,
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', configId)
      if (upErr) throw upErr
    } else {
      const insertPayload: Record<string, unknown> = {
        provider: 'evolution_api',
        provider_config: providerConfig,
        status,
        centros_custo_id: centrosCustoId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      // membro_id como fallback legado (quando a Evolution não traz o dono)
      if (membroId) insertPayload.membro_id = membroId

      const { data: newConfig, error: insErr } = await supabase
        .from('whatsapp_config')
        .insert([insertPayload])
        .select('id')
        .single()
      if (insErr) throw insErr
      configId = newConfig?.id || null
    }
  } catch (dbErr) {
    console.error('[link] Erro ao salvar config:', dbErr)
    return jsonResp({
      error: `Instância consultada com sucesso, mas falha ao gravar no banco: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      success: false
    }, 500)
  }

  return jsonResp({
    success: true,
    configId,
    instanceName,
    centrosCustoId,
    status,
    evolutionState
  })
})

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
    const { contactId, membroId, centrosCustoId } = await req.json()

    console.log('[sync-contact-to-lead] Payload recebido:', { contactId, membroId, centrosCustoId })

    if (!contactId) {
      return new Response(JSON.stringify({ error: 'contactId é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!centrosCustoId && !membroId) {
      return new Response(JSON.stringify({ error: 'centrosCustoId ou membroId é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // 1. Buscar o contato
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, phone, name, centros_custo_id, membro_id, lead_id')
      .eq('id', contactId)
      .maybeSingle()

    if (contactError) {
      console.error('[sync-contact-to-lead] Erro ao buscar contato:', JSON.stringify(contactError, null, 2))
      return new Response(JSON.stringify({ error: contactError.message, code: contactError.code, details: contactError.details, hint: contactError.hint }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!contact) {
      return new Response(JSON.stringify({ error: 'Contato não encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verificar se já tem lead vinculado
    if (contact.lead_id) {
      return new Response(JSON.stringify({ 
        ok: true, 
        leadId: contact.lead_id,
        message: 'Contato já possui lead vinculado' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Usar centros_custo_id do contato se não foi passado
    const effectiveCCId = centrosCustoId || contact.centros_custo_id
    const effectiveMembroId = membroId || contact.membro_id

    if (!effectiveCCId) {
      return new Response(JSON.stringify({ error: 'Não foi possível determinar o centro de custo (empresa)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Buscar a cadência "Novo lead" para essa empresa
    // Buscar cadências vinculadas ao centro de custo
    const { data: vinculos, error: vinculosError } = await supabase
      .from('centro_custo_cadencias')
      .select('cadencia_id')
      .eq('centro_custo_id', effectiveCCId)

    if (vinculosError) {
      console.error('[sync-contact-to-lead] Erro ao buscar vínculos de cadência:', JSON.stringify(vinculosError, null, 2))
    }

    let initialCadenceId: string | null = null

    if (vinculos && vinculos.length > 0) {
      // Buscar a cadência "Novo lead" entre as vinculadas à empresa
      const cadenciaIds = vinculos.map(v => v.cadencia_id)
      const { data: cadencias, error: cadenciasError } = await supabase
        .from('cadencias')
        .select('id, nome')
        .in('id', cadenciaIds)
        .ilike('nome', 'Novo lead')

      if (cadenciasError) {
        console.error('[sync-contact-to-lead] Erro ao buscar cadências vinculadas:', JSON.stringify(cadenciasError, null, 2))
      }

      if (cadencias && cadencias.length > 0) {
        initialCadenceId = cadencias[0].id
        console.log('[sync-contact-to-lead] Cadência "Novo lead" encontrada na empresa:', initialCadenceId)
      }
    }

    // Fallback: buscar a cadência "Novo lead" global (não vinculada a empresa específica)
    if (!initialCadenceId) {
      const { data: novoLeadCadence, error: globalCadenceError } = await supabase
        .from('cadencias')
        .select('id')
        .ilike('nome', 'Novo lead')
        .limit(1)
        .maybeSingle()

      if (globalCadenceError) {
        console.error('[sync-contact-to-lead] Erro ao buscar cadência global:', JSON.stringify(globalCadenceError, null, 2))
      }

      if (novoLeadCadence) {
        initialCadenceId = novoLeadCadence.id
        console.log('[sync-contact-to-lead] Cadência "Novo lead" global encontrada:', initialCadenceId)
      } else {
        console.warn('[sync-contact-to-lead] ATENÇÃO: Nenhuma cadência "Novo lead" encontrada no sistema')
      }
    }

    // 3. Criar o lead
    const leadPayload: Record<string, any> = {
      telefone: contact.phone,
      nome: contact.name || contact.phone,
      centro_custo_id: effectiveCCId,
      created_at: new Date().toISOString()
    }

    // Só adiciona cadencia_id se encontrou uma válida
    if (initialCadenceId) {
      leadPayload.cadencia_id = initialCadenceId
    }

    if (effectiveMembroId) {
      leadPayload.membro_id = effectiveMembroId
    }

    console.log('[sync-contact-to-lead] Payload do lead a ser inserido:', leadPayload)

    const { data: newLead, error: leadError } = await supabase
      .from('leads')
      .insert([leadPayload])
      .select('id')
      .maybeSingle()

    if (leadError) {
      console.error('[sync-contact-to-lead] Erro ao criar lead:', JSON.stringify(leadError, null, 2))
      return new Response(JSON.stringify({ 
        error: leadError.message, 
        code: leadError.code, 
        details: leadError.details, 
        hint: leadError.hint 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const leadId = newLead?.id
    if (!leadId) {
      return new Response(JSON.stringify({ error: 'Falha ao criar lead - nenhum ID retornado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Atualizar contato com lead_id
    const { error: updateContactError } = await supabase
      .from('contacts')
      .update({ lead_id: leadId, updated_at: new Date().toISOString() })
      .eq('id', contactId)

    if (updateContactError) {
      console.error('[sync-contact-to-lead] Erro ao atualizar contato:', JSON.stringify(updateContactError, null, 2))
      // Não falha a operação, apenas loga
    }

    // 5. Atualizar conversa(s) abertas do contato com lead_id
    const { error: updateConvError } = await supabase
      .from('conversations')
      .update({ lead_id: leadId, updated_at: new Date().toISOString() })
      .eq('contact_id', contactId)
      .eq('status', 'open')

    if (updateConvError) {
      console.error('[sync-contact-to-lead] Erro ao atualizar conversa:', JSON.stringify(updateConvError, null, 2))
      // Não falha a operação, apenas loga
    }

    console.log('[sync-contact-to-lead] Lead criado e vinculado com sucesso:', { leadId, contactId, effectiveCCId, effectiveMembroId })

    return new Response(JSON.stringify({ 
      ok: true, 
      leadId,
      message: 'Contato sincronizado como Lead com sucesso' 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[sync-contact-to-lead] Erro não tratado:', err)
    return new Response(JSON.stringify({ 
      error: err.message,
      stack: err.stack,
      name: err.name
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
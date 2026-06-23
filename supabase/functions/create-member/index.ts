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
    const { name, email, password, role, team, pessoa, cpf, birth, phone, notifEmail, notifWhats, notifSound } = await req.json()

    console.log('[create-member] Payload recebido:', { name, email, role, team })

    if (!name || !email || !password) {
      return new Response(JSON.stringify({ error: 'Nome, e-mail e senha são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // 1. Criar usuário NOVO no Supabase Auth (sempre criar novo, não reutilizar existente)
    console.log('[create-member] Criando usuário no Auth...')
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome: name, cargo: role, equipe: team }
    })

    if (authError) {
      console.error('[create-member] Auth error:', authError)
      return new Response(JSON.stringify({ error: `Erro ao criar usuário no Auth: ${authError.message}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const userId = authData.user.id
    console.log('[create-member] Novo usuário criado no Auth:', userId)

    // 2. Inserir registro na tabela membros com o NOVO userId
    const memberPayload = {
      nome: name,
      email,
      cargo: role || '',
      equipe: team || '',
      pessoa: pessoa || 'Pessoa Física',
      cpf: cpf || '',
      data_aniversario: birth,
      telefone: phone || '',
      notificacao_email: notifEmail === 'Sim',
      notificacao_whatsapp: notifWhats === 'Sim',
      notificacao_som: notifSound === 'Sim',
      status: 'Ativo',
      auth_user_id: userId
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('membros')
      .insert([{
        ...memberPayload,
        auth_user_id: userId
      }])
      .select()
      .single()

    if (insertError) {
      // Rollback: deletar usuário do Auth se falhar ao inserir na tabela
      console.error('[create-member] Member insert error:', insertError)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return new Response(JSON.stringify({ error: `Erro ao criar membro: ${insertError.message}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[create-member] Novo membro inserido:', inserted)

    return new Response(JSON.stringify({
      success: true,
      member: inserted,
      authUserId: userId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    const errorDetails = {
      message: err.message,
      name: err.name,
      stack: err.stack,
      cause: err.cause,
      timestamp: new Date().toISOString()
    }
    console.error('[create-member] Function error:', JSON.stringify(errorDetails, null, 2))
    return new Response(JSON.stringify({ error: err.message, details: errorDetails }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
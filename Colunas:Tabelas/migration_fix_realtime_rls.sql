-- ============================================
-- MIGRATION: Corrigir Realtime + RLS para Notificações
-- Causa raiz: RLS de SELECT bloqueia eventos Realtime
-- quando o membro logado ≠ dono da instância WhatsApp.
-- ============================================

-- ============================================
-- PASSO 1: Adicionar tabelas à publicação Realtime
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- ============================================
-- PASSO 2: Policy de SELECT em messages (permissiva por CC)
-- ============================================
DROP POLICY IF EXISTS "messages_select" ON messages;

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
         OR c.centros_custo_id IN (
           SELECT mcc.centro_custo_id
           FROM membro_centros_custo mcc
           WHERE mcc.membro_id = get_current_member_id()
         )
         OR c.membro_id IS NULL
    )
  );

-- ============================================
-- PASSO 3: Policy de SELECT em leads (por CC)
-- ============================================
DROP POLICY IF EXISTS "leads_select_policy" ON leads;

CREATE POLICY "leads_select_policy" ON leads
  FOR SELECT TO authenticated
  USING (
    centro_custo_id IN (
      SELECT mcc.centro_custo_id
      FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR membro_id = get_current_member_id()
    OR is_admin()
  );

-- ============================================
-- PASSO 4: Policy de SELECT em conversations (por CC)
-- ============================================
DROP POLICY IF EXISTS "conversations_select" ON conversations;

CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id
      FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR membro_id IS NULL
    OR is_admin()
  );

-- ============================================
-- VERIFICAÇÃO: Rodar após executar para confirmar
-- ============================================
-- 1. Tabelas na publicação Realtime:
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 2. Policies de SELECT em messages:
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'messages' AND cmd = 'SELECT';

-- 3. Policies de SELECT em leads:
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'leads' AND cmd = 'SELECT';

-- 4. Policies de SELECT em conversations:
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'conversations' AND cmd = 'SELECT';

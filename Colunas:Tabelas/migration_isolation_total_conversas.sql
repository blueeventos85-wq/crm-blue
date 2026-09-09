-- ============================================
-- MIGRATION: Isolamento Total de Conversas
-- Regra: "Meu WhatsApp, meu lead"
-- Cada membro ve APENAS suas proprias conversas.
-- Execute este script no Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. conversations: Recriar todas as policies
-- ============================================
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_insert" ON conversations;
DROP POLICY IF EXISTS "conversations_update" ON conversations;
DROP POLICY IF EXISTS "conversations_delete" ON conversations;

-- SELECT: apenas conversas do proprio membro
CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (membro_id = get_current_member_id());

-- INSERT: so pode criar conversa para si mesmo
CREATE POLICY "conversations_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

-- UPDATE: so pode atualizar suas proprias conversas
CREATE POLICY "conversations_update" ON conversations
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

-- DELETE: so pode deletar suas proprias conversas
CREATE POLICY "conversations_delete" ON conversations
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

-- ============================================
-- 2. messages: Recriar policies (via conversa do membro)
-- ============================================
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;
DROP POLICY IF EXISTS "messages_delete" ON messages;

-- SELECT: apenas mensagens de conversas proprias
CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
    )
  );

-- INSERT: so pode inserir mensagem em conversa propria
CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
    )
  );

-- UPDATE: so pode atualizar mensagens de conversas proprias
CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
    )
  );

-- DELETE: pode deletar mensagens de conversas proprias
CREATE POLICY "messages_delete" ON messages
  FOR DELETE TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
    )
  );

-- ============================================
-- VERIFICACAO: Rodar apos executar para confirmar
-- ============================================
-- 1. Policies de conversations:
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'conversations' ORDER BY policyname;

-- 2. Policies de messages:
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'messages' ORDER BY policyname;

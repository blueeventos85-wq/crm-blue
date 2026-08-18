-- ============================================
-- MIGRAÇÃO: Security Hardening
-- Restringe acesso a dados sensíveis via RLS
--
-- PRIMEIRO: execute este script no Supabase SQL Editor
-- ============================================

-- ============================================
-- 0. EVENTOS — Adicionar coluna created_by
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'eventos' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE eventos ADD COLUMN created_by UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill: preencher created_by para eventos existentes
-- (opcional: atribui ao admin se não souber quem criou)
UPDATE eventos SET created_by = NULL WHERE created_by IS NULL;

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_eventos_created_by ON eventos(created_by);

-- ============================================
-- Helper: verificar se o usuário é admin
-- ============================================
CREATE OR REPLACE FUNCTION is_admin(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM membros_permissoes mp
    WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = uid)
    AND mp.perfil = 'Administrador'
  ) OR NOT EXISTS (
    SELECT 1 FROM membros_permissoes mp
    WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = uid)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- Helper: obter o membro_id a partir do auth.uid()
-- ============================================
CREATE OR REPLACE FUNCTION get_membro_id(uid UUID)
RETURNS UUID AS $$
  SELECT m.id FROM membros m WHERE m.auth_user_id = uid LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- 1. MEMBROS — RLS
-- Admin vê todos; membros veem apenas a si mesmos
-- ============================================
ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membros_select" ON membros;
DROP POLICY IF EXISTS "membros_update" ON membros;
DROP POLICY IF EXISTS "membros_delete" ON membros;

CREATE POLICY "membros_select" ON membros
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR id = get_membro_id(auth.uid())
  );

CREATE POLICY "membros_update" ON membros
  FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR id = get_membro_id(auth.uid())
  )
  WITH CHECK (
    is_admin(auth.uid())
    OR id = get_membro_id(auth.uid())
  );

CREATE POLICY "membros_delete" ON membros
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- 2. MEMBROS_PERMISSOES — RLS
-- Admin: CRUD completo; Membro: apenas SELECT
-- ============================================
ALTER TABLE membros_permissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perm_select" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_insert" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_update" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_delete" ON membros_permissoes;

CREATE POLICY "perm_select" ON membros_permissoes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "perm_insert" ON membros_permissoes
  FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "perm_update" ON membros_permissoes
  FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "perm_delete" ON membros_permissoes
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- 3. EVENTOS — RLS
-- Admin vê todos; membro vê apenas os que criou
-- (usa coluna created_by recém-criada)
-- ============================================
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eventos_select" ON eventos;
DROP POLICY IF EXISTS "eventos_insert" ON eventos;
DROP POLICY IF EXISTS "eventos_update" ON eventos;
DROP POLICY IF EXISTS "eventos_delete" ON eventos;

CREATE POLICY "eventos_select" ON eventos
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR created_by = get_membro_id(auth.uid())
  );

CREATE POLICY "eventos_insert" ON eventos
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "eventos_update" ON eventos
  FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR created_by = get_membro_id(auth.uid())
  )
  WITH CHECK (
    is_admin(auth.uid())
    OR created_by = get_membro_id(auth.uid())
  );

CREATE POLICY "eventos_delete" ON eventos
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- 4. CHATS — RLS
-- Admin vê todos; membro vê apenas os atribuídos a si
-- ============================================
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_select" ON chats;
DROP POLICY IF EXISTS "chats_insert" ON chats;
DROP POLICY IF EXISTS "chats_update" ON chats;
DROP POLICY IF EXISTS "chats_delete" ON chats;

CREATE POLICY "chats_select" ON chats
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR assigned_to = get_membro_id(auth.uid())
  );

CREATE POLICY "chats_insert" ON chats
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "chats_update" ON chats
  FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR assigned_to = get_membro_id(auth.uid())
  )
  WITH CHECK (
    is_admin(auth.uid())
    OR assigned_to = get_membro_id(auth.uid())
  );

CREATE POLICY "chats_delete" ON chats
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- 5. MENSAGENS — RLS
-- Admin vê todas; membro vê apenas as dos seus chats
-- ============================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;
DROP POLICY IF EXISTS "messages_delete" ON messages;

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR chat_id IN (
      SELECT c.id FROM chats c
      WHERE c.assigned_to = get_membro_id(auth.uid())
    )
  );

CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "messages_delete" ON messages
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- ============================================
-- 6. Índices para performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chats_assigned_to ON chats(assigned_to);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

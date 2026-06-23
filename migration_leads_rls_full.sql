-- ============================================
-- MIGRAÇÃO: RLS completo para tabela leads
-- Baseado no campo "perfil" da tabela membros_permissoes
--
-- Administrador: SELECT, INSERT, UPDATE, DELETE em TODOS os leads
-- Atendente:     SELECT e UPDATE nos leads onde membro_id ou qualificador_id = seu ID
-- Marketing:     SELECT e UPDATE nos leads onde membro_id ou qualificador_id = seu ID
-- NENHUM perfil não-admin pode excluir leads
-- ============================================

-- 1. Garantir que colunas existem (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='membro_id') THEN
    ALTER TABLE leads ADD COLUMN membro_id UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='qualificador_id') THEN
    ALTER TABLE leads ADD COLUMN qualificador_id UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Índices para performance (RLS faz subqueries em cada linha)
CREATE INDEX IF NOT EXISTS idx_leads_membro_id ON leads(membro_id);
CREATE INDEX IF NOT EXISTS idx_leads_qualificador_id ON leads(qualificador_id);

-- 3. Habilitar RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- 4. Remover TODAS as políticas antigas (idempotente)
DROP POLICY IF EXISTS "leads_select" ON leads;
DROP POLICY IF EXISTS "leads_select_filtered" ON leads;
DROP POLICY IF EXISTS "leads_select_by_visibility" ON leads;
DROP POLICY IF EXISTS "leads_insert" ON leads;
DROP POLICY IF EXISTS "leads_insert_app" ON leads;
DROP POLICY IF EXISTS "leads_insert_auth" ON leads;
DROP POLICY IF EXISTS "leads_update" ON leads;
DROP POLICY IF EXISTS "leads_update_app" ON leads;
DROP POLICY IF EXISTS "leads_update_by_visibility" ON leads;
DROP POLICY IF EXISTS "leads_delete" ON leads;
DROP POLICY IF EXISTS "leads_delete_app" ON leads;
DROP POLICY IF EXISTS "leads_delete_admin_only" ON leads;

-- ============================================
-- Helper: resolver auth.uid() → membros.id
-- Usado em todas as políticas abaixo
-- ============================================

-- ============================================
-- POLÍTICA SELECT
-- Admin: vê TODOS os leads
-- Atendente/Marketing: vê APENAS seus leads (membro_id ou qualificador_id)
-- ============================================
CREATE POLICY "leads_select_by_visibility" ON leads
  FOR SELECT TO authenticated
  USING (
    -- Admin: perfil = 'Administrador'
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
      AND mp.perfil = 'Administrador'
    )
    -- Admin fallback: sem registro em membros_permissoes
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
    -- Qualquer membro autenticado: leads onde é membro_id OU qualificador_id
    OR membro_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
    OR qualificador_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
  );

-- ============================================
-- POLÍTICA INSERT: qualquer autenticado pode criar
-- ============================================
CREATE POLICY "leads_insert_auth" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================
-- POLÍTICA UPDATE
-- Admin: edita TODOS os leads
-- Atendente/Marketing: edita APENAS seus leads (membro_id ou qualificador_id)
-- ============================================
CREATE POLICY "leads_update_by_visibility" ON leads
  FOR UPDATE TO authenticated
  USING (
    -- Admin: perfil = 'Administrador'
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
      AND mp.perfil = 'Administrador'
    )
    -- Admin fallback: sem registro
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
    -- Qualquer membro: seus leads
    OR membro_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
    OR qualificador_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Mesma lógica para a nova versão da linha
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
      AND mp.perfil = 'Administrador'
    )
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
    OR membro_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
    OR qualificador_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
  );

-- ============================================
-- POLÍTICA DELETE: APENAS admin pode excluir
-- Nenhum outro perfil pode deletar leads
-- ============================================
CREATE POLICY "leads_delete_admin_only" ON leads
  FOR DELETE TO authenticated
  USING (
    -- Admin: perfil = 'Administrador'
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
      AND mp.perfil = 'Administrador'
    )
    -- Admin fallback: sem registro
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
  );

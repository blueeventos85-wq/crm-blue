-- ============================================
-- MIGRAÇÃO: Políticas RLS para owner_id em leads
-- Garante que membros comuns veem apenas seus leads
-- ============================================

-- 1. Remover políticas antigas de SELECT (se existirem) para recriar com filtro
DO $$ BEGIN
  DROP POLICY IF EXISTS "leads_select" ON leads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "leads_insert" ON leads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "leads_update" ON leads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "leads_delete" ON leads;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Nova política SELECT: admin vê tudo, membro vê apenas seus leads
--    (Admin = não tem registro em membros_permissoes OU tem can_administrador = true)
CREATE POLICY "leads_select_filtered" ON leads
  FOR SELECT TO authenticated
  USING (
    -- Admin: sem registro de permissões (vê tudo)
    NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
    -- Admin: tem can_administrador = true
    OR EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
      AND mp.can_administrador = true
    )
    -- Membro: vê leads onde owner_id ou created_by é ele
    OR owner_id = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
    OR created_by = (
      SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
    )
  );

-- 3. Políticas INSERT/UPDATE/DELETE permissivas (controladas pelo app)
CREATE POLICY "leads_insert_app" ON leads
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "leads_update_app" ON leads
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "leads_delete_app" ON leads
  FOR DELETE TO authenticated USING (true);

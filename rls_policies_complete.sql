-- ============================================
-- POLÍTICAS RLS COMPLETAS - BLUE CRM (v3)
-- ============================================

-- ============================================
-- 1. GARANTIR QUE COLUNAS EXISTEM
-- ============================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rotinas' AND column_name='membro_id') THEN
    ALTER TABLE rotinas ADD COLUMN membro_id UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

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

-- ============================================
-- 2. FUNÇÕES AUXILIARES (defensivas)
-- ============================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  _member_id UUID;
BEGIN
  SELECT m.id INTO _member_id FROM membros m WHERE m.auth_user_id = auth.uid();
  IF _member_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM membros_permissoes mp
    WHERE mp.membro_id = _member_id AND mp.perfil = 'Administrador'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_current_member_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- 3. REMOVER TODAS AS POLÍTICAS ANTIGAS
-- ============================================

-- leads
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
DROP POLICY IF EXISTS "leads_admin_all" ON leads;

-- rotinas
DROP POLICY IF EXISTS "rotinas_select" ON rotinas;
DROP POLICY IF EXISTS "rotinas_insert" ON rotinas;
DROP POLICY IF EXISTS "rotinas_update" ON rotinas;
DROP POLICY IF EXISTS "rotinas_delete" ON rotinas;
DROP POLICY IF EXISTS "rotinas_admin_all" ON rotinas;
DROP POLICY IF EXISTS "Permitir acesso completo para anon" ON rotinas;

-- membros_permissoes
DROP POLICY IF EXISTS "perm_select" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_insert" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_update" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_delete" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_admin_all" ON membros_permissoes;

-- membros
DROP POLICY IF EXISTS "membros_select" ON membros;
DROP POLICY IF EXISTS "membros_insert" ON membros;
DROP POLICY IF EXISTS "membros_update" ON membros;
DROP POLICY IF EXISTS "membros_delete" ON membros;
DROP POLICY IF EXISTS "membros_admin_all" ON membros;

-- ============================================
-- 4. TABELA: leads
-- ============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_admin_all" ON leads
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "leads_select" ON leads
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR qualificador_id = get_current_member_id()
  );

CREATE POLICY "leads_insert" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "leads_update" ON leads
  FOR UPDATE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR qualificador_id = get_current_member_id()
  )
  WITH CHECK (
    membro_id = get_current_member_id()
    OR qualificador_id = get_current_member_id()
  );

-- ============================================
-- 5. TABELA: rotinas
-- ============================================
ALTER TABLE rotinas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rotinas_admin_all" ON rotinas
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "rotinas_select" ON rotinas
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "rotinas_insert" ON rotinas
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "rotinas_update" ON rotinas
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "rotinas_delete" ON rotinas
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

-- ============================================
-- 6. TABELA: membros_permissoes
-- ============================================
ALTER TABLE membros_permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_admin_all" ON membros_permissoes
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "perm_select" ON membros_permissoes
  FOR SELECT TO authenticated
  USING (true);

-- ============================================
-- 7. TABELA: membros
-- ============================================
ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membros_admin_all" ON membros
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "membros_select" ON membros
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "membros_update" ON membros
  FOR UPDATE TO authenticated
  USING (id = get_current_member_id())
  WITH CHECK (id = get_current_member_id());

-- ============================================
-- 8. ÍNDICES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_leads_membro_id ON leads(membro_id);
CREATE INDEX IF NOT EXISTS idx_leads_qualificador_id ON leads(qualificador_id);
CREATE INDEX IF NOT EXISTS idx_rotinas_membro_id ON rotinas(membro_id);
CREATE INDEX IF NOT EXISTS idx_perm_membro ON membros_permissoes(membro_id);

-- ============================================
-- TABELA: membros_permissoes
-- ============================================
CREATE TABLE IF NOT EXISTS membros_permissoes (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id               UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE UNIQUE,
  perfil                  TEXT DEFAULT 'Somente leitura',
  can_crm_view            BOOLEAN DEFAULT false,
  can_crm_edit            BOOLEAN DEFAULT false,
  can_crm_delete          BOOLEAN DEFAULT false,
  can_calendar_view       BOOLEAN DEFAULT false,
  can_calendar_edit       BOOLEAN DEFAULT false,
  can_clients_view        BOOLEAN DEFAULT false,
  can_clients_edit        BOOLEAN DEFAULT false,
  can_audit_view          BOOLEAN DEFAULT false,
  can_admin_manage_members BOOLEAN DEFAULT false,
  can_admin_manage_permissions BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE membros_permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_select" ON membros_permissoes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "perm_insert" ON membros_permissoes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "perm_update" ON membros_permissoes
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "perm_delete" ON membros_permissoes
  FOR DELETE TO authenticated USING (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_perm_membro ON membros_permissoes(membro_id);

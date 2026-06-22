-- ============================================
-- TABELA: membros_permissoes
-- ============================================
CREATE TABLE IF NOT EXISTS membros_permissoes (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id                 UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE UNIQUE,
  perfil                    TEXT DEFAULT 'Somente leitura',
  -- Módulos da sidebar
  can_home                  BOOLEAN DEFAULT false,
  can_dashboard             BOOLEAN DEFAULT false,
  can_crm                   BOOLEAN DEFAULT false,
  can_cliente_base          BOOLEAN DEFAULT false,
  can_calendario            BOOLEAN DEFAULT false,
  can_rotina_blue           BOOLEAN DEFAULT false,
  can_pomodoro              BOOLEAN DEFAULT false,
  can_conversas             BOOLEAN DEFAULT false,
  can_configuracoes         BOOLEAN DEFAULT false,
  can_auditoria             BOOLEAN DEFAULT false,
  can_administrador         BOOLEAN DEFAULT false,
  can_obrigacoes            BOOLEAN DEFAULT false,
  can_documentos            BOOLEAN DEFAULT false,
  can_suporte               BOOLEAN DEFAULT false,
  can_calibragem            BOOLEAN DEFAULT false,
  -- Dados sensíveis
  can_delete_cliente_telefone BOOLEAN DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
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

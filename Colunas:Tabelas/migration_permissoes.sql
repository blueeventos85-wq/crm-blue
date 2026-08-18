-- ============================================
-- MIGRAÇÃO: membros_permissoes — novo modelo
-- Módulos da sidebar + dados sensíveis
-- ============================================

-- 1. Criar tabela nova (se não existir)
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

  -- Dados sensíveis
  can_delete_cliente_telefone BOOLEAN DEFAULT false,

  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

-- 2. Se a tabela já existe com colunas antigas, adicionar as novas
DO $$
BEGIN
  -- Módulos da sidebar
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_home') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_home BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_dashboard') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_dashboard BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_crm') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_crm BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_cliente_base') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_cliente_base BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_calendario') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_calendario BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_rotina_blue') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_rotina_blue BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_pomodoro') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_pomodoro BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_conversas') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_conversas BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_configuracoes') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_configuracoes BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_auditoria') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_auditoria BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_administrador') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_administrador BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_obrigacoes') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_obrigacoes BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_documentos') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_documentos BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_suporte') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_suporte BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_calibragem') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_calibragem BOOLEAN DEFAULT false;
  END IF;
  -- Dados sensíveis
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_delete_cliente_telefone') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_delete_cliente_telefone BOOLEAN DEFAULT false;
  END IF;
END $$;

-- 3. RLS
ALTER TABLE membros_permissoes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='perm_select' AND tablename='membros_permissoes') THEN
    CREATE POLICY "perm_select" ON membros_permissoes FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='perm_insert' AND tablename='membros_permissoes') THEN
    CREATE POLICY "perm_insert" ON membros_permissoes FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='perm_update' AND tablename='membros_permissoes') THEN
    CREATE POLICY "perm_update" ON membros_permissoes FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='perm_delete' AND tablename='membros_permissoes') THEN
    CREATE POLICY "perm_delete" ON membros_permissoes FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- 4. Índice
CREATE INDEX IF NOT EXISTS idx_perm_membro ON membros_permissoes(membro_id);

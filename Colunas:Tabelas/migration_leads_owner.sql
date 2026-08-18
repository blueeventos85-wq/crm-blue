-- ============================================
-- MIGRAÇÃO: Adicionar owner_id e created_by na tabela leads
-- ============================================

-- 1. Adicionar owner_id (usuário responsável pelo lead)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='owner_id') THEN
    ALTER TABLE leads ADD COLUMN owner_id UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Adicionar created_by (quem cadastrou o lead)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='created_by') THEN
    ALTER TABLE leads ADD COLUMN created_by UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Índices para performance nas queries filtradas
CREATE INDEX IF NOT EXISTS idx_leads_owner_id ON leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);

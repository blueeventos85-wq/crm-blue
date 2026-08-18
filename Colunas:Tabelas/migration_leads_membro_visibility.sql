-- ============================================
-- MIGRAÇÃO: Visibilidade de leads por membro (membro_id)
-- ============================================

-- 1. Adicionar a coluna membro_id na tabela leads referenciando membros(id)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='membro_id') THEN
    ALTER TABLE leads ADD COLUMN membro_id UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Indexar membro_id para performance
CREATE INDEX IF NOT EXISTS idx_leads_membro_id ON leads(membro_id);

-- 3. Habilitar Row Level Security (RLS) na tabela leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- 4. Remover políticas de SELECT antigas
DROP POLICY IF EXISTS "leads_select" ON leads;
DROP POLICY IF EXISTS "leads_select_filtered" ON leads;
DROP POLICY IF EXISTS "leads_select_by_visibility" ON leads;

-- 5. Criar nova política de SELECT:
--    - Admin (can_administrador = true ou sem linha em membros_permissoes) vê tudo.
--    - Membros comuns vêem apenas leads onde membro_id é o seu próprio membros.id.
CREATE POLICY "leads_select_by_visibility" ON leads
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
    -- Membro comum: vê leads associados ao seu membro_id
    OR (
      membro_id = (
        SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid()
      )
    )
  );

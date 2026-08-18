-- ============================================
-- MIGRATION: Criar tabela de relacionamento N:N entre membros e centros de custo
-- ============================================

-- 1. Criar tabela pivot (se não existir)
CREATE TABLE IF NOT EXISTS membro_centros_custo (
  membro_id UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  centro_custo_id UUID NOT NULL REFERENCES centros_custo(id) ON DELETE CASCADE,
  PRIMARY KEY (membro_id, centro_custo_id)
);

-- 2. Migrar dados existentes da coluna centro_custo_id da tabela membros
INSERT INTO membro_centros_custo (membro_id, centro_custo_id)
SELECT id, centro_custo_id::uuid FROM membros
WHERE centro_custo_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS idx_membro_centros_custo_membro ON membro_centros_custo(membro_id);
CREATE INDEX IF NOT EXISTS idx_membro_centros_custo_cc ON membro_centros_custo(centro_custo_id);

-- 4. RLS (apenas para esta tabela)
ALTER TABLE membro_centros_custo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membro_cc_admin_all" ON membro_centros_custo;
CREATE POLICY "membro_cc_admin_all" ON membro_centros_custo
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "membro_cc_select" ON membro_centros_custo;
CREATE POLICY "membro_cc_select" ON membro_centros_custo
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "membro_cc_insert" ON membro_centros_custo;
CREATE POLICY "membro_cc_insert" ON membro_centros_custo
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id() OR is_admin());

DROP POLICY IF EXISTS "membro_cc_delete" ON membro_centros_custo;
CREATE POLICY "membro_cc_delete" ON membro_centros_custo
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id() OR is_admin());
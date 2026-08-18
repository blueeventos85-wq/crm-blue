-- ============================================
-- MIGRATION: Tabela pivô centro_custo_cadencias
-- Relacionamento N:N entre centros_custo e cadências do kanban
-- ============================================

CREATE TABLE IF NOT EXISTS centro_custo_cadencias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  centro_custo_id UUID NOT NULL REFERENCES centros_custo(id) ON DELETE CASCADE,
  cadencia_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(centro_custo_id, cadencia_id)
);

CREATE INDEX IF NOT EXISTS idx_cccad_centro_custo ON centro_custo_cadencias(centro_custo_id);
CREATE INDEX IF NOT EXISTS idx_cccad_cadencia ON centro_custo_cadencias(cadencia_id);

ALTER TABLE centro_custo_cadencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cccad_select" ON centro_custo_cadencias;
CREATE POLICY "cccad_select" ON centro_custo_cadencias FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cccad_insert" ON centro_custo_cadencias;
CREATE POLICY "cccad_insert" ON centro_custo_cadencias FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cccad_delete" ON centro_custo_cadencias;
CREATE POLICY "cccad_delete" ON centro_custo_cadencias FOR DELETE
  USING (auth.role() = 'authenticated');

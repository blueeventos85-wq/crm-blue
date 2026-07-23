-- ============================================
-- MIGRATION: Tabela pivô centro_custo_servicos
-- Relacionamento N:N entre centros_custo e servicos
-- ============================================

CREATE TABLE IF NOT EXISTS centro_custo_servicos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  centro_custo_id UUID NOT NULL REFERENCES centros_custo(id) ON DELETE CASCADE,
  servico_id UUID NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(centro_custo_id, servico_id)
);

CREATE INDEX IF NOT EXISTS idx_ccs_centro_custo ON centro_custo_servicos(centro_custo_id);
CREATE INDEX IF NOT EXISTS idx_ccs_servico ON centro_custo_servicos(servico_id);

ALTER TABLE centro_custo_servicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view centro_custo_servicos"
  ON centro_custo_servicos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert centro_custo_servicos"
  ON centro_custo_servicos FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete centro_custo_servicos"
  ON centro_custo_servicos FOR DELETE
  USING (auth.role() = 'authenticated');

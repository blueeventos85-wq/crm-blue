-- ============================================
-- MIGRATION: Adicionar centro_custo_id na tabela membros
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'membros' AND column_name = 'centro_custo_id'
  ) THEN
    ALTER TABLE membros ADD COLUMN centro_custo_id UUID REFERENCES centros_custo(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Criar índice para a nova coluna para otimizar queries
CREATE INDEX IF NOT EXISTS idx_membros_centro_custo ON membros(centro_custo_id);

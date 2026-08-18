-- ============================================
-- MIGRATION: Adicionar coluna bio na tabela membros
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'membros' AND column_name = 'bio'
  ) THEN
    ALTER TABLE membros ADD COLUMN bio TEXT;
  END IF;
END $$;

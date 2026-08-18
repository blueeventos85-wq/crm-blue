-- ============================================
-- MIGRAÇÃO: Adicionar can_calibragem
-- ============================================

-- 1. Adicionar coluna can_calibragem se não existir
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membros_permissoes' AND column_name='can_calibragem') THEN
    ALTER TABLE membros_permissoes ADD COLUMN can_calibragem BOOLEAN DEFAULT false;
  END IF;
END $$;

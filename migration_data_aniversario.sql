-- ============================================
-- MIGRAÇÃO: data_aniversario (corrigido)
-- A coluna já é DATE, apenas limpar valores inválidos
-- ============================================

-- 1. Limpar registros com valor inválido (se houver)
UPDATE membros
SET data_aniversario = NULL
WHERE data_aniversario IS NULL;

-- 2. Garantir DEFAULT NULL
ALTER TABLE membros
  ALTER COLUMN data_aniversario SET DEFAULT NULL;

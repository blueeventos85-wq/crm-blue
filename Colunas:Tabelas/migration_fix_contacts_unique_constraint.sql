-- ============================================
-- MIGRAÇÃO: Corrigir constraint de unicidade
-- contacts: remover membro_id+phone, criar
-- centros_custo_id+phone
-- ============================================

-- 1. Remover constraint legada (membro_id + phone)
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_membro_id_phone_key;

-- 2. Criar nova constraint (centros_custo_id + phone)
--    Só vale para registros que TENHAM centros_custo_id (parcial)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_ccid_phone_unique
  ON contacts(centros_custo_id, phone)
  WHERE centros_custo_id IS NOT NULL;

-- ============================================
-- MIGRAÇÃO: Adicionar tipo 'transferencia' em lead_movements
-- Para registrar transferências de leads entre membros
-- Execute este SQL no painel do Supabase (SQL Editor)
-- ============================================

-- 1. Atualizar CHECK constraint para aceitar 'transferencia'
ALTER TABLE lead_movements
  DROP CONSTRAINT IF EXISTS lead_movements_movement_type_check;

ALTER TABLE lead_movements
  ADD CONSTRAINT lead_movements_movement_type_check
  CHECK (movement_type IN ('cadencia', 'temperatura', 'transferencia'));

-- 2. Garantir que user_id exista (caso ainda não tenha rodado a migration anterior)
ALTER TABLE lead_movements
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES membros(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_movements_user_id ON lead_movements(user_id);

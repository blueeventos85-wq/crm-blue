-- ============================================
-- MIGRAÇÃO: Adicionar user_id em lead_movements
-- Para rastrear QUEM realizou a movimentação
-- Execute este SQL no painel do Supabase (SQL Editor)
-- ============================================

-- 1. Adicionar coluna user_id (nullable para dados antigos)
ALTER TABLE lead_movements
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES membros(id) ON DELETE SET NULL;

-- 2. Índice para buscas por usuário
CREATE INDEX IF NOT EXISTS idx_lead_movements_user_id ON lead_movements(user_id);

-- ============================================================
-- Migration: Adicionar coluna deleted_at para soft delete de contratos
-- A tabela contratos não possui política de DELETE no RLS.
-- Utilizaremos deleted_at (timestamp) para marcar exclusões lógicas.
-- Execute no Supabase SQL Editor.
-- ============================================================

-- 1. Adicionar coluna (idempotente)
ALTER TABLE public.contratos
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Verificar resultado
SELECT id, numero_contrato, status, deleted_at
  FROM public.contratos
 WHERE deleted_at IS NOT NULL
 ORDER BY deleted_at DESC;

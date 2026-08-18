-- Migration: Adicionar colunas de endereco separadas na tabela leads
-- Permite preenchimento automatico nos contratos

ALTER TABLE leads ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cep TEXT;

/* ============================================
   TABELA: rotinas — Blue CRM
   Execute este script no Supabase SQL Editor
   ============================================ */

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criar tabela rotinas
CREATE TABLE IF NOT EXISTS rotinas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo       TEXT NOT NULL DEFAULT '',
  observacoes  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'cadencia',
  cor          TEXT NOT NULL DEFAULT 'blue',
  data_tarefa  DATE,
  hora_tarefa  TIME,
  tipo         TEXT NOT NULL DEFAULT 'tarefa',
  fixado       BOOLEAN NOT NULL DEFAULT false,
  data_edicao  TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE rotinas ENABLE ROW LEVEL SECURITY;

-- Criar política permissiva para a role anon (chave pública)
CREATE POLICY "Permitir acesso completo para anon"
  ON rotinas
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Criar índice para buscas por status
CREATE INDEX IF NOT EXISTS idx_rotinas_status ON rotinas(status);

-- Criar índice para ordenação por created_at
CREATE INDEX IF NOT EXISTS idx_rotinas_created_at ON rotinas(created_at DESC);

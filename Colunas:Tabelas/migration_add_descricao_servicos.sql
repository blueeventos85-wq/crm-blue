-- MIGRAÇÃO: Adicionar coluna descricao_servicos (não destrutiva)
-- Executar no Supabase SQL Editor

-- Adicionar coluna descricao_servicos se não existir
ALTER TABLE public.contratos
ADD COLUMN IF NOT EXISTS descricao_servicos text;

-- Verificar se a coluna foi adicionada com sucesso
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contratos'
      AND column_name = 'descricao_servicos'
  ) THEN
    RAISE NOTICE 'Coluna descricao_servicos adicionada com sucesso na tabela contratos';
  ELSE
    RAISE EXCEPTION 'Falha ao adicionar coluna descricao_servicos';
  END IF;
END $$;

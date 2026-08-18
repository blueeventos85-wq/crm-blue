-- Migration: Adicionar colunas para contrato assinado na tabela contratos
-- Execute no Supabase SQL Editor

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contratos' AND column_name = 'url_contrato_assinado') THEN
        ALTER TABLE public.contratos ADD COLUMN url_contrato_assinado TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contratos' AND column_name = 'assinado_storage_path') THEN
        ALTER TABLE public.contratos ADD COLUMN assinado_storage_path TEXT;
    END IF;
END $$;

-- Migration: Adicionar hora_inicio, hora_final e servicos_selecionados na tabela leads
-- Execute no Supabase SQL Editor

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'hora_inicio') THEN
        ALTER TABLE public.leads ADD COLUMN hora_inicio TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'hora_final') THEN
        ALTER TABLE public.leads ADD COLUMN hora_final TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'servicos_selecionados') THEN
        ALTER TABLE public.leads ADD COLUMN servicos_selecionados TEXT;
    END IF;
END $$;

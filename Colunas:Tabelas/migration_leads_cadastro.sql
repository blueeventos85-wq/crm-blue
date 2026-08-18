-- Migration: Garantir estrutura completa da tabela leads para a view Cadastro
-- Execute este SQL no Supabase SQL Editor

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'nome') THEN
        ALTER TABLE public.leads ADD COLUMN nome TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'cpf_cnpj') THEN
        ALTER TABLE public.leads ADD COLUMN cpf_cnpj TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'telefone') THEN
        ALTER TABLE public.leads ADD COLUMN telefone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'email') THEN
        ALTER TABLE public.leads ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'endereco_residencial') THEN
        ALTER TABLE public.leads ADD COLUMN endereco_residencial TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'bairro') THEN
        ALTER TABLE public.leads ADD COLUMN bairro TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'cidade') THEN
        ALTER TABLE public.leads ADD COLUMN cidade TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'estado') THEN
        ALTER TABLE public.leads ADD COLUMN estado TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'cep') THEN
        ALTER TABLE public.leads ADD COLUMN cep TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'cpf') THEN
        ALTER TABLE public.leads ADD COLUMN cpf TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'cnpj') THEN
        ALTER TABLE public.leads ADD COLUMN cnpj TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'deleted_at') THEN
        ALTER TABLE public.leads ADD COLUMN deleted_at TIMESTAMPTZ;
    END IF;
END $$;

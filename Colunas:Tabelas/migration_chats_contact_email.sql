-- Migration: Adicionar coluna contact_email à tabela chats
-- Execute no Supabase SQL Editor

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chats' AND column_name = 'contact_email') THEN
        ALTER TABLE public.chats ADD COLUMN contact_email TEXT;
    END IF;
END $$;

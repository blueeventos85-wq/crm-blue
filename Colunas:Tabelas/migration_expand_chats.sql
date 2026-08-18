-- ============================================================
-- Migration: Expandir tabela chats para Central de Atendimento
-- Adiciona colunas necessárias para filtros, CRM e gestão
-- Execute no Supabase SQL Editor
-- ============================================================

-- 1. Colunas essenciais para a Central de Atendimento
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS temperature TEXT DEFAULT 'frio'
    CHECK (temperature IN ('frio', 'morno', 'quente')),
  ADD COLUMN IF NOT EXISTS priority BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_location TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Índices para performance nos filtros
CREATE INDEX IF NOT EXISTS idx_chats_temperature ON chats(temperature);
CREATE INDEX IF NOT EXISTS idx_chats_priority ON chats(priority) WHERE priority = true;
CREATE INDEX IF NOT EXISTS idx_chats_archived ON chats(archived);
CREATE INDEX IF NOT EXISTS idx_chats_unread ON chats(unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_chats_follow_up ON chats(follow_up_at) WHERE follow_up_at IS NOT NULL;

-- 3. Atualizar contadores de não lidas baseado em mensagens existentes
UPDATE public.chats c
   SET unread_count = (
     SELECT COUNT(*) FROM public.messages m
     WHERE m.chat_id = c.id AND m.sender_type = 'lead'
       AND m.created_at > COALESCE(c.updated_at, c.created_at)
   );

-- 4. Verificar estrutura final
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'chats' AND table_schema = 'public'
 ORDER BY ordinal_position;

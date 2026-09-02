-- ============================================
-- MIGRATION: Tabelas WhatsApp + Evolution API
-- ============================================
-- Cria a estrutura completa para integração WhatsApp
-- via Evolution API, com isolamento multi-tenant
-- usando a coluna membro_id (FK → membros.id).
-- ============================================

-- ============================================
-- 1. TABELA: whatsapp_config
-- Armazena a configuração de cada instância
-- WhatsApp conectada ao sistema.
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id       UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'evolution_api',
  provider_config JSONB DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'disconnected'
                  CHECK (status IN ('connected', 'disconnected', 'error', 'connecting')),
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_config_select" ON whatsapp_config
  FOR SELECT TO authenticated
  USING (membro_id = get_current_member_id());

CREATE POLICY "whatsapp_config_insert" ON whatsapp_config
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "whatsapp_config_update" ON whatsapp_config
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "whatsapp_config_delete" ON whatsapp_config
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_membro ON whatsapp_config(membro_id);

-- ============================================
-- 2. TABELA: contacts
-- Contatos (pessoas) que interagem via WhatsApp.
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id       UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  name            TEXT DEFAULT '',
  profile_pic_url TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (membro_id, phone)
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select" ON contacts
  FOR SELECT TO authenticated
  USING (membro_id = get_current_member_id());

CREATE POLICY "contacts_insert" ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "contacts_update" ON contacts
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "contacts_delete" ON contacts
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

CREATE INDEX IF NOT EXISTS idx_contacts_membro ON contacts(membro_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(membro_id, phone);

-- ============================================
-- 3. TABELA: conversations
-- Conversas (threads) entre o membro e um contato.
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membro_id         UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed', 'archived')),
  unread_count      INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (membro_id = get_current_member_id());

CREATE POLICY "conversations_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "conversations_update" ON conversations
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "conversations_delete" ON conversations
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

CREATE INDEX IF NOT EXISTS idx_conversations_membro ON conversations(membro_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(membro_id, last_message_at DESC);

-- ============================================
-- 4. TABELA: messages
-- Mensagens trocadas em cada conversa.
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  membro_id       UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  sender_type     TEXT NOT NULL DEFAULT 'contact'
                  CHECK (sender_type IN ('member', 'contact', 'system')),
  content_type    TEXT NOT NULL DEFAULT 'text'
                  CHECK (content_type IN ('text', 'image', 'video', 'audio', 'document', 'location', 'sticker')),
  content_text    TEXT,
  media_url       TEXT,
  message_id      TEXT,
  status          TEXT NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'delivered', 'read', 'pending', 'failed')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (membro_id = get_current_member_id());

CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (membro_id = get_current_member_id())
  WITH CHECK (membro_id = get_current_member_id());

CREATE POLICY "messages_delete" ON messages
  FOR DELETE TO authenticated
  USING (membro_id = get_current_member_id());

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_membro ON messages(membro_id);

-- ============================================
-- 5. FUNCTION: bump_conversation_on_inbound
-- Atualiza a conversa quando uma nova mensagem
-- recebida (inbound) é inserida na tabela messages.
-- ============================================
CREATE OR REPLACE FUNCTION bump_conversation_on_inbound()
RETURNS TRIGGER AS $$
BEGIN
  -- Somente age para mensagens vindas do contato (inbound)
  IF NEW.sender_type = 'contact' THEN
    UPDATE conversations
    SET
      last_message_text = COALESCE(NEW.content_text, '[' || NEW.content_type || ']'),
      last_message_at   = NEW.created_at,
      unread_count      = unread_count + 1,
      updated_at        = now()
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. TRIGGER: tg_bump_conversation_on_inbound
-- Dispara a function a cada INSERT na tabela messages.
-- ============================================
DROP TRIGGER IF EXISTS tg_bump_conversation_on_inbound ON messages;

CREATE TRIGGER tg_bump_conversation_on_inbound
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION bump_conversation_on_inbound();

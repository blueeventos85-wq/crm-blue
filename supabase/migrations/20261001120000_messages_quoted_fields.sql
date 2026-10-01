-- ============================================
-- MIGRAÇÃO: vínculo de mensagem citada (quoted reply)
-- quoted_message_id → ID WA (stanzaId) da mensagem citada
-- quoted_content    → texto/conteúdo da mensagem citada
-- quoted_sender     → autor da mensagem citada (nome ou dígitos)
-- ============================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_sender TEXT;

COMMENT ON COLUMN messages.quoted_message_id IS 'ID WA (stanzaId) da mensagem citada';
COMMENT ON COLUMN messages.quoted_content IS 'Texto/conteúdo da mensagem citada';
COMMENT ON COLUMN messages.quoted_sender IS 'Autor da mensagem citada (nome ou dígitos do participante)';

CREATE INDEX IF NOT EXISTS idx_messages_quoted_message_id
  ON messages(quoted_message_id) WHERE quoted_message_id IS NOT NULL;

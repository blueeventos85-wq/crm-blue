-- ============================================
-- MIGRAÇÃO: identificação do remetente em mensagens de grupo
-- sender_jid  → JID de quem enviou (ex: 558599999999@s.whatsapp.net)
-- sender_name → pushName do remetente (fallback: telefone formatado)
-- ============================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_jid TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;

COMMENT ON COLUMN messages.sender_jid IS 'JID do participante que enviou a mensagem (grupos)';
COMMENT ON COLUMN messages.sender_name IS 'Nome do remetente no grupo (pushName do WhatsApp)';

CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid) WHERE sender_jid IS NOT NULL;

-- ============================================
-- MIGRAÇÃO: campos de grupo em conversations
-- title      → nome exibido do grupo (espelho de group_name, estilo WhatsApp)
-- remote_jid → JID completo do destinatário (grupo ou contato)
-- is_group   → flag de grupo na própria conversa
-- ============================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS remote_jid TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;

COMMENT ON COLUMN conversations.title IS 'Nome exibido do grupo (espelho de group_name)';
COMMENT ON COLUMN conversations.remote_jid IS 'JID completo do destinatário (ex: 120363xxx@g.us)';
COMMENT ON COLUMN conversations.is_group IS 'true quando a conversa é de grupo WhatsApp';

CREATE INDEX IF NOT EXISTS idx_conversations_remote_jid
  ON conversations(remote_jid) WHERE remote_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_is_group
  ON conversations(is_group) WHERE is_group = true;

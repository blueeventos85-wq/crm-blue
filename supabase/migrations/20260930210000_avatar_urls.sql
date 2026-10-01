-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRAÇÃO: Avatares WhatsApp (fotos de perfil de contatos/grupos) e
--           cache do avatar do participante por mensagem.
-- Idempotente: segura para reaplicar (ADD COLUMN IF NOT EXISTS).
-- Evolution API v2.3.7: pictureUrl (grupos) e fetchProfilePictureUrl (contatos).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Contatos: foto de perfil do WhatsApp (individual ou de grupo)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
COMMENT ON COLUMN contacts.avatar_url IS 'URL da foto de perfil no WhatsApp (fetchProfilePictureUrl / contacts.update)';

-- 2. Conversas: foto do grupo (ou avatar padrão do contato)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS avatar_url TEXT;
COMMENT ON COLUMN conversations.avatar_url IS 'URL da foto do grupo no WhatsApp (group/fetchAllGroups pictureUrl)';

-- 3. Conversas: metadados do grupo (participants: [{jid, admin}] etc.)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata JSONB;
COMMENT ON COLUMN conversations.metadata IS 'Metadados do grupo (participants com jid/admin) sincronizados via fetchAllGroups?getParticipants=true';

-- 4. Mensagens: cache opcional do avatar do remetente em mensagens de grupo
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_avatar_url TEXT;
COMMENT ON COLUMN messages.sender_avatar_url IS 'Cache da foto de perfil do remetente na mensagem (grupo)';

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_contacts_avatar_url
  ON contacts (avatar_url) WHERE avatar_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_metadata
  ON conversations USING GIN (metadata) WHERE metadata IS NOT NULL;

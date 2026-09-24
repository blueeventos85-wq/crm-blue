-- ============================================
-- MIGRAÇÃO: Suporte a grupos WhatsApp
-- ============================================

-- 1. Adicionar colunas para identificar grupos na tabela contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS group_jid TEXT;

-- Índice para buscar grupos por JID
CREATE INDEX IF NOT EXISTS idx_contacts_group_jid ON contacts(group_jid) WHERE group_jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_is_group ON contacts(is_group) WHERE is_group = true;

-- 2. Adicionar coluna para nome do grupo na tabela conversations (opcional, para cache)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_jid TEXT;

-- Índice para conversas de grupo
CREATE INDEX IF NOT EXISTS idx_conversations_group_jid ON conversations(group_jid) WHERE group_jid IS NOT NULL;

-- 3. Atualizar RLS policies para incluir campos de grupo (já cobertos pelas policies existentes que usam membro_id/centros_custo_id)

-- 4. Atualizar constraint UNIQUE para permitir grupos (mesmo phone mas is_group=true)
-- Remover constraint antiga se existir e criar nova
DO $$ BEGIN
  -- Verificar se a constraint UNIQUE antiga existe
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'contacts' AND constraint_name = 'contacts_membro_id_phone_key'
  ) THEN
    ALTER TABLE contacts DROP CONSTRAINT contacts_membro_id_phone_key;
  END IF;
END $$;

-- Nova constraint: unique por membro + phone, mas permite grupos (is_group ignora phone uniqueness)
-- Usar partial index para grupos (sem phone obrigatório) e contatos individuais
DROP INDEX IF EXISTS idx_contacts_membro_phone_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_membro_phone_unique 
  ON contacts(membro_id, phone) WHERE is_group = false;

-- Para grupos, usar group_jid como unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_membro_group_jid_unique 
  ON contacts(membro_id, group_jid) WHERE is_group = true AND group_jid IS NOT NULL;

-- 5. Atualizar trigger de bump_conversation_on_inbound para não falhar em grupos
-- (já funciona pois usa conversation_id)
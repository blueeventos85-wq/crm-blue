-- Exclusão de mensagens: estado de apagado (webhook do contato) + índice para message_id

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_message_id
  ON messages (message_id) WHERE message_id IS NOT NULL;

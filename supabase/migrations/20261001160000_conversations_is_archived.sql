-- Conversas arquivadas (estilo WhatsApp Web): coluna booleana + índice.
-- Idempotente — pode ser aplicada mais de uma vez.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;
COMMENT ON COLUMN conversations.is_archived IS 'true = conversa arquivada (oculta da lista principal, acessível pela pasta Arquivadas)';

CREATE INDEX IF NOT EXISTS idx_conversations_is_archived ON conversations (membro_id, centros_custo_id, is_archived);

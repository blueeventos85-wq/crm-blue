-- ============================================
-- MIGRAÇÃO: sender_phone em messages
-- Telefone (só dígitos) do participante que enviou
-- a mensagem em grupo (ex: 558599999999).
-- Complementa sender_jid / sender_name.
-- ============================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_phone TEXT;

COMMENT ON COLUMN messages.sender_phone IS 'Telefone do remetente em grupos (somente dígitos)';

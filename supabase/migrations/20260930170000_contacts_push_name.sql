-- ============================================
-- MIGRAÇÃO: push_name em contacts
-- Guarda o nome exibido no WhatsApp (pushName) separado
-- do nome editado manualmente no CRM (name).
-- ============================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS push_name TEXT DEFAULT '';

COMMENT ON COLUMN contacts.push_name IS 'Nome original exibido no WhatsApp (pushName), imutável pelo usuário';

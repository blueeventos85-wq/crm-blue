-- ============================================
-- MIGRAÇÃO: lead_id em conversations e contacts
-- Vincula conversas e contatos WhatsApp a leads
-- ============================================

-- 1. conversations: adicionar lead_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'lead_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);

-- 2. contacts: adicionar lead_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'lead_id'
  ) THEN
    ALTER TABLE contacts ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);

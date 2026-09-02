-- ============================================
-- MIGRAÇÃO: WhatsApp Multi-Empresas (Centros de Custo)
-- Adiciona centros_custo_id em whatsapp_config,
-- conversations e contacts para suportar
-- uma instância WhatsApp por centro de custo.
-- ============================================

-- ============================================
-- 1. whatsapp_config: adicionar centros_custo_id
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_config' AND column_name = 'centros_custo_id'
  ) THEN
    ALTER TABLE whatsapp_config ADD COLUMN centros_custo_id UUID REFERENCES centros_custo(id);
  END IF;
END $$;

-- Tornar membro_id nullable (instâncias por empresa não precisam de membro específico)
ALTER TABLE whatsapp_config ALTER COLUMN membro_id DROP NOT NULL;

-- Uma instância por centro de custo
DROP INDEX IF EXISTS idx_whatsapp_config_cc_unique;
CREATE UNIQUE INDEX idx_whatsapp_config_cc_unique
  ON whatsapp_config(centros_custo_id)
  WHERE centros_custo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_cc ON whatsapp_config(centros_custo_id);

-- ============================================
-- 2. contacts: adicionar centros_custo_id
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'centros_custo_id'
  ) THEN
    ALTER TABLE contacts ADD COLUMN centros_custo_id UUID REFERENCES centros_custo(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_cc ON contacts(centros_custo_id);

-- ============================================
-- 3. conversations: adicionar centros_custo_id
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'centros_custo_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN centros_custo_id UUID REFERENCES centros_custo(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_cc ON conversations(centros_custo_id);

-- ============================================
-- 4. RLS: Recriar políticas com suporte a centros_custo
-- ============================================

-- 4.1 whatsapp_config
DROP POLICY IF EXISTS "whatsapp_config_select" ON whatsapp_config;
DROP POLICY IF EXISTS "whatsapp_config_insert" ON whatsapp_config;
DROP POLICY IF EXISTS "whatsapp_config_update" ON whatsapp_config;
DROP POLICY IF EXISTS "whatsapp_config_delete" ON whatsapp_config;

CREATE POLICY "whatsapp_config_select" ON whatsapp_config
  FOR SELECT TO authenticated
  USING (
    -- Pela membro_id antiga (backward compat)
    membro_id = get_current_member_id()
    -- Ou por centros_custo que o membro tem acesso
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    -- Admin vê tudo
    OR is_admin()
  );

CREATE POLICY "whatsapp_config_insert" ON whatsapp_config
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "whatsapp_config_update" ON whatsapp_config
  FOR UPDATE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  )
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "whatsapp_config_delete" ON whatsapp_config
  FOR DELETE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR is_admin()
  );

-- 4.2 contacts
DROP POLICY IF EXISTS "contacts_select" ON contacts;
DROP POLICY IF EXISTS "contacts_insert" ON contacts;
DROP POLICY IF EXISTS "contacts_update" ON contacts;
DROP POLICY IF EXISTS "contacts_delete" ON contacts;

CREATE POLICY "contacts_select" ON contacts
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "contacts_insert" ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "contacts_update" ON contacts
  FOR UPDATE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  )
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "contacts_delete" ON contacts
  FOR DELETE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR is_admin()
  );

-- 4.3 conversations
DROP POLICY IF EXISTS "conversations_select" ON conversations;
DROP POLICY IF EXISTS "conversations_insert" ON conversations;
DROP POLICY IF EXISTS "conversations_update" ON conversations;
DROP POLICY IF EXISTS "conversations_delete" ON conversations;

CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "conversations_insert" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "conversations_update" ON conversations
  FOR UPDATE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  )
  WITH CHECK (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR is_admin()
  );

CREATE POLICY "conversations_delete" ON conversations
  FOR DELETE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR is_admin()
  );

-- 4.4 messages (mantém original — via conversation_id)
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;
DROP POLICY IF EXISTS "messages_delete" ON messages;

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    -- Ou via conversa do centro de custo que o membro tem acesso
    OR conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.centros_custo_id IN (
        SELECT mcc.centro_custo_id FROM membro_centros_custo mcc
        WHERE mcc.membro_id = get_current_member_id()
      )
    )
    OR is_admin()
  );

CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    membro_id = get_current_member_id()
    OR is_admin()
  );

CREATE POLICY "messages_update" ON messages
  FOR UPDATE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR is_admin()
  )
  WITH CHECK (
    membro_id = get_current_member_id()
    OR is_admin()
  );

CREATE POLICY "messages_delete" ON messages
  FOR DELETE TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR is_admin()
  );

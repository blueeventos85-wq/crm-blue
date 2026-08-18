-- ============================================
-- TABELA: chats (Conversas WhatsApp)
-- ============================================
CREATE TABLE IF NOT EXISTS chats (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  tenant_id     UUID NOT NULL,
  assigned_to   UUID REFERENCES membros(id) ON DELETE SET NULL,
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',
  last_message  TEXT DEFAULT '',
  last_message_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TABELA: messages (Mensagens do chat)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id       UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_type   TEXT NOT NULL DEFAULT 'lead',
  sender_name   TEXT DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'sent',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_chats_tenant ON chats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chats_assigned ON chats(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_chats_last_msg ON chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FUNÇÃO AUXILIAR
-- ============================================
CREATE OR REPLACE FUNCTION is_chat_admin()
RETURNS BOOLEAN AS $$
DECLARE
  _member_id UUID;
BEGIN
  SELECT m.id INTO _member_id FROM membros m WHERE m.auth_user_id = auth.uid();
  IF _member_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM membros_permissoes mp
    WHERE mp.membro_id = _member_id AND mp.perfil = 'Administrador'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- POLÍTICAS: chats
-- ============================================
DROP POLICY IF EXISTS "chats_admin_all" ON chats;
DROP POLICY IF EXISTS "chats_select" ON chats;
DROP POLICY IF EXISTS "chats_insert" ON chats;
DROP POLICY IF EXISTS "chats_update" ON chats;

CREATE POLICY "chats_admin_all" ON chats
  FOR ALL TO authenticated
  USING (is_chat_admin())
  WITH CHECK (is_chat_admin());

CREATE POLICY "chats_select" ON chats
  FOR SELECT TO authenticated
  USING (
    assigned_to = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
  );

CREATE POLICY "chats_insert" ON chats
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "chats_update" ON chats
  FOR UPDATE TO authenticated
  USING (
    is_chat_admin()
    OR assigned_to = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
  )
  WITH CHECK (
    is_chat_admin()
    OR assigned_to = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
  );

-- ============================================
-- POLÍTICAS: messages
-- ============================================
DROP POLICY IF EXISTS "messages_admin_all" ON messages;
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;

CREATE POLICY "messages_admin_all" ON messages
  FOR ALL TO authenticated
  USING (is_chat_admin())
  WITH CHECK (is_chat_admin());

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    chat_id IN (
      SELECT c.id FROM chats c
      WHERE c.assigned_to = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
    )
  );

CREATE POLICY "messages_insert" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================
-- HABILITAR REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chats;

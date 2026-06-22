-- ============================================
-- TABELA: membros (Funcionários / Usuários do CRM)
-- ============================================
CREATE TABLE IF NOT EXISTS membros (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  cargo         TEXT DEFAULT '',
  equipe        TEXT DEFAULT '',
  pessoa        TEXT DEFAULT 'Pessoa Física',
  cpf           TEXT DEFAULT '',
  data_aniversario DATE DEFAULT NULL,
  telefone      TEXT DEFAULT '',
  notificacao_email  BOOLEAN DEFAULT true,
  notificacao_whatsapp BOOLEAN DEFAULT true,
  notificacao_som    BOOLEAN DEFAULT true,
  status        TEXT DEFAULT 'Ativo',
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS (Row Level Security)
ALTER TABLE membros ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read membros
CREATE POLICY "membros_select" ON membros
  FOR SELECT TO authenticated USING (true);

-- Policy: authenticated users can insert membros
CREATE POLICY "membros_insert" ON membros
  FOR INSERT TO authenticated WITH CHECK (true);

-- Policy: authenticated users can update membros
CREATE POLICY "membros_update" ON membros
  FOR UPDATE TO authenticated USING (true);

-- Policy: authenticated users can delete membros
CREATE POLICY "membros_delete" ON membros
  FOR DELETE TO authenticated USING (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_membros_email ON membros(email);
CREATE INDEX IF NOT EXISTS idx_membros_auth_user ON membros(auth_user_id);

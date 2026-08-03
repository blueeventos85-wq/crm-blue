-- ============================================
-- MIGRATION: Tabela de configuracoes do sistema
-- e bucket branding no Supabase Storage
-- ============================================

-- 1. Tabela de configuracoes globais
CREATE TABLE IF NOT EXISTS configuracoes_sistema (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  logo_url      TEXT DEFAULT NULL,
  favicon_url   TEXT DEFAULT NULL,
  login_logo_url TEXT DEFAULT NULL,
  updated_by    UUID REFERENCES membros(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Garantir uma linha padrao (seed)
INSERT INTO configuracoes_sistema (id)
VALUES ('00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- 2. Criar bucket branding no Storage (publico, para logos e favicon)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  5242880, -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Politicas RLS para o bucket branding
DROP POLICY IF EXISTS "Branding Public Select" ON storage.objects;
CREATE POLICY "Branding Public Select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "Branding Authenticated Upload" ON storage.objects;
CREATE POLICY "Branding Authenticated Upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'branding');

DROP POLICY IF EXISTS "Branding Authenticated Update" ON storage.objects;
CREATE POLICY "Branding Authenticated Update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'branding')
  WITH CHECK (bucket_id = 'branding');

DROP POLICY IF EXISTS "Branding Authenticated Delete" ON storage.objects;
CREATE POLICY "Branding Authenticated Delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'branding' AND auth.role() = 'authenticated');

-- 4. RLS na tabela configuracoes_sistema (leitura publica para login, admin para escrita)
ALTER TABLE configuracoes_sistema ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Configuracoes leitura publica" ON configuracoes_sistema;
CREATE POLICY "Configuracoes leitura publica"
  ON configuracoes_sistema FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Configuracoes admin escrita" ON configuracoes_sistema;
CREATE POLICY "Configuracoes admin escrita"
  ON configuracoes_sistema FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      JOIN membros m ON m.id = mp.membro_id
      WHERE m.auth_user_id = auth.uid()
      AND mp.perfil = 'Administrador'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      JOIN membros m ON m.id = mp.membro_id
      WHERE m.auth_user_id = auth.uid()
      AND mp.perfil = 'Administrador'
    )
  );

-- 5. Coluna de apoio (se nao existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'configuracoes_sistema' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE configuracoes_sistema ADD COLUMN updated_by UUID REFERENCES membros(id) ON DELETE SET NULL;
  END IF;
END $$;
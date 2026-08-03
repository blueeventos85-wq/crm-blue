-- ============================================
-- MIGRATION: Criar bucket avatars no Storage
-- ============================================

-- 1. Criar o bucket (se não existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152, -- 2MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Política: permitir qualquer pessoa ver os avatares (bucket é público)
DROP POLICY IF EXISTS "Avatars Public Select" ON storage.objects;
CREATE POLICY "Avatars Public Select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- 3. Política: usuários autenticados podem fazer upload de avatares
DROP POLICY IF EXISTS "Avatars Authenticated Upload" ON storage.objects;
CREATE POLICY "Avatars Authenticated Upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars');

-- 4. Política: usuários autenticados podem atualizar avatares
DROP POLICY IF EXISTS "Avatars Authenticated Update" ON storage.objects;
CREATE POLICY "Avatars Authenticated Update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- 5. Política: usuários autenticados podem deletar seus próprios avatares
DROP POLICY IF EXISTS "Avatars Authenticated Delete" ON storage.objects;
CREATE POLICY "Avatars Authenticated Delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- 6. Adicionar coluna foto_url na tabela membros (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'membros' AND column_name = 'foto_url'
  ) THEN
    ALTER TABLE membros ADD COLUMN foto_url TEXT;
  END IF;
END $$;

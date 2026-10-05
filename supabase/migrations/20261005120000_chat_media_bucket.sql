-- ============================================
-- MIGRATION: bucket "chat-media" (mídia grande das Conversas)
-- ============================================
-- Arquivos > 4MB anexados em Conversas sobem para este bucket e a Evolution API
-- recebe apenas uma URL assinada (o pipeline de base64 não aguenta 100MB).
--
-- IMPORTANTE (configuração fora do código):
--   O "Global file size limit" do projeto precisa ser >= 100MB.
--   Dashboard Supabase → Storage → Settings → Global file size limit.
--   Em planos Free o máximo é 50MB (aí vídeos acima de 50MB serão recusados).
--   ATUALIZADO: o limite do app virou 500MB — aplique também a migration
--   20261005130000_chat_media_bucket_512mb.sql (sobe o bucket para 512MB).
--
-- Bucket PRIVADO: o arquivo só é lido via signed URL gerada por usuário
-- autenticado (mesmo padrão do bucket "contratos").

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'chat-media',
  'chat-media',
  false,
  104857600 -- 100MB (não pode ser maior que o limite global do projeto)
)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- Políticas RLS do bucket
DROP POLICY IF EXISTS "chat_media_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_storage_delete" ON storage.objects;

-- SELECT: necessário para gerar signed URLs (createSignedUrl exige select)
CREATE POLICY "chat_media_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'chat-media' );

-- INSERT: apenas usuários autenticados podem enviar mídia
CREATE POLICY "chat_media_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'chat-media' );

-- UPDATE: necessário apenas para upsert (mantido por segurança)
CREATE POLICY "chat_media_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'chat-media' )
WITH CHECK ( bucket_id = 'chat-media' );

-- DELETE: permite remover envios que falharam (limpeza feita pelo app)
CREATE POLICY "chat_media_storage_delete"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'chat-media' );

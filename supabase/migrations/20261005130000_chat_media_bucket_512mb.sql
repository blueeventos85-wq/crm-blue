-- ============================================
-- MIGRATION: "chat-media" → 512MB por arquivo
-- ============================================
-- Antes: bucket criado com 100MB (migration 20261005120000).
-- Agora o app aceita até 500MB (CONV_MAX_FILE_BYTES); o bucket fica com
-- 512MB para dar folga ao teto do app.
--
-- IMPORTANTE (configuração fora do código):
--   O "Global file size limit" do projeto precisa ser >= 512MB.
--   Dashboard Supabase → Storage → Settings → Global file size limit.
--   Em planos Free o teto é 50MB — é necessário upgrade para Pro ($25/mês,
--   permite até 500GB por arquivo).
--   Sem esse ajuste, uploads >50MB falham com erro tratado no app.
--
-- Idempotente: pode ser executada mais de uma vez.

UPDATE storage.buckets
SET file_size_limit = 536870912 -- 512MB
WHERE id = 'chat-media';

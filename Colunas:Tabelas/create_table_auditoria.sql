CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS auditoria (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_nome  TEXT NOT NULL DEFAULT '',
  usuario_id    TEXT NOT NULL DEFAULT '',
  acao          TEXT NOT NULL DEFAULT '',
  caminho_url   TEXT NOT NULL DEFAULT '',
  modulo        TEXT NOT NULL DEFAULT '',
  dispositivo   TEXT NOT NULL DEFAULT 'Desktop',
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir acesso completo para anon"
  ON auditoria
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_modulo ON auditoria(modulo);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_nome);

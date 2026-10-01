-- FASE 0 — Meta Cloud API: constraint única por (empresa, provider) + tabela de idempotência

-- ============================================
-- 1. whatsapp_config: suportar Evolution + Meta por centro de custo
-- ============================================
DROP INDEX IF EXISTS idx_whatsapp_config_cc_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_cc_unique
  ON whatsapp_config(centros_custo_id, provider)
  WHERE centros_custo_id IS NOT NULL;

-- ============================================
-- 2. Validação do domínio de provider
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_provider_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check
      CHECK (provider IN ('evolution_api', 'meta_cloud_api')) NOT VALID;
    ALTER TABLE whatsapp_config VALIDATE CONSTRAINT whatsapp_config_provider_check;
  END IF;
END $$;

-- ============================================
-- 3. webhook_events: idempotência/audit de webhooks (brutos)
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider         TEXT NOT NULL CHECK (provider IN ('evolution_api', 'meta_cloud_api')),
  event_id         TEXT NOT NULL,
  event_type       TEXT,
  phone_number_id  TEXT,
  payload          JSONB NOT NULL,
  processed_at     TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
  ON webhook_events (created_at DESC);

-- RLS ligada sem políticas: acesso apenas via service_role (bypass)
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON webhook_events FROM anon, authenticated;

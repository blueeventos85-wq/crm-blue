-- ============================================
-- MIGRATION: Blue PRO — webhook + revert conversa
-- 1) Reverte conversa de teste (Elizabeth) para Blue Eventos
-- 2) Normaliza provider_config.instanceName (decode/trim)
-- 3) Garante config ativa da Blue PRO com "crm gisele"
-- 4) Backfill de conversas da "crm gisele" sem CC → Blue PRO
-- Execute este script no Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. REVERTER conversa de teste para Blue Eventos
--    (Elizabeth Carvalho foi criada errada sem CC e
--    depois atribuída à Blue PRO por engano — volta
--    para a Blue Eventos, dona original do contato)
-- ============================================
UPDATE conversations
SET centros_custo_id = '1918169e-d620-45f8-ba42-79a942e2ace0',
    updated_at = NOW()
WHERE id = '150f140a-4868-4782-999e-9f78f3df84fa'
  AND centros_custo_id IS DISTINCT FROM '1918169e-d620-45f8-ba42-79a942e2ace0';

-- ============================================
-- 2. NORMALIZAR instanceName em whatsapp_config
--    "crm%20gisele" / " CRM Gisele " / "crm  gisele"
--    → "crm gisele" (valor canônico)
-- ============================================
UPDATE whatsapp_config
SET provider_config = jsonb_set(
      COALESCE(provider_config, '{}'::jsonb),
      '{instanceName}',
      to_jsonb(
        lower(
          btrim(
            replace(replace(provider_config->>'instanceName', '%20', ' '), '+', ' ')
          )
        )
      )
    ),
    updated_at = NOW()
WHERE provider = 'evolution_api'
  AND provider_config ? 'instanceName'
  AND lower(
        btrim(
          replace(replace(provider_config->>'instanceName', '%20', ' '), '+', ' ')
        )
      ) = 'crm gisele'
  AND provider_config->>'instanceName' IS DISTINCT FROM 'crm gisele';

-- ============================================
-- 3. GARANTIR config ativa da Blue PRO
--    Se ainda não existe nenhuma config evolution
--    para a Blue PRO, cria uma apontando para
--    "crm gisele". Se existe mas está com CC nulo
--    e instanceName "crm gisele", repara o vínculo.
-- ============================================
DO $$
DECLARE
  v_bluepro_id UUID := 'f6b86575-6f66-4786-a220-451fcf10db36';
  v_config_id UUID;
BEGIN
  -- a) Já existe config da Blue PRO?
  SELECT id INTO v_config_id
  FROM whatsapp_config
  WHERE provider = 'evolution_api'
    AND centros_custo_id = v_bluepro_id
  LIMIT 1;

  IF v_config_id IS NOT NULL THEN
    -- Config existe — garante que o instanceName é "crm gisele"
    UPDATE whatsapp_config
    SET provider_config = jsonb_set(
          COALESCE(provider_config, '{}'::jsonb),
          '{instanceName}',
          '"crm gisele"'
        ),
        updated_at = NOW()
    WHERE id = v_config_id
      AND lower(
            btrim(
              replace(replace(provider_config->>'instanceName', '%20', ' '), '+', ' ')
            )
          ) = 'crm gisele'
      AND provider_config->>'instanceName' IS DISTINCT FROM 'crm gisele';
    RAISE NOTICE '[bluepro] Config da Blue PRO já existia (id=%) — instanceName normalizado se necessário.', v_config_id;
  ELSE
    -- b) Não existe config da Blue PRO — procura uma órfã "crm gisele" e repara o vínculo
    UPDATE whatsapp_config
    SET centros_custo_id = v_bluepro_id,
        updated_at = NOW()
    WHERE provider = 'evolution_api'
      AND lower(
            btrim(
              replace(replace(provider_config->>'instanceName', '%20', ' '), '+', ' ')
            )
          ) = 'crm gisele'
      AND centros_custo_id IS NULL;

    IF FOUND THEN
      RAISE NOTICE '[bluepro] Instância órfã "crm gisele" reatribuída à Blue PRO.';
    ELSE
      -- c) Nenhuma config — cria uma nova
      INSERT INTO whatsapp_config (provider, provider_config, status, centros_custo_id, created_at, updated_at)
      VALUES (
        'evolution_api',
        jsonb_build_object('instanceName', 'crm gisele', 'integration', 'WHATSAPP-BAILEYS'),
        'connected',
        v_bluepro_id,
        NOW(),
        NOW()
      );
      RAISE NOTICE '[bluepro] Nova config criada para "crm gisele" → Blue PRO.';
    END IF;
  END IF;
END $$;

-- ============================================
-- 4. BACKFILL: conversas da "crm gisele" sem CC
--    → Blue PRO (quando o contato não pertence a outra empresa)
-- ============================================
UPDATE conversations c
SET centros_custo_id = 'f6b86575-6f66-4786-a220-451fcf10db36',
    updated_at = NOW()
FROM whatsapp_config wc
WHERE wc.provider = 'evolution_api'
  AND lower(
        btrim(
          replace(replace(wc.provider_config->>'instanceName', '%20', ' '), '+', ' ')
        )
      ) = 'crm gisele'
  AND wc.centros_custo_id = 'f6b86575-6f66-4786-a220-451fcf10db36'
  AND c.centros_custo_id IS NULL
  AND c.contact_id IN (
    SELECT ct.id FROM contacts ct
    WHERE ct.centros_custo_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.contact_id = c.contact_id
      AND c2.centros_custo_id = '1918169e-d620-45f8-ba42-79a942e2ace0'
      AND c2.id <> c.id
  );

-- ============================================
-- DIAGNÓSTICO: confira o resultado
-- ============================================
-- 1. Conversa da Elizabeth revertida:
SELECT id, centros_custo_id, updated_at
FROM conversations
WHERE id = '150f140a-4868-4782-999e-9f78f3df84fa';

-- 2. Configs WhatsApp e vínculo com empresa:
SELECT
  wc.id,
  wc.status,
  wc.centros_custo_id,
  cc.nome AS empresa,
  wc.provider_config->>'instanceName' AS instance_name,
  wc.created_at
FROM whatsapp_config wc
LEFT JOIN centros_custo cc ON cc.id = wc.centros_custo_id
WHERE wc.provider = 'evolution_api'
ORDER BY wc.created_at DESC;

-- 3. Conversas por empresa:
SELECT
  COALESCE(cc.nome, '(sem empresa)') AS empresa,
  COUNT(*) AS total
FROM conversations c
LEFT JOIN centros_custo cc ON cc.id = c.centros_custo_id
GROUP BY 1
ORDER BY 2 DESC;

-- 4. Conversas recentes da Blue PRO:
SELECT c.id, c.last_message_text, c.is_archived, c.created_at
FROM conversations c
WHERE c.centros_custo_id = 'f6b86575-6f66-4786-a220-451fcf10db36'
ORDER BY c.created_at DESC
LIMIT 10;

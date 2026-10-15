-- ============================================
-- MIGRATION: WhatsApp multi-instância — fix "Blue PRO"
-- 1) Diagnóstico ( SELECTs ao final do bloco )
-- 2) Vincula a instância "crm gisele" à empresa Blue PRO
-- 3) Restaura RLS de SELECT em conversations/messages
--    (acesso por centro de custo + dono + admin)
-- 4) Backfill de conversas órfãs (centros_custo_id NULL)
--    da instância "crm gisele" para a Blue PRO
-- Execute este script no Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. VINCULAR "crm gisele" → Blue PRO (idempotente)
--    Só executa se a empresa Blue PRO ainda não tiver
--    outra instância vinculada.
-- ============================================
DO $$
DECLARE
  v_bluepro_id UUID;
  v_tem_outra BOOLEAN;
BEGIN
  SELECT id INTO v_bluepro_id
  FROM centros_custo
  WHERE nome ILIKE 'Blue PRO'
  LIMIT 1;

  IF v_bluepro_id IS NULL THEN
    RAISE NOTICE '[bluepro] Empresa "Blue PRO" não encontrada — pulei o vínculo.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM whatsapp_config
    WHERE provider = 'evolution_api'
      AND centros_custo_id = v_bluepro_id
      AND provider_config->>'instanceName' IS DISTINCT FROM 'crm gisele'
  ) INTO v_tem_outra;

  IF v_tem_outra THEN
    RAISE NOTICE '[bluepro] A Blue PRO já possui outra instância vinculada — pulei o vínculo automático. Use "Vincular instância existente" na tela.';
    RETURN;
  END IF;

  UPDATE whatsapp_config
  SET centros_custo_id = v_bluepro_id,
      updated_at = NOW()
  WHERE provider = 'evolution_api'
    AND provider_config->>'instanceName' = 'crm gisele'
    AND (centros_custo_id IS NULL OR centros_custo_id = v_bluepro_id);

  IF FOUND THEN
    RAISE NOTICE '[bluepro] Instância "crm gisele" vinculada à Blue PRO. Depois rode "Sincronizar" na tela (registra o webhook).';
  ELSE
    RAISE NOTICE '[bluepro] Nenhuma config com instanceName "crm gisele" no banco. Use "Vincular instância existente" na tela (a instância pode nunca ter sido registrada aqui).';
  END IF;
END $$;

-- ============================================
-- 2. RLS: restaurar SELECT por centro de custo
--    (desfaz o isolamento total se ele foi aplicado)
-- ============================================
DROP POLICY IF EXISTS "conversations_select" ON conversations;

CREATE POLICY "conversations_select" ON conversations
  FOR SELECT TO authenticated
  USING (
    membro_id = get_current_member_id()
    OR centros_custo_id IN (
      SELECT mcc.centro_custo_id
      FROM membro_centros_custo mcc
      WHERE mcc.membro_id = get_current_member_id()
    )
    OR membro_id IS NULL
    OR is_admin()
  );

DROP POLICY IF EXISTS "messages_select" ON messages;

CREATE POLICY "messages_select" ON messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      WHERE c.membro_id = get_current_member_id()
         OR c.centros_custo_id IN (
           SELECT mcc.centro_custo_id
           FROM membro_centros_custo mcc
           WHERE mcc.membro_id = get_current_member_id()
         )
         OR c.membro_id IS NULL
    )
  );

-- ============================================
-- 3. REMOVER instância duplicada órfã "gisele"
--    (config sem empresa, criada fora do fluxo —
--    conflita com a "crm gisele" da Blue PRO)
-- ============================================
DELETE FROM whatsapp_config
WHERE provider = 'evolution_api'
  AND provider_config->>'instanceName' = 'gisele'
  AND centros_custo_id IS NULL;

-- ============================================
-- 4. BACKFILL: conversas órfãs da "crm gisele" → Blue PRO
--    (pré-visualização primeiro; o UPDATE abaixo é guardado)
-- ============================================
-- Pré-visualização (rode antes para conferir o que será migrado):
-- SELECT c.id, c.membro_id, c.centros_custo_id, c.last_message_at
-- FROM conversations c
-- JOIN whatsapp_config wc
--   ON wc.provider = 'evolution_api'
--  AND wc.provider_config->>'instanceName' = 'crm gisele'
--  AND c.membro_id = wc.membro_id
-- WHERE c.centros_custo_id IS NULL
--   AND wc.centros_custo_id IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM conversations c2
--     WHERE c2.contact_id = c.contact_id
--       AND c2.centros_custo_id IS NOT NULL
--       AND c2.id <> c.id
--   );

UPDATE conversations c
SET centros_custo_id = wc.centros_custo_id,
    updated_at = NOW()
FROM whatsapp_config wc
WHERE wc.provider = 'evolution_api'
  AND wc.provider_config->>'instanceName' = 'crm gisele'
  AND wc.centros_custo_id IS NOT NULL
  AND c.centros_custo_id IS NULL
  AND c.membro_id = wc.membro_id
  -- Não tocar em contatos que já têm conversa vinculada a outra empresa
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.contact_id = c.contact_id
      AND c2.centros_custo_id IS NOT NULL
      AND c2.id <> c.id
  );

-- ============================================
-- DIAGNÓSTICO: confira o resultado após executar
-- ============================================
-- 1. Configs WhatsApp e vínculo com empresa:
SELECT
  wc.id,
  wc.status,
  wc.centros_custo_id,
  cc.nome AS empresa,
  wc.provider_config->>'instanceName' AS instance_name,
  wc.provider_config->>'numero' AS numero,
  wc.created_at
FROM whatsapp_config wc
LEFT JOIN centros_custo cc ON cc.id = wc.centros_custo_id
WHERE wc.provider = 'evolution_api'
ORDER BY wc.created_at DESC;

-- 2. Conversas por empresa (azuis: as que ficaram sem CC):
SELECT
  COALESCE(cc.nome, '(sem empresa)') AS empresa,
  COUNT(*) AS total_conversas
FROM conversations c
LEFT JOIN centros_custo cc ON cc.id = c.centros_custo_id
GROUP BY 1
ORDER BY 2 DESC;

-- 3. Policies de SELECT atuais em conversations e messages:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('conversations', 'messages') AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- 4. Conferir se a "crm gisele" ficou vinculada:
SELECT wc.centros_custo_id, cc.nome
FROM whatsapp_config wc
LEFT JOIN centros_custo cc ON cc.id = wc.centros_custo_id
WHERE wc.provider_config->>'instanceName' = 'crm gisele';

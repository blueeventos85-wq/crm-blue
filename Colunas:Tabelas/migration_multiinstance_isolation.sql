-- ============================================
-- MIGRATION: Isolamento Multi-Instância WhatsApp
-- Garante que o mesmo telefone possa existir
-- como leads/contacts distintos em CCs diferentes.
-- ============================================

-- ============================================
-- 1. BACKFILL: Garantir que contacts tenham centros_custo_id
-- ============================================
UPDATE contacts c
SET centros_custo_id = (
  SELECT cv.centros_custo_id
  FROM conversations cv
  WHERE cv.contact_id = c.id
    AND cv.centros_custo_id IS NOT NULL
  LIMIT 1
)
WHERE c.centros_custo_id IS NULL
  AND EXISTS (
    SELECT 1 FROM conversations cv
    WHERE cv.contact_id = c.id
      AND cv.centros_custo_id IS NOT NULL
  );

-- ============================================
-- 2. BACKFILL: Garantir que conversations tenham lead_id via contacts
-- ============================================
UPDATE conversations cv
SET lead_id = (
  SELECT c.lead_id
  FROM contacts c
  WHERE c.id = cv.contact_id
    AND c.lead_id IS NOT NULL
  LIMIT 1
)
WHERE cv.lead_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = cv.contact_id
      AND c.lead_id IS NOT NULL
  );

-- ============================================
-- 3. DEDUPLICAR: leads com mesmo telefone + centro_custo_id
-- Mantém apenas o registro mais recente (created_at DESC).
-- Redireciona contacts, conversations e messages para o lead sobrevivente.
-- ============================================
DO $$
DECLARE
  dups RECORD;
  surviving UUID;
  dup_ids UUID[];
  deleted_count INT := 0;
BEGIN
  -- Para cada grupo de duplicatas, manter o mais recente
  FOR dups IN
    SELECT telefone, centro_custo_id, COUNT(*) as cnt
    FROM leads
    WHERE centro_custo_id IS NOT NULL AND telefone IS NOT NULL
    GROUP BY telefone, centro_custo_id
    HAVING COUNT(*) > 1
  LOOP
    -- Selecionar o lead sobrevivente (mais recente)
    SELECT id INTO surviving
    FROM leads
    WHERE telefone = dups.telefone
      AND centro_custo_id = dups.centro_custo_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Coletar ids dos leads duplicados (para redirecionar FKs)
    SELECT ARRAY_AGG(id) INTO dup_ids
    FROM leads
    WHERE telefone = dups.telefone
      AND centro_custo_id = dups.centro_custo_id
      AND id != surviving;

    -- Redirecionar contacts (ON DELETE SET NULL → transferir para sobrevivente)
    UPDATE contacts
    SET lead_id = surviving
    WHERE lead_id = ANY(dup_ids);

    -- Redirecionar conversations (ON DELETE SET NULL → transferir para sobrevivente)
    UPDATE conversations
    SET lead_id = surviving
    WHERE lead_id = ANY(dup_ids);

    -- Redirecionar contratos (ON DELETE RESTRICT → transferir para sobrevivente)
    UPDATE contratos
    SET lead_id = surviving
    WHERE lead_id = ANY(dup_ids);

    -- Redirecionar lead_movements (ON DELETE CASCADE → preservar dados)
    UPDATE lead_movements
    SET lead_id = surviving
    WHERE lead_id = ANY(dup_ids);

    -- Redirecionar lead_activities (ON DELETE CASCADE → preservar dados)
    UPDATE lead_activities
    SET lead_id = surviving
    WHERE lead_id = ANY(dup_ids);

    -- Agora sim deletar leads duplicados
    DELETE FROM leads
    WHERE id = ANY(dup_ids);

    deleted_count := deleted_count + array_length(dup_ids, 1);
    RAISE NOTICE 'Dedup: telefone=%, CC=%, sobrevivente=%, removidos=%',
      dups.telefone, dups.centro_custo_id, surviving, array_length(dup_ids, 1);
  END LOOP;

  IF deleted_count > 0 THEN
    RAISE NOTICE 'Total de leads duplicados removidos: %', deleted_count;
  ELSE
    RAISE NOTICE 'Nenhum lead duplicado encontrado.';
  END IF;
END $$;

-- ============================================
-- 4. UNIQUE CONSTRAINT: leads(telefone, centro_custo_id)
-- Permite o mesmo telefone em CCs diferentes,
-- impede duplicatas dentro do mesmo CC.
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_cc_unique
  ON leads(telefone, centro_custo_id)
  WHERE centro_custo_id IS NOT NULL AND telefone IS NOT NULL;

-- ============================================
-- 5. INDEX: Acelerar buscas do webhook
-- ============================================
CREATE INDEX IF NOT EXISTS idx_contacts_phone_cc
  ON contacts(phone, centros_custo_id)
  WHERE centros_custo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_phone_cc
  ON leads(telefone, centro_custo_id)
  WHERE centro_custo_id IS NOT NULL AND telefone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_contact_cc
  ON conversations(contact_id, centros_custo_id)
  WHERE centros_custo_id IS NOT NULL;

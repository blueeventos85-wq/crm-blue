-- ============================================
-- MIGRATION: Multi-tenancy de conversas
-- Mesmo número (remote_jid) pode existir em
-- empresas diferentes sem conflito.
-- 1) Diagnóstico de duplicatas atuais
-- 2) Dedupe guardado (arquiva duplicatas — não apaga)
-- 3) UNIQUE composto (remote_jid, centros_custo_id, membro_id)
-- 4) Diagnóstico final
-- Execute no Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. DIAGNÓSTICO: duplicatas que bloqueariam o UNIQUE
-- ============================================
SELECT
  remote_jid,
  centros_custo_id,
  membro_id,
  COUNT(*) AS total,
  array_agg(id ORDER BY last_message_at DESC NULLS LAST) AS conversa_ids
FROM conversations
WHERE remote_jid IS NOT NULL
GROUP BY remote_jid, centros_custo_id, membro_id
HAVING COUNT(*) > 1
ORDER BY total DESC;

-- ============================================
-- 2. DEDUPE GUARDADO
--    Para cada grupo (remote_jid, cc, membro) com
--    múltiplas conversas ABERTAS, mantém a mais
--    recente e arquiva as demais (não apaga).
-- ============================================
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY remote_jid, centros_custo_id, membro_id
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM conversations
  WHERE remote_jid IS NOT NULL
    AND status = 'open'
)
UPDATE conversations c
SET is_archived = true,
    status = 'closed',
    updated_at = NOW()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- ============================================
-- 3. UNIQUE COMPOSTO
--    1 conversa por (número, empresa, corretor).
--    NULLs são distintos no Postgres → linhas
--    legadas sem cc/membro não bloqueiam.
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS conversations_rjid_cc_membro_unique
  ON conversations(remote_jid, centros_custo_id, membro_id)
  WHERE remote_jid IS NOT NULL;

-- ============================================
-- 4. DIAGNÓSTICO FINAL
-- ============================================
-- Índice criado:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'conversations'
  AND indexname = 'conversations_rjid_cc_membro_unique';

-- Amostra: mesmo remote_jid em empresas diferentes (cenário Blue Eventos × Blue PRO):
SELECT
  remote_jid,
  cc.nome AS empresa,
  c.membro_id,
  c.status,
  c.is_archived,
  c.last_message_at
FROM conversations c
LEFT JOIN centros_custo cc ON cc.id = c.centros_custo_id
WHERE c.remote_jid IN (
  SELECT remote_jid FROM conversations
  WHERE remote_jid IS NOT NULL AND centros_custo_id IS NOT NULL
  GROUP BY remote_jid
  HAVING COUNT(DISTINCT centros_custo_id) > 1
)
ORDER BY c.remote_jid, c.last_message_at DESC NULLS LAST
LIMIT 20;

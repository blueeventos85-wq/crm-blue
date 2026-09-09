-- ============================================
-- SCRIPT: Limpar conversas orfas (membro_id IS NULL)
-- Atribui membro_id do dono da instancia WhatsApp
-- correspondente ao centro_custo da conversa.
-- Execute este script no Supabase SQL Editor.
-- ============================================

-- Passo 1: Verificar quantas conversas orfas existem
SELECT COUNT(*) AS conversas_orfas
FROM conversations
WHERE membro_id IS NULL;

-- Passo 2: Visualizar para quais centros_custo as orfas pertencem
-- e quem e o dono da instancia
SELECT
  c.centros_custo_id,
  cc.nome AS centro_custo_nome,
  COUNT(*) AS qtd_orfas,
  wc.membro_id AS dono_instancia,
  m.nome AS nome_dono
FROM conversations c
LEFT JOIN centros_custo cc ON cc.id = c.centros_custo_id
LEFT JOIN whatsapp_config wc ON wc.centros_custo_id = c.centros_custo_id
  AND wc.provider = 'evolution_api'
LEFT JOIN membros m ON m.id = wc.membro_id
WHERE c.membro_id IS NULL
GROUP BY c.centros_custo_id, cc.nome, wc.membro_id, m.nome;

-- Passo 3: Atualizar conversas orfas com o membro_id do dono da instancia
UPDATE conversations c
SET membro_id = wc.membro_id,
    updated_at = NOW()
FROM whatsapp_config wc
WHERE c.membro_id IS NULL
  AND c.centros_custo_id = wc.centros_custo_id
  AND wc.provider = 'evolution_api'
  AND wc.membro_id IS NOT NULL;

-- Passo 4: Verificar quantas restaram
-- (devia ser 0 ou apenas centros sem instancia configurada)
SELECT
  c.centros_custo_id,
  cc.nome,
  COUNT(*) AS orfas_restantes
FROM conversations c
LEFT JOIN centros_custo cc ON cc.id = c.centros_custo_id
WHERE c.membro_id IS NULL
GROUP BY c.centros_custo_id, cc.nome;

-- Passo 5 (OPCIONAL): Se ainda houver orfas sem instancia correspondente,
-- atribuir ao primeiro membro ativo daquele centro de custo
UPDATE conversations c
SET membro_id = (
    SELECT mcc.membro_id
    FROM membro_centros_custo mcc
    WHERE mcc.centro_custo_id = c.centros_custo_id
    LIMIT 1
  ),
  updated_at = NOW()
WHERE c.membro_id IS NULL
  AND c.centros_custo_id IS NOT NULL;

-- Passo 6: Deletar qualquer orfa restante sem centro de custo (lixo)
DELETE FROM conversations
WHERE membro_id IS NULL;

-- Passo 7: Verificacao final — deve retornar 0
SELECT COUNT(*) AS orfas_restantes
FROM conversations
WHERE membro_id IS NULL;

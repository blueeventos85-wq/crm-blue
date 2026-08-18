-- ============================================
-- MIGRATION: Insert 'Novo lead' cadence
-- Run this FIRST, then copy the generated UUID
-- into mapaCadencias in app.js
-- ============================================

INSERT INTO public.cadencias (nome)
VALUES ('Novo lead')
RETURNING id;

-- After running, copy the UUID from the result
-- and update:
-- 1. app.js → mapaCadencias["novo-lead"] = "UUID-AQUI"
-- 2. app.js → cadences array (add as first item)
-- 3. supabaseClient.js → KANBAN_COLUMN_IDS (add 'novo-lead' as first)
-- 4. supabaseClient.js → DEFAULT_CADENCE_ID

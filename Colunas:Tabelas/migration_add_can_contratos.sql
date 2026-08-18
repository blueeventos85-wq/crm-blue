-- ============================================================
-- Migration: Adicionar coluna can_contratos à tabela membros_permissoes
-- Segue o mesmo padrão das demais colunas de permissão (can_crm, can_conversas, etc.)
-- Execute este SQL no Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- ============================================================

-- 1. Adicionar a coluna (idempotente — não erro se já existir)
ALTER TABLE public.membros_permissoes
ADD COLUMN IF NOT EXISTS can_contratos BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Garantir que administradores existentes tenham acesso
UPDATE public.membros_permissoes
   SET can_contratos = true
 WHERE perfil = 'Administrador'
   AND can_contratos IS DISTINCT FROM true;

-- 3. Todos os demais membros ficam sem acesso (false) até o administrador selecionar
-- Nenhuma ação necessária: o DEFAULT false já cobre registros novos e existentes não-admin

-- 4. Verificar resultado
SELECT mp.membro_id, m.nome, mp.perfil, mp.can_contratos
  FROM public.membros_permissoes mp
  JOIN public.membros m ON m.id = mp.membro_id
 ORDER BY mp.perfil, m.nome;

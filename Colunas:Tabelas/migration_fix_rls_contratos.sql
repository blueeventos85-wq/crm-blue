-- MIGRAÇÃO: Corrigir RLS da tabela contratos para usuários autenticados
-- Executar no Supabase SQL Editor

-- Garantir que RLS está habilitado
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas restritivas
DROP POLICY IF EXISTS "contratos_admin_all" ON public.contratos;
DROP POLICY IF EXISTS "contratos_select" ON public.contratos;
DROP POLICY IF EXISTS "contratos_insert" ON public.contratos;
DROP POLICY IF EXISTS "contratos_update" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_select_contratos" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_insert_contratos" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_update_contratos" ON public.contratos;

-- Criar políticas temporárias para usuários autenticados
-- TODO: Substituir "using (true)" por regras baseadas em empresa/permissões

CREATE POLICY "authenticated_can_select_contratos"
ON public.contratos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "authenticated_can_insert_contratos"
ON public.contratos
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_can_update_contratos"
ON public.contratos
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Não criar política de DELETE — contratos devem permanecer no histórico

-- Atualizar cache do PostgREST
NOTIFY pgrst, 'reload schema';

-- Listar políticas ativas para confirmação
DO $$
DECLARE
  pol RECORD;
BEGIN
  RAISE NOTICE 'Políticas RLS ativas na tabela contratos:';
  FOR pol IN
    SELECT policyname, cmd, roles
    FROM pg_policies
    WHERE tablename = 'contratos' AND schemaname = 'public'
  LOOP
    RAISE NOTICE '  Policy: %, cmd: %, roles: %', pol.policyname, pol.cmd, pol.roles;
  END LOOP;
END $$;

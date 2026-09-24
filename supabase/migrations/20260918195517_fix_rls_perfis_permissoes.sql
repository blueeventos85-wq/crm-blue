-- ============================================================
-- Migration: Corrigir RLS da tabela perfis_permissoes
-- Substitui verificações inline por is_admin() para consistência
-- com as demais tabelas do sistema (leads, rotinas, membros, etc).
-- ============================================================

-- 1. Garantir que is_admin() existe (defensivo)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  _member_id UUID;
BEGIN
  SELECT m.id INTO _member_id FROM membros m WHERE m.auth_user_id = auth.uid();
  IF _member_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM membros_permissoes mp
    WHERE mp.membro_id = _member_id AND mp.perfil = 'Administrador'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 2. Remover políticas antigas
DROP POLICY IF EXISTS "perfis_permissoes_select" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_insert" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_update" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_delete" ON perfis_permissoes;

-- 3. Criar novas políticas usando is_admin()
-- SELECT: qualquer usuário autenticado pode visualizar (permite tela de config carregar)
CREATE POLICY "perfis_permissoes_select" ON perfis_permissoes
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: apenas administradores podem criar novos perfis
CREATE POLICY "perfis_permissoes_insert" ON perfis_permissoes
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- UPDATE: apenas administradores podem alterar permissões
CREATE POLICY "perfis_permissoes_update" ON perfis_permissoes
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- DELETE: apenas administradores podem remover perfis
CREATE POLICY "perfis_permissoes_delete" ON perfis_permissoes
  FOR DELETE TO authenticated
  USING (is_admin());

-- 4. Atualizar cache do PostgREST
NOTIFY pgrst, 'reload schema';

-- 5. Verificar políticas aplicadas
DO $$
DECLARE
  pol RECORD;
BEGIN
  RAISE NOTICE 'Políticas RLS ativas na tabela perfis_permissoes:';
  FOR pol IN
    SELECT policyname, cmd, roles
    FROM pg_policies
    WHERE tablename = 'perfis_permissoes' AND schemaname = 'public'
  LOOP
    RAISE NOTICE '  Policy: %, cmd: %, roles: %', pol.policyname, pol.cmd, pol.roles;
  END LOOP;
END $$;

-- ============================================
-- MIGRAÇÃO: Corrigir política RLS UPDATE na tabela eventos
-- A coluna correta é created_by (não user_id ou membro_id)
-- ============================================

-- 1. Verificar estrutura da tabela eventos
DO $$
BEGIN
  RAISE NOTICE 'Colunas da tabela eventos:';
END $$;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'eventos' 
ORDER BY ordinal_position;

-- 2. Remover políticas antigas com nomes incorretos (se existirem)
DROP POLICY IF EXISTS "eventos_update_user_id" ON eventos;
DROP POLICY IF EXISTS "eventos_update_membro_id" ON eventos;

-- 3. Garantir que a política UPDATE correta existe
DROP POLICY IF EXISTS "eventos_update" ON eventos;

CREATE POLICY "eventos_update" ON eventos
  FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR created_by = get_membro_id(auth.uid())
  )
  WITH CHECK (
    is_admin(auth.uid())
    OR created_by = get_membro_id(auth.uid())
  );

-- 4. Verificar se as funções helper existem
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin') THEN
    RAISE WARNING 'Função is_admin não existe! Execute migration_security_hardening.sql primeiro.';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_membro_id') THEN
    RAISE WARNING 'Função get_membro_id não existe! Execute migration_security_hardening.sql primeiro.';
  END IF;
END $$;

-- 5. Mensagem de sucesso
DO $$
BEGIN
  RAISE NOTICE 'Política eventos_update criada com sucesso usando created_by.';
  RAISE NOTICE 'A política permite: Admins editam todos, membros editam apenas os que criaram.';
END $$;

-- ============================================
-- MIGRAÇÃO: Verificar/Corrigir política RLS INSERT na tabela rotinas
-- Permite que Atendentes insiram rotinas vinculadas ao próprio ID
-- ============================================

-- 1. Verificar se a política INSERT já existe
DO $$
BEGIN
  -- Remover política INSERT antiga se existir
  DROP POLICY IF EXISTS "rotinas_insert" ON rotinas;
  
  -- Criar política INSERT que verifica membro_id
  CREATE POLICY "rotinas_insert" ON rotinas
    FOR INSERT TO authenticated
    WITH CHECK (
      membro_id = get_current_member_id()
    );
    
  RAISE NOTICE 'Política rotinas_insert criada/atualizada com sucesso.';
  RAISE NOTICE 'O membro_id deve corresponder ao membro autenticado.';
END $$;

-- 2. Verificar se a função get_current_member_id existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_current_member_id') THEN
    CREATE OR REPLACE FUNCTION get_current_member_id()
    RETURNS UUID AS $$
    BEGIN
      RETURN (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid());
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
    RAISE NOTICE 'Função get_current_member_id criada.';
  ELSE
    RAISE NOTICE 'Função get_current_member_id já existe.';
  END IF;
END $$;

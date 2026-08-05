-- ============================================
-- MIGRAÇÃO: Atualizar política RLS INSERT na tabela eventos
-- Permite que Atendentes insiram eventos vinculados ao próprio ID
-- ============================================

-- 1. Remover política INSERT antiga (se existir)
DROP POLICY IF EXISTS "eventos_insert" ON eventos;

-- 2. Criar nova política INSERT mais restritiva
-- Garante que o created_by seja sempre o membro autenticado
CREATE POLICY "eventos_insert" ON eventos
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = get_membro_id(auth.uid())
  );

-- 3. Verificar se a política foi criada
DO $$
BEGIN
  RAISE NOTICE 'Política eventos_insert atualizada com sucesso.';
  RAISE NOTICE 'Agora o created_by deve corresponder ao membro autenticado.';
END $$;

-- ============================================
-- FIX: is_admin() deve verificar membros.cargo (fonte autoritativa)
-- ============================================
-- O problema: a função is_admin() verifica membros_permissoes.perfil, 
-- mas a fonte autoritativa do cargo do usuário é membros.cargo.
-- Isso causa inconsistência onde usuários com cargo 'Administrador' 
-- na tabela membros não têm acesso total se membros_permissoes.perfil 
-- estiver desatualizado.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  _member_id UUID;
  _cargo TEXT;
BEGIN
  SELECT m.id, m.cargo INTO _member_id, _cargo 
  FROM membros m 
  WHERE m.auth_user_id = auth.uid();
  
  IF _member_id IS NULL THEN
    RETURN true;
  END IF;
  
  -- Verifica cargo na tabela membros (fonte autoritativa)
  RETURN _cargo = 'Administrador';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Também atualiza get_current_member_id para ser consistente
CREATE OR REPLACE FUNCTION get_current_member_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
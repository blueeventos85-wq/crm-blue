-- ============================================
-- MIGRATION: Tabela de Permissões Globais por Perfil
-- Armazena as configurações de permissão por cargo (Administrador, Atendente, etc.)
-- ============================================

-- 1. Criar tabela perfis_permissoes
CREATE TABLE IF NOT EXISTS public.perfis_permissoes (
  perfil        TEXT PRIMARY KEY,           -- 'Administrador', 'Atendente', 'Marketing', 'Pre Vendas', 'Membro'
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Todas as permissões CRUD + sidebar + sensíveis
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Habilitar RLS
ALTER TABLE public.perfis_permissoes ENABLE ROW LEVEL SECURITY;

-- 3. Policies
DROP POLICY IF EXISTS "perfis_permissoes_select" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_insert" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_update" ON perfis_permissoes;
DROP POLICY IF EXISTS "perfis_permissoes_delete" ON perfis_permissoes;

-- Apenas administradores podem gerenciar as permissões globais
CREATE POLICY "perfis_permissoes_select" ON perfis_permissoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = get_current_member_id()
      AND mp.perfil = 'Administrador'
    )
  );

CREATE POLICY "perfis_permissoes_insert" ON perfis_permissoes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = get_current_member_id()
      AND mp.perfil = 'Administrador'
    )
  );

CREATE POLICY "perfis_permissoes_update" ON perfis_permissoes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = get_current_member_id()
      AND mp.perfil = 'Administrador'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = get_current_member_id()
      AND mp.perfil = 'Administrador'
    )
  );

CREATE POLICY "perfis_permissoes_delete" ON perfis_permissoes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = get_current_member_id()
      AND mp.perfil = 'Administrador'
    )
  );

-- 4. Trigger para updated_at
DROP TRIGGER IF EXISTS perfis_permissoes_updated_at ON perfis_permissoes;
CREATE TRIGGER perfis_permissoes_updated_at
  BEFORE UPDATE ON perfis_permissoes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 5. Inserir dados padrão (seed inicial)
INSERT INTO public.perfis_permissoes (perfil, permissions) VALUES
('Administrador', '{
  "home": true, "dashboard": true, "crm": true, "contratos": true, "cliente_base": true, "calendario": true,
  "rotina_blue": true, "pomodoro": true, "conversas": true, "configuracoes": true,
  "auditoria": true, "administrador": true, "obrigacoes": true, "documentos": true, "suporte": true,
  "calibragem": true, "delete_telefone": true,
  "can_contratos_create": true, "can_contratos_read": true, "can_contratos_update": true, "can_contratos_delete": true,
  "can_contratos_assinado_upload": true, "can_contratos_cancelar": true,
  "can_leads_create": true, "can_leads_read": true, "can_leads_update": true, "can_leads_delete": true,
  "can_leads_export": true, "can_leads_import": true, "can_leads_add_phone": true, "can_leads_transferir": true,
  "can_conversas_create": true, "can_conversas_read": true, "can_conversas_update": true, "can_conversas_delete": true,
  "can_conversas_transferir": true, "can_conversas_delete_msg": true, "can_conversas_sync_lead": true,
  "can_calendario_create": true, "can_calendario_read": true, "can_calendario_update": true, "can_calendario_delete": true,
  "can_rotina_create": true, "can_rotina_read": true, "can_rotina_update": true, "can_rotina_delete": true,
  "can_config_read": true, "can_config_update": true, "can_config_whatsapp": true, "can_config_integracao": true,
  "can_auditoria_read": true, "can_auditoria_export": true,
  "can_admin_create_user": true, "can_admin_read_user": true, "can_admin_update_user": true, "can_admin_delete_user": true,
  "can_admin_manage_perms": true, "can_admin_manage_cc": true
}'),
('Atendente', '{
  "home": false, "dashboard": false, "crm": true, "contratos": false, "cliente_base": true, "calendario": true,
  "rotina_blue": true, "pomodoro": true, "conversas": true, "configuracoes": false,
  "auditoria": false, "administrador": false, "calibragem": false, "delete_telefone": false,
  "can_contratos_create": true, "can_contratos_read": true, "can_contratos_update": true, "can_contratos_assinado_upload": true,
  "can_leads_create": true, "can_leads_read": true, "can_leads_update": true, "can_leads_add_phone": true,
  "can_conversas_create": true, "can_conversas_read": true, "can_conversas_update": true, "can_conversas_transferir": true, "can_conversas_sync_lead": true,
  "can_calendario_create": true, "can_calendario_read": true, "can_calendario_update": true,
  "can_rotina_create": true, "can_rotina_read": true, "can_rotina_update": true,
  "can_config_read": true,
  "can_auditoria_read": true
}'),
('Marketing', '{
  "home": true, "dashboard": true, "crm": true, "contratos": false, "cliente_base": true, "calendario": true,
  "rotina_blue": false, "pomodoro": false, "conversas": false, "configuracoes": true,
  "auditoria": true, "administrador": false, "calibragem": false, "delete_telefone": true,
  "can_leads_read": true, "can_leads_export": true,
  "can_contratos_read": true,
  "can_conversas_read": true,
  "can_config_read": true
}'),
('Pre Vendas', '{
  "home": true, "dashboard": true, "crm": true, "cliente_base": true,
  "conversas": true,
  "can_leads_create": true, "can_leads_read": true, "can_leads_update": true,
  "can_conversas_create": true, "can_conversas_read": true, "can_conversas_sync_lead": true
}'),
('Membro', '{
  "home": true, "dashboard": true,
  "can_leads_read": true
}')
ON CONFLICT (perfil) DO NOTHING;

-- 6. Verificar
SELECT perfil, permissions FROM perfis_permissoes ORDER BY perfil;
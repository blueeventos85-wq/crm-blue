-- ============================================
-- MIGRAÇÃO: lead_movements + lead_activities
-- Tabelas para histórico de movimentação e atividades do lead
-- ============================================

-- 1. Tabela: lead_movements (movimentação de cadência/temperatura)
CREATE TABLE IF NOT EXISTS lead_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('cadencia', 'temperatura')),
  from_value TEXT,
  to_value TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_movements_lead_id ON lead_movements(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_movements_created_at ON lead_movements(created_at DESC);

-- 2. Tabela: lead_activities (atividades do corretor)
CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES membros(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL DEFAULT 'Anotação',
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_user_id ON lead_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_at ON lead_activities(created_at DESC);

-- 3. Habilitar RLS
ALTER TABLE lead_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS para lead_movements
DROP POLICY IF EXISTS "lead_movements_select" ON lead_movements;
CREATE POLICY "lead_movements_select" ON lead_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_movements.lead_id
      AND (
        EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
          AND mp.perfil = 'Administrador'
        )
        OR NOT EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        )
        OR l.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        OR l.qualificador_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "lead_movements_insert" ON lead_movements;
CREATE POLICY "lead_movements_insert" ON lead_movements
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "lead_movements_delete" ON lead_movements;
CREATE POLICY "lead_movements_delete" ON lead_movements
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
      AND mp.perfil = 'Administrador'
    )
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
    )
  );

-- 5. Políticas RLS para lead_activities
DROP POLICY IF EXISTS "lead_activities_select" ON lead_activities;
CREATE POLICY "lead_activities_select" ON lead_activities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_activities.lead_id
      AND (
        EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
          AND mp.perfil = 'Administrador'
        )
        OR NOT EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        )
        OR l.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        OR l.qualificador_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "lead_activities_insert" ON lead_activities;
CREATE POLICY "lead_activities_insert" ON lead_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = lead_activities.lead_id
      AND (
        EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
          AND mp.perfil = 'Administrador'
        )
        OR NOT EXISTS (
          SELECT 1 FROM membros_permissoes mp
          WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        )
        OR l.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
        OR l.qualificador_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "lead_activities_delete" ON lead_activities;
CREATE POLICY "lead_activities_delete" ON lead_activities
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
      AND mp.perfil = 'Administrador'
    )
    OR NOT EXISTS (
      SELECT 1 FROM membros_permissoes mp
      WHERE mp.membro_id = (SELECT m.id FROM membros m WHERE m.auth_user_id = auth.uid())
    )
  );

-- ============================================
-- MIGRATION: Cadência Visibility by Role
-- Controls which cadences each role can see in CRM
-- ============================================

-- Create the visibility table
CREATE TABLE IF NOT EXISTS cadencia_visibility (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cadencia_id UUID NOT NULL REFERENCES cadencias(id) ON DELETE CASCADE,
  perfil TEXT NOT NULL,  -- 'Administrador', 'Membro', 'Pré Vendas', 'Atendente', etc.
  visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cadencia_id, perfil)
);

-- Enable RLS
ALTER TABLE cadencia_visibility ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read, admins can modify
CREATE POLICY "cv_select" ON cadencia_visibility FOR SELECT TO authenticated USING (true);
CREATE POLICY "cv_insert" ON cadencia_visibility FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cv_update" ON cadencia_visibility FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cv_delete" ON cadencia_visibility FOR DELETE TO authenticated USING (true);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_cv_cadencia_id ON cadencia_visibility(cadencia_id);
CREATE INDEX IF NOT EXISTS idx_cv_perfil ON cadencia_visibility(perfil);

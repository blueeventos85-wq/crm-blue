-- ============================================
-- MIGRATION: Fix RLS policies for membros_permissoes
-- Allow authenticated users to INSERT and UPDATE
-- ============================================

-- Ensure RLS is enabled
ALTER TABLE membros_permissoes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "perm_select" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_insert" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_update" ON membros_permissoes;
DROP POLICY IF EXISTS "perm_delete" ON membros_permissoes;

-- SELECT: any authenticated user can read permissions
CREATE POLICY "perm_select"
  ON membros_permissoes FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: any authenticated user can create permission records
CREATE POLICY "perm_insert"
  ON membros_permissoes FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: any authenticated user can update permission records
CREATE POLICY "perm_update"
  ON membros_permissoes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: any authenticated user can delete permission records
CREATE POLICY "perm_delete"
  ON membros_permissoes FOR DELETE
  TO authenticated
  USING (true);
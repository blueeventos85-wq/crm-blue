-- ============================================
-- MIGRATION: Add ordem and cor columns to cadencias table
-- Supports dynamic reordering and custom colors for Kanban
-- ============================================

-- 1. Add new columns
ALTER TABLE cadencias 
ADD COLUMN IF NOT EXISTS ordem INTEGER,
ADD COLUMN IF NOT EXISTS cor TEXT;

-- 2. Create index for ordering
CREATE INDEX IF NOT EXISTS idx_cadencias_ordem ON cadencias(ordem);

-- 3. Populate ordem sequentially for existing records (1, 2, 3...)
-- Using row_number() ordered by created_at to maintain original creation order
WITH ordered_cadencias AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as new_ordem
  FROM cadencias
  WHERE ordem IS NULL
)
UPDATE cadencias c
SET ordem = oc.new_ordem
FROM ordered_cadencias oc
WHERE c.id = oc.id;

-- 4. Set default color for existing records without color
UPDATE cadencias 
SET cor = '#3B82F6' 
WHERE cor IS NULL;

-- 5. Make ordem NOT NULL after population
ALTER TABLE cadencias 
ALTER COLUMN ordem SET NOT NULL;

-- 6. Make cor NOT NULL with default after population
ALTER TABLE cadencias 
ALTER COLUMN cor SET NOT NULL,
ALTER COLUMN cor SET DEFAULT '#3B82F6';

-- 7. Add constraint to ensure unique ordem values (optional but recommended for drag-drop)
-- Note: We don't add UNIQUE constraint to allow temporary duplicates during reorder
-- but we can add it after initial population if desired
-- ALTER TABLE cadencias ADD CONSTRAINT unique_cadencia_ordem UNIQUE (ordem);
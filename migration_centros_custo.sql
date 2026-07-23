-- ============================================
-- MIGRATION: Centros de Custo
-- Cria tabela centros_custo e adiciona FK em leads
-- ============================================

-- 1. Criar tabela centros_custo
CREATE TABLE IF NOT EXISTS centros_custo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inserir centros de custo iniciais
INSERT INTO centros_custo (nome) VALUES
  ('Blue PRO'),
  ('Blue Eventos'),
  ('Blue Digital'),
  ('Todos')
ON CONFLICT (nome) DO NOTHING;

-- 3. Adicionar coluna centro_custo_id na tabela leads (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'centro_custo_id'
  ) THEN
    ALTER TABLE leads ADD COLUMN centro_custo_id UUID REFERENCES centros_custo(id);
  END IF;
END $$;

-- 4. Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_leads_centro_custo ON leads(centro_custo_id);

-- 5. RLS policies (padrão: autenticado pode ler, admin pode escrever)
ALTER TABLE centros_custo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view centros_custo"
  ON centros_custo FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert centros_custo"
  ON centros_custo FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update centros_custo"
  ON centros_custo FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete centros_custo"
  ON centros_custo FOR DELETE
  USING (auth.role() = 'authenticated');

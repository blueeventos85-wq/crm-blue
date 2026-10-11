-- ============================================
-- MIGRAÇÃO: Módulo Financeiro
-- 1. Tabela de categorias financeiras (+ seed)
-- 2. Tabela de transações (pronta para n8n/WhatsApp)
-- 3. Trigger de auto-associção categoria_nome → categoria_id
-- 4. RLS (cada um vê as suas + sistema/admin)
-- 5. Permissão can_financeiro (padrão: só Administrador)
-- ============================================

-- ============================================
-- 1. CATEGORIAS FINANCEIRAS
-- ============================================
CREATE TABLE IF NOT EXISTS public.financeiro_categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('despesa', 'receita')),
    icone VARCHAR(50) DEFAULT 'Tag',
    cor VARCHAR(20) DEFAULT '#3b82f6',
    empresa_id UUID REFERENCES public.centros_custo(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed de categorias padrão (idempotente — só insere as que não existem)
INSERT INTO public.financeiro_categorias (nome, tipo, icone, cor)
SELECT v.nome, v.tipo, v.icone, v.cor
FROM (VALUES
  ('Aluguel',           'despesa', 'Home',           '#3b82f6'),
  ('Alimentação',       'despesa', 'Utensils',       '#eab308'),
  ('Transporte',        'despesa', 'Car',            '#6366f1'),
  ('Saúde',             'despesa', 'HeartPulse',     '#ef4444'),
  ('Lazer',             'despesa', 'Smile',          '#10b981'),
  ('Educação',          'despesa', 'GraduationCap',  '#8b5cf6'),
  ('Vendas / Serviços', 'receita', 'TrendingUp',     '#10b981'),
  ('Outros',            'despesa', 'MoreHorizontal', '#64748b')
) AS v(nome, tipo, icone, cor)
WHERE NOT EXISTS (
  SELECT 1 FROM public.financeiro_categorias c
  WHERE c.nome = v.nome AND c.tipo = v.tipo AND c.user_id IS NULL
);

-- ============================================
-- 2. TRANSAÇÕES FINANCEIRAS (n8n / WhatsApp)
-- ============================================
CREATE TABLE IF NOT EXISTS public.financeiro_transacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('despesa', 'receita')),
    valor NUMERIC(12, 2) NOT NULL CHECK (valor >= 0),
    categoria_id UUID REFERENCES public.financeiro_categorias(id) ON DELETE SET NULL,
    categoria_nome VARCHAR(100),
    descricao TEXT,
    data_transacao DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_transacao TIME WITHOUT TIME ZONE DEFAULT CURRENT_TIME,
    origem VARCHAR(50) DEFAULT 'sistema',
    empresa_id VARCHAR(100),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transacoes_data ON public.financeiro_transacoes(data_transacao);
CREATE INDEX IF NOT EXISTS idx_transacoes_empresa ON public.financeiro_transacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_user ON public.financeiro_transacoes(user_id);

-- ============================================
-- 3. TRIGGER: auto-associção por categoria_nome
-- Se categoria_id vier nulo (payload simples do n8n), resolve por
-- correspondência exata do nome (prioriza categorias compartilhadas).
-- ============================================
CREATE OR REPLACE FUNCTION public.financeiro_assoc_categoria()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.categoria_id IS NOT NULL AND (NEW.categoria_nome IS NULL OR NEW.categoria_nome = '') THEN
    -- Preenche o nome textual a partir do id (mantém id/nome em sincronia)
    SELECT c.nome INTO NEW.categoria_nome
    FROM public.financeiro_categorias c WHERE c.id = NEW.categoria_id;
  ELSIF NEW.categoria_id IS NULL AND NEW.categoria_nome IS NOT NULL AND NEW.categoria_nome <> '' THEN
    -- Resolve o id a partir do nome (fallback do n8n)
    SELECT c.id INTO NEW.categoria_id
    FROM public.financeiro_categorias c
    WHERE lower(c.nome) = lower(NEW.categoria_nome)
    ORDER BY (c.user_id IS NULL) DESC, c.created_at
    LIMIT 1;
    IF NEW.categoria_id IS NOT NULL THEN
      SELECT c.nome INTO NEW.categoria_nome
      FROM public.financeiro_categorias c WHERE c.id = NEW.categoria_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financeiro_assoc ON public.financeiro_transacoes;
CREATE TRIGGER trg_financeiro_assoc
  BEFORE INSERT ON public.financeiro_transacoes
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_assoc_categoria();

-- ============================================
-- 4. RLS
-- Helpers is_admin() (convenção atual, ver 20260918195517) e
-- get_membro_id(uid) já existem (migration_security_hardening.sql).
-- SELECT: próprias (user_id = auth.uid()) + sistema (user_id IS NULL) + admin
-- INSERT: apenas as próprias (n8n usa service_role e bypassa RLS)
-- ============================================
ALTER TABLE public.financeiro_transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fin_transacoes_select" ON public.financeiro_transacoes;
DROP POLICY IF EXISTS "fin_transacoes_insert" ON public.financeiro_transacoes;
DROP POLICY IF EXISTS "fin_transacoes_update" ON public.financeiro_transacoes;
DROP POLICY IF EXISTS "fin_transacoes_delete" ON public.financeiro_transacoes;

CREATE POLICY "fin_transacoes_select" ON public.financeiro_transacoes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL OR is_admin());

CREATE POLICY "fin_transacoes_insert" ON public.financeiro_transacoes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "fin_transacoes_update" ON public.financeiro_transacoes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_admin())
  WITH CHECK (user_id = auth.uid() OR is_admin());

CREATE POLICY "fin_transacoes_delete" ON public.financeiro_transacoes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "fin_categorias_select" ON public.financeiro_categorias;
DROP POLICY IF EXISTS "fin_categorias_insert" ON public.financeiro_categorias;
DROP POLICY IF EXISTS "fin_categorias_update" ON public.financeiro_categorias;
DROP POLICY IF EXISTS "fin_categorias_delete" ON public.financeiro_categorias;

CREATE POLICY "fin_categorias_select" ON public.financeiro_categorias
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid() OR is_admin());

CREATE POLICY "fin_categorias_insert" ON public.financeiro_categorias
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "fin_categorias_update" ON public.financeiro_categorias
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_admin())
  WITH CHECK (user_id = auth.uid() OR is_admin());

CREATE POLICY "fin_categorias_delete" ON public.financeiro_categorias
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_categorias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_transacoes TO authenticated;

-- ============================================
-- 5. PERMISSÃO: can_financeiro (padrão: só Administrador)
-- ============================================
ALTER TABLE public.membros_permissoes
  ADD COLUMN IF NOT EXISTS can_financeiro BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.membros_permissoes
   SET can_financeiro = true
 WHERE perfil = 'Administrador'
   AND can_financeiro IS DISTINCT FROM true;

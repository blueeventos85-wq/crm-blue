-- ============================================
-- MIGRATION: Adicionar empresa_id na tabela eventos
-- Vincula o evento a uma empresa (centro_custo)
-- ============================================

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.centros_custo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_empresa_id ON public.eventos(empresa_id);

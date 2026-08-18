-- MIGRAÇÃO: Módulo de Contratos
-- Executar no Supabase SQL Editor antes de testar a view Contratos.

-- 1. Função para manter updated_at atualizado
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Criar tabela de contratos
CREATE TABLE IF NOT EXISTS public.contratos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  membro_id UUID,
  owner_id UUID,
  centro_custo_id UUID,

  numero_contrato TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'gerado', 'enviado', 'assinado', 'cancelado', 'vencido')),

  contratante_nome TEXT NOT NULL,
  contratante_cpf_cnpj TEXT,
  contratante_telefone TEXT,
  contratante_email TEXT,
  contratante_endereco TEXT,
  contratante_bairro TEXT,
  contratante_cidade TEXT,
  contratante_estado TEXT,
  contratante_cep TEXT,

  servico_principal TEXT,
  servicos JSONB NOT NULL DEFAULT '[]'::jsonb,
  descricao_servicos TEXT,

  data_evento DATE,
  hora_inicio TIME,
  hora_fim TIME,
  quantidade_horas NUMERIC(10,2),
  endereco_evento TEXT,

  valor_total NUMERIC(12,2),
  quantidade_parcelas INTEGER NOT NULL DEFAULT 1,
  parcelas JSONB NOT NULL DEFAULT '[]'::jsonb,

  data_emissao DATE NOT NULL DEFAULT current_date,
  cidade_assinatura TEXT NOT NULL DEFAULT 'Fortaleza',
  estado_assinatura TEXT NOT NULL DEFAULT 'CE',

  conteudo_contrato TEXT,

  pdf_storage_path TEXT,
  pdf_url TEXT,

  gerado_em TIMESTAMPTZ,
  enviado_em TIMESTAMPTZ,
  assinado_em TIMESTAMPTZ,
  cancelado_em TIMESTAMPTZ,
  motivo_cancelamento TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Índices
CREATE INDEX IF NOT EXISTS contratos_lead_id_idx ON public.contratos(lead_id);
CREATE INDEX IF NOT EXISTS contratos_status_idx ON public.contratos(status);
CREATE INDEX IF NOT EXISTS contratos_data_evento_idx ON public.contratos(data_evento);

-- 4. Trigger para updated_at
DROP TRIGGER IF EXISTS contratos_set_updated_at ON public.contratos;
CREATE TRIGGER contratos_set_updated_at
BEFORE UPDATE ON public.contratos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas se existirem
DROP POLICY IF EXISTS "contratos_admin_all" ON public.contratos;
DROP POLICY IF EXISTS "contratos_select" ON public.contratos;
DROP POLICY IF EXISTS "contratos_insert" ON public.contratos;
DROP POLICY IF EXISTS "contratos_update" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_select_contratos" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_insert_contratos" ON public.contratos;
DROP POLICY IF EXISTS "authenticated_can_update_contratos" ON public.contratos;

-- Políticas temporárias para usuários autenticados
-- TODO: Substituir "using (true)" por regras baseadas em empresa/permissões
CREATE POLICY "authenticated_can_select_contratos"
ON public.contratos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "authenticated_can_insert_contratos"
ON public.contratos
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_can_update_contratos"
ON public.contratos
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Não criar política de DELETE — contratos devem permanecer no histórico

-- 6. Bucket de Storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos', 'contratos', false)
ON CONFLICT (id) DO NOTHING;

-- Remover políticas antigas de storage
DROP POLICY IF EXISTS "contratos_storage_admin" ON storage.objects;
DROP POLICY IF EXISTS "contratos_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "contratos_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "contratos_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "contratos_storage_delete" ON storage.objects;

-- Políticas temporárias para storage (usuários autenticados)
CREATE POLICY "contratos_storage_select"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'contratos' );

CREATE POLICY "contratos_storage_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'contratos' );

CREATE POLICY "contratos_storage_update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'contratos' );

-- Sem DELETE — arquivos devem permanecer no histórico

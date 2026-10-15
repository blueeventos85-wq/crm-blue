-- ============================================================
-- Migration: tipo_contrato nos contratos
-- Coluna usada pela coluna "TIPO" da listagem (badges):
--   '100%'    | '50%' | '2x'   | 'proposta'
-- '50%' = fluxo "Contrato 50%" (2 parcelas de 50%)
-- '2x'  = duas parcelas pela condição de pagamento manual
-- Contratos antigos recebem o padrão '100%'.
-- Execute no Supabase SQL Editor.
-- ============================================================

-- 1. Nova coluna
ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS tipo_contrato TEXT;

-- 2. Contratos já existentes: padrão "100%"
UPDATE public.contratos
   SET tipo_contrato = '100%'
 WHERE tipo_contrato IS NULL;

-- 3. Função RPC de criação: grava o tipo_contrato junto do contrato
CREATE OR REPLACE FUNCTION public.create_contrato_with_number(p_data JSONB)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  max_num NUMERIC;
  next_text TEXT;
  inserted_id UUID;
  result JSON;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('contrato_numero'));

  SELECT COALESCE(
    MAX(CAST(SUBSTRING(numero_contrato FROM 4) AS NUMERIC)),
    0
  )
  INTO max_num
  FROM public.contratos
  WHERE numero_contrato ~ '^CT-[0-9]+$';

  next_text := 'CT-' || LPAD((max_num + 1)::TEXT, 6, '0');

  INSERT INTO public.contratos (
    lead_id,
    contratante_nome,
    contratante_cpf_cnpj,
    contratante_email,
    contratante_telefone,
    contratante_endereco,
    contratante_bairro,
    contratante_cidade,
    contratante_estado,
    contratante_cep,
    servico_principal,
    descricao_servicos,
    servicos,
    data_evento,
    hora_inicio,
    hora_fim,
    quantidade_horas,
    endereco_evento,
    valor_total,
    quantidade_parcelas,
    parcelas,
    tipo_contrato,
    data_emissao,
    membro_id,
    owner_id,
    centro_custo_id,
    status,
    conteudo_contrato,
    numero_contrato
  ) VALUES (
    NULLIF(p_data->>'lead_id', '')::UUID,
    p_data->>'contratante_nome',
    p_data->>'contratante_cpf_cnpj',
    p_data->>'contratante_email',
    p_data->>'contratante_telefone',
    p_data->>'contratante_endereco',
    p_data->>'contratante_bairro',
    p_data->>'contratante_cidade',
    p_data->>'contratante_estado',
    p_data->>'contratante_cep',
    p_data->>'servico_principal',
    p_data->>'descricao_servicos',
    COALESCE(p_data->'servicos', '[]'::JSONB),
    NULLIF(p_data->>'data_evento', '')::DATE,
    NULLIF(p_data->>'hora_inicio', '')::TIME,
    NULLIF(p_data->>'hora_fim', '')::TIME,
    NULLIF(p_data->>'quantidade_horas', '')::NUMERIC,
    p_data->>'endereco_evento',
    NULLIF(p_data->>'valor_total', '')::NUMERIC,
    COALESCE(NULLIF(p_data->>'quantidade_parcelas', '')::INTEGER, 1),
    COALESCE(p_data->'parcelas', '[]'::JSONB),
    COALESCE(NULLIF(p_data->>'tipo_contrato', ''), '100%'),
    COALESCE(NULLIF(p_data->>'data_emissao', '')::DATE, CURRENT_DATE),
    NULLIF(p_data->>'membro_id', '')::UUID,
    NULLIF(p_data->>'owner_id', '')::UUID,
    NULLIF(p_data->>'centro_custo_id', '')::UUID,
    COALESCE(NULLIF(p_data->>'status', ''), 'rascunho'),
    p_data->>'conteudo_contrato',
    next_text
  )
  RETURNING id INTO inserted_id;

  SELECT row_to_json(c.*) INTO result
  FROM public.contratos c
  WHERE c.id = inserted_id;

  RETURN result;
END;
$$;

-- 4. Permissões e cache do PostgREST
GRANT EXECUTE ON FUNCTION public.create_contrato_with_number(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contrato_with_number(JSONB) TO anon;

NOTIFY pgrst, 'reload schema';

-- 5. Verificação
DO $$
BEGIN
  RAISE NOTICE 'Coluna tipo_contrato pronta (padrão: 100%% para contratos antigos).';
  RAISE NOTICE 'RPC create_contrato_with_number atualizada com tipo_contrato.';
END $$;

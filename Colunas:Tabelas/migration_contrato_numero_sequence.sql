-- ============================================================
-- Migration: Função RPC atômica para criação de contratos
-- Gera o próximo número CT-XXXXXX e insere o contrato
-- dentro da mesma transação, protegido contra concorrência.
-- Execute no Supabase SQL Editor.
-- ============================================================

-- 1. Função auxiliar: gerar próximo número (usada internamente e para previews)
CREATE OR REPLACE FUNCTION public.generate_next_contrato_numero()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  max_num NUMERIC;
  next_num NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('contrato_numero'));

  SELECT COALESCE(
    MAX(CAST(SUBSTRING(numero_contrato FROM 4) AS NUMERIC)),
    0
  )
  INTO max_num
  FROM public.contratos
  WHERE numero_contrato ~ '^CT-[0-9]+$';

  next_num := max_num + 1;
  RETURN 'CT-' || LPAD(next_num::TEXT, 6, '0');
END;
$$;

-- 2. Função principal: criar contrato com número atômico
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

-- 3. Conceder permissões para roles do Supabase
GRANT EXECUTE ON FUNCTION public.generate_next_contrato_numero() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_next_contrato_numero() TO anon;
GRANT EXECUTE ON FUNCTION public.create_contrato_with_number(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contrato_with_number(JSONB) TO anon;

-- 4. Atualizar cache do PostgREST
NOTIFY pgrst, 'reload schema';

-- 5. Verificar
DO $$
BEGIN
  RAISE NOTICE 'Funções RPC de contrato criadas com sucesso.';
  RAISE NOTICE 'generate_next_contrato_numero() - gera o próximo número';
  RAISE NOTICE 'create_contrato_with_number(JSONB) - cria contrato atomicamente';
END $$;

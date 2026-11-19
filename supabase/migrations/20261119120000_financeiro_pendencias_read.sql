/* =============================================
   FINANCEIRO_PENDENCIAS · RLS de leitura — PROPOSTA (NÃO APLICADA)
   =============================================
   Estado confirmado no SQL Editor (19/11/2026):
     · 2 linhas; user_id UUID NULL nas duas;
     · empresa_id VARCHAR NOT NULL (formato misto na base: uuid-texto
       vindo da UI — app.js:23459 envia centros_custo.id — e slug
       vindo do n8n — CHANGELOG v1.5.0 envia "blue_eventos");
     · pg_policies: NENHUMA policy para a tabela;
     · privilégios: apenas postgres e service_role
       (sem authenticated, sem anon → daí o 42501 na tela).

   Regras desta migração (somente metadados + coluna derivada):
     1. NÃO usa USING (true);
     2. NÃO concede nada a anon; service_role/n8n intactos;
     3. authenticated recebe apenas SELECT (aba Pendências é leitura);
     4. habilita RLS (idempotente): sem policy, RLS on = 0 linhas
        (fail-closed); RLS off + grant = todas as linhas — por isso
        ENABLE é obrigatório junto do grant;
     5. FALHA FECHADA contra o buraco de public.is_admin(): essa
        função retorna TRUE quando o usuário não tem linha em membros
        (20260924130000:20-22). Esta migração NÃO usa is_admin() e
        NÃO a altera (policies de outras tabelas dependem dela).
        Cria fin_pendencias_is_admin(), específica desta policy, que
        exige linha em membros com cargo 'Administrador';
     6. política = cadastro em membros OBRIGATÓRIO + (admin da policy
        OU empresa confirmada via membro_centros_custo — padrão
        contrato_modelos_select, 20261005160000:53-65). SEM cláusula
        user_id IS NULL (liberaria tudo) e SEM user_id = auth.uid()
        (acesso é por associação usuário-empresa; o trigger/garantia
        de atribuição já exigem dono vinculado à empresa da linha);
     7. NENHUM registro existente é alterado: o UPDATE de backfill da
        coluna nova fica COMENTADO (opt-in). Nada de status, valor,
        descrição ou user_id antigo é tocado; nada é copiado para
        financeiro_transacoes; nada é apagado;
     8. trigger BEFORE INSERT OR UPDATE materializa centros_custo_id
        a partir de empresa_id (uuid-texto ou slug) e NULLA user_id
        que não seja membro confirmado da empresa da linha — não
        confia em user_id vindo de IA/payload externo.
   =============================================

   ATENÇÃO: NÃO aplicar sem revisão/OK. Não altera dados existentes.
   ============================================= */

-- ============================================
-- 0) Pré-requisitos (falha fechado, sem criar nada)
--    Observa: NÃO exigimos nem usamos public.is_admin() — de propósito.
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.financeiro_pendencias') IS NULL THEN
    RAISE NOTICE 'public.financeiro_pendencias não existe — migração ignorada.';
    RETURN;
  END IF;
  IF to_regclass('public.centros_custo') IS NULL
     OR to_regclass('public.membros') IS NULL
     OR to_regclass('public.membro_centros_custo') IS NULL THEN
    RAISE EXCEPTION 'centros_custo / membros / membro_centros_custo ausentes — corrija antes de aplicar.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'membros' AND column_name = 'cargo'
  ) THEN
    RAISE EXCEPTION 'membros.cargo ausente (fonte do cargo em 20260924130000) — corrija antes de aplicar.';
  END IF;
END $$;

-- ============================================
-- 1) fin_slug: réplica em SQL de finSlugify (app.js:22573)
--    (só usada em trigger/backfill — NÃO dentro da policy)
-- ============================================
CREATE OR REPLACE FUNCTION public.fin_slug(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT trim(both '_' from regexp_replace(
           translate(lower(coalesce(p, '')),
             'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
             'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
           '[^a-z0-9]+', '_', 'g'));
$$;

-- ============================================
-- 2) Admin FECHADO para esta policy (não toca em public.is_admin())
--    Diferença crucial: public.is_admin() retorna TRUE quando o
--    usuário não tem linha em membros (20260924130000:20-22);
--    aqui, sem linha em membros → FALSE (fail-closed).
--    SECURITY DEFINER + search_path fixo, como a função global.
-- ============================================
CREATE OR REPLACE FUNCTION public.fin_pendencias_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.membros m
    WHERE m.auth_user_id = auth.uid()
      AND m.cargo = 'Administrador'
  );
$$;

-- ============================================
-- 3) Coluna derivada de empresa (uuid) + índice
--    empresa_id VARCHAR continua intacta e obrigatória;
--    centros_custo_id é o que a RLS materializa (padrão do CRM:
--    contrato_modelos / whatsapp_config / conversations).
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financeiro_pendencias'
      AND column_name = 'centros_custo_id'
  ) THEN
    ALTER TABLE public.financeiro_pendencias
      ADD COLUMN centros_custo_id uuid REFERENCES public.centros_custo(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fin_pendencias_cc
  ON public.financeiro_pendencias(centros_custo_id);

-- ============================================
-- 4) RLS habilitada (idempotente)
-- ============================================
ALTER TABLE public.financeiro_pendencias ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5) Remove policy SELECT/ALL antiga de authenticated, se houver
--    (policy mais ampla faria OR com a nova e anularia o corte)
-- ============================================
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financeiro_pendencias'
      AND cmd IN ('SELECT', 'ALL')
      AND roles && ARRAY['authenticated', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.financeiro_pendencias', rec.policyname);
    RAISE NOTICE 'fin_pendencias: policy antiga removida: %', rec.policyname;
  END LOOP;
END $$;

-- ============================================
-- 6) Policy de SELECT — falha fechado, só associação confirmada
--    Avaliação lógica: (tem_membros) AND (eh_admin OU tem_empresa)
--    - Sem linha em membros → FALSE (ambas as condições falham)
--    - Membro + admin → TODAS as pendências (acesso global admin)
--    - Membro + não-admin + empresa confirmada → apenas da própria empresa
--    - Membro + não-admin + sem empresa → nada visível
--    - NUNCA usa public.is_admin() (que retornaria TRUE sem cadastro)
-- ============================================
DROP POLICY IF EXISTS "fin_pendencias_select" ON public.financeiro_pendencias;

CREATE POLICY "fin_pendencias_select"
  ON public.financeiro_pendencias
  FOR SELECT TO authenticated
  USING (
    -- GATE 1: Usuário deve ter cadastro confirmado em membros
    EXISTS (
      SELECT 1 FROM public.membros m0
      WHERE m0.auth_user_id = auth.uid()
    )
    AND (
      -- GATE 2A: Administrador válido (com cadastro + cargo 'Administrador')
      --      Retorna FALSE se usuário não tem linha em membros (fail-closed)
      public.fin_pendencias_is_admin()
      OR
      -- GATE 2B: Associação confirmada entre usuário, centro de custo e empresa
      --       O usuário deve ser membro ativo da empresa da pendência
      EXISTS (
        SELECT 1
        FROM public.centros_custo cc
        JOIN public.membro_centros_custo mc ON mc.centro_custo_id = cc.id
        JOIN public.membros m ON m.id = mc.membro_id
        WHERE m.auth_user_id = auth.uid()
          AND (
                public.financeiro_pendencias.centros_custo_id = cc.id
             OR public.financeiro_pendencias.empresa_id = cc.id::text
             OR ( public.fin_slug(public.financeiro_pendencias.empresa_id) = public.fin_slug(cc.nome)
                  AND public.fin_slug(public.financeiro_pendencias.empresa_id) <> '' )
          )
      )
    )
  );

-- ============================================
-- 7) Grants: leitura apenas para authenticated; anon negado;
--    escrita negada para authenticated (aba somente leitura).
--    postgres e service_role NÃO são tocados (n8n continua gravando
--    via service_role, que tem BYPASSRLS no Supabase).
-- ============================================
GRANT SELECT ON public.financeiro_pendencias TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.financeiro_pendencias FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.financeiro_pendencias FROM anon';
  END IF;
END $$;

-- ============================================
-- 8) Trigger: materializa empresa e não confia em user_id externo
--    · centros_custo_id: usa o explícito, senão resolve empresa_id
--      (uuid-texto primeiro, slug depois — fin_slug);
--    · user_id: só permanece se o usuário existir em membros E tiver
--      vínculo em membro_centros_custo com a empresa DA LINHA;
--      caso contrário → NULL + NOTICE (a pendência não se perde,
--      apenas fica sem dono atribuído).
-- ============================================
CREATE OR REPLACE FUNCTION public.financeiro_pendencias_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cc    uuid;
  v_slug  text;
BEGIN
  v_cc := NEW.centros_custo_id;
  IF v_cc IS NULL AND NEW.empresa_id IS NOT NULL THEN
    SELECT id INTO v_cc FROM public.centros_custo
     WHERE id::text = btrim(NEW.empresa_id) LIMIT 1;
    IF v_cc IS NULL THEN
      v_slug := public.fin_slug(NEW.empresa_id);
      IF v_slug <> '' THEN
        SELECT id INTO v_cc FROM public.centros_custo
         WHERE public.fin_slug(nome) = v_slug LIMIT 1;
      END IF;
    END IF;
  END IF;
  NEW.centros_custo_id := v_cc;

  IF NEW.user_id IS NOT NULL THEN
    IF v_cc IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.membros m
      JOIN public.membro_centros_custo mc ON mc.membro_id = m.id
      WHERE m.auth_user_id = NEW.user_id
        AND mc.centro_custo_id = v_cc
    ) THEN
      RAISE NOTICE 'fin_pendencias: user_id % não é membro autorizado da empresa da linha → gravado como NULL.', NEW.user_id;
      NEW.user_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fin_pendencias_before_write ON public.financeiro_pendencias;
CREATE TRIGGER trg_fin_pendencias_before_write
  BEFORE INSERT OR UPDATE ON public.financeiro_pendencias
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_pendencias_before_write();

-- ============================================
-- 9) BACKFILL DAS LINHAS ANTIGAS — OPCIONAL, COMENTADO
--    Único UPDATE que existiria nesta migração; escreve APENAS na
--    coluna nova centros_custo_id (nenhuma coluna financeira é
--    tocada). Descomente só se quiserem materializar as linhas
--    antigas; sem isso a policy já as autoriza pelo label empresa_id.
-- ============================================
/*
UPDATE public.financeiro_pendencias p
SET centros_custo_id = COALESCE(
  (SELECT cc.id FROM public.centros_custo cc
    WHERE cc.id::text = btrim(p.empresa_id) LIMIT 1),
  (SELECT cc.id FROM public.centros_custo cc
    WHERE public.fin_slug(cc.nome) = public.fin_slug(p.empresa_id)
      AND public.fin_slug(p.empresa_id) <> '' LIMIT 1))
WHERE p.centros_custo_id IS NULL;
*/

-- ============================================
-- 10) Relatório
-- ============================================
DO $$
DECLARE v_pol text; v_nul int;
BEGIN
  SELECT string_agg(policyname || ' [' || cmd || '] → ' || array_to_string(roles, ', '), '; ')
    INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'financeiro_pendencias';

  RAISE NOTICE 'fin_pendencias: policies atuais: %', COALESCE(v_pol, '(nenhuma)');
  RAISE NOTICE 'fin_pendencias: GRANT SELECT só para authenticated; anon e escrita negados; service_role/postgres intactos; RLS habilitada.';
  RAISE NOTICE 'fin_pendencias: policy = cadastro em membros E (admin fechado via fin_pendencias_is_admin OU empresa via membro_centros_custo). Não usa public.is_admin().';

  SELECT count(*) INTO v_nul
    FROM public.financeiro_pendencias
   WHERE centros_custo_id IS NULL;
  IF v_nul > 0 THEN
    RAISE NOTICE 'fin_pendencias: % linha(s) sem centros_custo_id materializado — autorizadas pelo label empresa_id na policy; descomente o bloco 9 para materializar.', v_nul;
  END IF;
END $$;

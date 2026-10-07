-- ============================================================
-- Migration: Modelo de contrato por empresa (contrato_modelos)
--
-- ESCOPO / GARANTIAS DE SEGURANÇA
--  * Cria APENAS a tabela public.contrato_modelos.
--  * NÃO altera, remove ou recria NENHUMA policy, grant,
--    permissão ou objeto existente (em especial: nenhuma
--    alteração em public.contratos nem em public.centros_custo).
--    As políticas de acesso atuais permanecem intactas.
--  * Única permissão nova: sobre a tabela nova — SELECT apenas
--    para usuários autenticados (limitado às empresas do
--    membro) e escrita somente para administradores, usando
--    as mesmas funções/padrões já usados pelo projeto
--    (is_admin(), membro_centros_custo).
--  * Dados existentes de contratos NÃO são tocados: nenhum
--    UPDATE/DELETE em public.contratos.
--  * Seed único e condicionado: apenas a empresa "Blue Eventos"
--    recebe uma linha com os dados LEGAIS já em uso hoje.
--    Nenhuma linha é criada para as demais empresas (elas
--    continuam usando o modelo padrão por fallback).
-- ============================================================

-- 1. Tabela ---------------------------------------------------
create table if not exists public.contrato_modelos (
  id                   uuid primary key default gen_random_uuid(),
  centro_custo_id      uuid not null unique
                         references public.centros_custo (id) on delete cascade,
  titulo               text not null default 'Contrato de Prestação de Serviços',
  contratada_razao_social text,
  contratada_cnpj      text,
  contratada_endereco  text,
  contratada_cep       text,
  cabecalho            jsonb not null default '{}'::jsonb,
  marca_dagua_url      text,
  ativo                boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.contrato_modelos is
  'Identidade/branding exibidos nos contratos, por empresa (centro de custo). '
  'Empresas sem linha usam o modelo padrão (Blue Eventos).';

-- 2. RLS (só na tabela nova) ---------------------------------
alter table public.contrato_modelos enable row level security;

-- Idempotência: remove apenas policies DESTA tabela nova.
drop policy if exists "contrato_modelos_select" on public.contrato_modelos;
drop policy if exists "contrato_modelos_admin_write" on public.contrato_modelos;

-- SELECT: administrador vê tudo; membro vê apenas modelos das
-- empresas das quais faz parte (não mistura dados entre empresas).
create policy "contrato_modelos_select"
  on public.contrato_modelos
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1
      from public.membro_centros_custo mc
      join public.membros m on m.id = mc.membro_id
      where mc.centro_custo_id = contrato_modelos.centro_custo_id
        and m.auth_user_id = auth.uid()
    )
  );

-- ESCRITA: somente administradores (mesmo critério do sistema).
create policy "contrato_modelos_admin_write"
  on public.contrato_modelos
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Grants explícitos apenas sobre a tabela nova.
grant select on public.contrato_modelos to authenticated;
grant insert, update, delete on public.contrato_modelos to authenticated;

-- 3. Seed: somente a Blue Eventos ----------------------------
-- Insere apenas se ainda não existir linha para essa empresa e
-- apenas se existir um centro de custo com esse nome.
insert into public.contrato_modelos (
  centro_custo_id,
  titulo,
  contratada_razao_social,
  contratada_cnpj,
  contratada_endereco,
  contratada_cep,
  cabecalho,
  marca_dagua_url
)
select
  cc.id,
  'Contrato de Prestação de Serviços',
  'Agência Blue Organização de Eventos e Inteligência Empresarial Ltda.',
  '59.417.603/0001-36',
  'Av. Eng. Humberto Monte, 2929, Pici, Fortaleza/CE',
  '60.440-593',
  jsonb_build_object(
    'nome', 'Agência Blue PRO',
    'site', 'www.agenciabluepro.com.br',
    'instagram', '@agenciabluepro',
    'whatsapp', '(85) 99149-9320',
    'logo', null
  ),
  null  -- usa a marca d'água padrão do sistema (como hoje)
from public.centros_custo cc
where lower(btrim(cc.nome)) = 'blue eventos'
on conflict (centro_custo_id) do nothing;

-- 4. Atualizar cache do PostgREST ----------------------------
notify pgrst, 'reload schema';

/* ============================================
   MODELO DE CONTRATO POR EMPRESA
   Helpers puros (sem DOM, sem banco) usados por app.js
   e pelos testes em tests/contrato-modelo.test.js
   ============================================ */

export const CONTRATO_TITULO_PADRAO = 'Contrato de Prestação de Serviços';

export const CONTRATO_FILTRO_SEM_EMPRESA = '__sem_empresa__';

/* Modelo atualmente em uso — vinculado à Blue Eventos.
   É o fallback para qualquer empresa sem modelo próprio. */
export const DEFAULT_CONTRATO_MODELO = Object.freeze({
  id: null,
  centro_custo_id: null,
  titulo: CONTRATO_TITULO_PADRAO,
  contratada_razao_social: 'Agência Blue Organização de Eventos e Inteligência Empresarial Ltda.',
  contratada_cnpj: '59.417.603/0001-36',
  contratada_endereco: 'Av. Eng. Humberto Monte, 2929, Pici, Fortaleza/CE',
  contratada_cep: '60.440-593',
  cabecalho: Object.freeze({
    nome: 'Agência Blue PRO',
    site: 'www.agenciabluepro.com.br',
    instagram: '@agenciabluepro',
    whatsapp: '(85) 99149-9320',
    logo: null
  }),
  /* null = usar a marca d'água padrão do sistema */
  marca_dagua_url: null
});

function _valor(valor, padrao) {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    return trimmed ? trimmed : padrao;
  }
  return valor;
}

function _mergeParcial(row) {
  if (!row || typeof row !== 'object') return { ...DEFAULT_CONTRATO_MODELO };
  const cabecalhoDb = (row.cabecalho && typeof row.cabecalho === 'object') ? row.cabecalho : {};
  return {
    id: _valor(row.id, null),
    centro_custo_id: _valor(row.centro_custo_id, null),
    titulo: _valor(row.titulo, DEFAULT_CONTRATO_MODELO.titulo),
    contratada_razao_social: _valor(row.contratada_razao_social, DEFAULT_CONTRATO_MODELO.contratada_razao_social),
    contratada_cnpj: _valor(row.contratada_cnpj, DEFAULT_CONTRATO_MODELO.contratada_cnpj),
    contratada_endereco: _valor(row.contratada_endereco, DEFAULT_CONTRATO_MODELO.contratada_endereco),
    contratada_cep: _valor(row.contratada_cep, DEFAULT_CONTRATO_MODELO.contratada_cep),
    cabecalho: {
      nome: _valor(cabecalhoDb.nome, DEFAULT_CONTRATO_MODELO.cabecalho.nome),
      site: _valor(cabecalhoDb.site, DEFAULT_CONTRATO_MODELO.cabecalho.site),
      instagram: _valor(cabecalhoDb.instagram, DEFAULT_CONTRATO_MODELO.cabecalho.instagram),
      whatsapp: _valor(cabecalhoDb.whatsapp, DEFAULT_CONTRATO_MODELO.cabecalho.whatsapp),
      logo: _valor(cabecalhoDb.logo, null)
    },
    marca_dagua_url: _valor(row.marca_dagua_url, DEFAULT_CONTRATO_MODELO.marca_dagua_url)
  };
}

/* Combina um registro vindo do banco com o modelo padrão.
   Campo vazio/nulo cai no padrão → nunca quebra o PDF. */
export function mergeModelo(row) {
  return _mergeParcial(row);
}

/* Resolve o modelo de uma empresa: linha própria ou fallback padrão. */
export function resolveModelo(centroCustoId, modelos = []) {
  if (!centroCustoId) return _mergeParcial(null);
  const lista = Array.isArray(modelos) ? modelos : [];
  const row = lista.find(m => m && m.centro_custo_id === centroCustoId && m.ativo !== false);
  return _mergeParcial(row || null);
}

/* Empresa selecionada automaticamente ao abrir um contrato novo.
   Ordem: empresa do lead → primeira empresa do usuário →
   única opção disponível → primeira opção (admin) → nenhuma. */
export function resolveEmpresaDefault({
  leadCcId = null,
  userCcIds = [],
  opcoes = [],
  isAdmin = false
} = {}) {
  const permitidas = (Array.isArray(opcoes) ? opcoes : []).filter(Boolean);
  const permitida = (id) => !!id && permitidas.includes(id);

  if (permitida(leadCcId)) return leadCcId;

  const minhas = (Array.isArray(userCcIds) ? userCcIds : []).filter(Boolean);
  const primeiraMinha = minhas.find(permitida);
  if (primeiraMinha) return primeiraMinha;

  if (permitidas.length === 1) return permitidas[0];
  if (isAdmin && permitidas.length > 0) return permitidas[0];
  return null;
}

/* Valor do select de filtro → { tipo: 'todas' | 'empresa' | 'sem_empresa' } */
export function parseEmpresaFilterValue(value) {
  const raw = (value === null || value === undefined) ? '' : String(value);
  if (!raw) return { tipo: 'todas' };
  if (raw === CONTRATO_FILTRO_SEM_EMPRESA) return { tipo: 'sem_empresa' };
  return { tipo: 'empresa', centroCustoId: raw };
}

/* ============================================
   CRIAÇÃO DE CONTRATOS RESTRITA A EMPRESAS
   COM MODELO CONFIGURADO
   ============================================ */

/* Nomes (minúsculos, sem espaços extras) das empresas liberadas quando a
   tabela contrato_modelos ainda não existe (migration não aplicada).
   Sem isso, nenhum contrato poderia ser criado antes do push. */
export const EMPRESAS_LIBERADAS_PADRAO = Object.freeze(['blue eventos']);

export const MSG_SELECIONAR_EMPRESA_CRIAVEL =
  'Selecione uma empresa com modelo de contrato configurado para criar contratos.';

export function msgModeloNaoConfigurado(nome) {
  return `O modelo de contrato da ${nome || 'empresa selecionada'} ainda não está configurado.`;
}

function _normNome(valor) {
  return String(valor ?? '').trim().toLowerCase();
}

function _nomeEmpresa(centroCustoId, empresas = []) {
  const lista = Array.isArray(empresas) ? empresas : [];
  const cc = lista.find(c => c && c.id === centroCustoId);
  return cc && cc.nome ? cc.nome : '';
}

/* IDs das empresas que aceitam contrato novo: linha própria em
   contrato_modelos (ativo). Se a tabela não existir ainda, usa o
   fallback por nome. Liberar uma empresa no futuro = cadastrar o modelo. */
export function idsEmpresaCriavel({
  modelos = [],
  empresas = [],
  modelosDisponiveis = true
} = {}) {
  const emps = (Array.isArray(empresas) ? empresas : []).filter(cc => cc && cc.id);
  if (!modelosDisponiveis) {
    const liberadas = new Set(EMPRESAS_LIBERADAS_PADRAO);
    return emps.filter(cc => liberadas.has(_normNome(cc.nome))).map(cc => cc.id);
  }
  const comModelo = new Set(
    (Array.isArray(modelos) ? modelos : [])
      .filter(m => m && m.centro_custo_id && m.ativo !== false)
      .map(m => m.centro_custo_id)
  );
  return emps.map(cc => cc.id).filter(id => comModelo.has(id));
}

export function empresaCriavel({ centroCustoId, modelos, empresas, modelosDisponiveis } = {}) {
  if (!centroCustoId) return false;
  return idsEmpresaCriavel({ modelos, empresas, modelosDisponiveis }).includes(centroCustoId);
}

/* Motivo para o botão "Adicionar contrato" ficar desabilitado.
   `filtro` é o valor do select de filtro ('' = Todas as Empresas).
   null = criação liberada. */
export function motivoBloqueioCriacao({
  filtro = '',
  modelos,
  empresas,
  modelosDisponiveis
} = {}) {
  const valor = (filtro === null || filtro === undefined) ? '' : String(filtro);
  if (!valor || valor === CONTRATO_FILTRO_SEM_EMPRESA) return MSG_SELECIONAR_EMPRESA_CRIAVEL;
  if (empresaCriavel({ centroCustoId: valor, modelos, empresas, modelosDisponiveis })) return null;
  return msgModeloNaoConfigurado(_nomeEmpresa(valor, empresas));
}

/* Regra aplicada antes de salvar (criação e edição).
   Edição preserva a empresa já salva; trocar para empresa sem modelo é bloqueada. */
export function podeSalvarContrato({
  centroCustoId = null,
  centroCustoIdSalvo = null,
  isEdicao = false,
  modelos,
  empresas,
  modelosDisponiveis
} = {}) {
  // Contrato antigo sem empresa continua editável — nada é perdido.
  if (isEdicao && !centroCustoId) return { ok: true, motivo: null };
  // Mesma empresa já salva → preserva, mesmo sem modelo cadastrado.
  if (isEdicao && centroCustoId && centroCustoId === centroCustoIdSalvo) {
    return { ok: true, motivo: null };
  }
  if (!centroCustoId) return { ok: false, motivo: MSG_SELECIONAR_EMPRESA_CRIAVEL };
  if (empresaCriavel({ centroCustoId, modelos, empresas, modelosDisponiveis })) {
    return { ok: true, motivo: null };
  }
  return { ok: false, motivo: msgModeloNaoConfigurado(_nomeEmpresa(centroCustoId, empresas)) };
}

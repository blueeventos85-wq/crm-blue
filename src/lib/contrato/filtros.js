/* ============================================
   FILTROS DA ABA CONTRATOS
   Helpers puros (sem DOM, sem banco) usados por
   app.js e pelos testes em
   tests/contrato-filtro-empresa.test.js
   ============================================ */

import { CONTRATO_FILTRO_SEM_EMPRESA } from './modelo.js';

const ROTULOS_STATUS = Object.freeze({
  rascunho: 'Rascunho',
  gerado: 'Gerado',
  enviado: 'Enviado',
  assinado: 'Assinado',
  vencido: 'Vencido',
  cancelado: 'Cancelado'
});

function _nomeEmpresa(centroCustoId, empresas = []) {
  const lista = Array.isArray(empresas) ? empresas : [];
  const cc = lista.find(c => c && c.id === centroCustoId);
  return cc && cc.nome ? cc.nome : '';
}

/* Valor cru do select de empresa → parâmetros da consulta.
   Os campos extras (empresaTipo/empresaNome) servem só para a UI
   (mensagem de lista vazia e resumo); a consulta usa
   centro_custo_id / semEmpresa. */
export function montaFiltrosContratos({
  busca = '',
  status = '',
  mesEvento = '',
  empresaValor = '',
  empresas = []
} = {}) {
  const valor = (empresaValor === null || empresaValor === undefined) ? '' : String(empresaValor);

  let empresaTipo = 'todas';
  let centroCustoId = '';
  let semEmpresa = false;

  if (valor === CONTRATO_FILTRO_SEM_EMPRESA) {
    empresaTipo = 'sem_empresa';
    semEmpresa = true;
  } else if (valor) {
    empresaTipo = 'empresa';
    centroCustoId = valor;
  }

  return {
    busca: String(busca || ''),
    status: String(status || ''),
    mesEvento: String(mesEvento || ''),
    empresaValor: valor,
    empresaTipo,
    empresaNome: empresaTipo === 'empresa' ? _nomeEmpresa(valor, empresas) : '',
    centroCustoId,
    semEmpresa
  };
}

/* Mensagem exibida quando a consulta não retorna nada. */
export function mensagemListaVaziaContratos(filtro = {}) {
  if (filtro.empresaTipo === 'empresa') return 'Nenhum contrato encontrado para esta empresa.';
  if (filtro.empresaTipo === 'sem_empresa') return 'Nenhum contrato encontrado sem empresa.';
  return 'Nenhum contrato encontrado.';
}

/* Linha que deixa explícito o recorte da lista mostrada.
   `pendente` = existe alteração no formulário que ainda não foi aplicada. */
export function resumoFiltrosContratos(filtro = {}, { total = 0, pendente = false } = {}) {
  const partes = [];

  if (filtro.empresaTipo === 'empresa') {
    partes.push(`somente ${filtro.empresaNome || 'a empresa selecionada'}`);
  } else if (filtro.empresaTipo === 'sem_empresa') {
    partes.push('somente contratos sem empresa');
  } else {
    partes.push('todas as empresas');
  }

  if (filtro.status) partes.push(`status: ${ROTULOS_STATUS[filtro.status] || filtro.status}`);
  if (filtro.mesEvento) partes.push(`mês: ${_formataMes(filtro.mesEvento)}`);
  if (filtro.busca) partes.push(`busca: "${filtro.busca}"`);

  const qtd = Number(total) || 0;
  const plural = qtd === 1 ? 'contrato' : 'contratos';
  const base = `Exibindo ${qtd} ${plural} — ${partes.join(' · ')}`;
  return pendente ? `Alterações não aplicadas — clique em Filtrar · ${base}` : base;
}

function _formataMes(yyyymm) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yyyymm || ''));
  if (!m) return yyyymm;
  return `${m[2]}/${m[1]}`;
}

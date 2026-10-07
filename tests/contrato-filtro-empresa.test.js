import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  montaFiltrosContratos,
  mensagemListaVaziaContratos,
  resumoFiltrosContratos
} from '../src/lib/contrato/filtros.js';
import { CONTRATO_FILTRO_SEM_EMPRESA } from '../src/lib/contrato/modelo.js';

/* ===========================================================
   Filtro da aba Contratos por empresa
   -----------------------------------------------------------
   1) helpers puros (select → parâmetros de consulta, mensagens);
   2) a função loadContratos() real é extraída do app.js e
      executada com um supabase simulado, provando que o filtro
      chega à CONSULTA e não só à tela;
   3) fiação: troca de empresa, botão Filtrar e entrada na aba.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

const CC_EVENTOS = 'f6b86575-6f66-4786-a220-451fcf10db36';
const CC_DIGITAL = '22222222-2222-4222-8222-222222222222';
const CC_PRO = '33333333-3333-4333-8333-333333333333';

const EMPRESAS = [
  { id: CC_EVENTOS, nome: 'Blue Eventos' },
  { id: CC_DIGITAL, nome: 'Blue Digital' },
  { id: CC_PRO, nome: 'Blue PRO' }
];

/** Extrai o corpo de uma função top-level (contagem de chaves). */
function extractFn(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  const paramsEnd = source.indexOf(') {', Math.max(start, start + header.length - 1));
  if (paramsEnd === -1) return null;
  let depth = 0;
  for (let i = paramsEnd + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Supabase simulado: registra cada operador encadeado na consulta. */
function criarSupabaseMock() {
  const ops = [];
  const q = {
    select(col) { ops.push(['select', col]); return q; },
    is(col, val) { ops.push(['is', col, val]); return q; },
    eq(col, val) { ops.push(['eq', col, val]); return q; },
    or(expr) { ops.push(['or', expr]); return q; },
    gte(col, val) { ops.push(['gte', col, val]); return q; },
    lte(col, val) { ops.push(['lte', col, val]); return q; },
    order(col, opts) { ops.push(['order', col, opts]); return q; },
    then(resolve) { resolve({ data: [], error: null }); return Promise.resolve(); }
  };
  const client = { from(tabela) { ops.push(['from', tabela]); return q; } };
  return { client, ops };
}

/** Carrega a loadContratos() real do app.js com dependências injetadas. */
function carregarLoadContratos({ admin = true, userId = null, meusCc = [] } = {}) {
  const corpo = extractFn(appJs, 'async function loadContratos(');
  assert.ok(corpo, 'loadContratos não encontrada em app.js');
  const fabrica = new Function(
    '_supabase',
    'canViewAllData',
    'currentUser',
    `${corpo}\nreturn loadContratos;`
  );
  return fabrica;
}

/** Executa a consulta real para os filtros produzidos pelo select. */
async function consultaReal(empresaValor, { admin = true, userId = null, meusCc = [] } = {}) {
  const { client, ops } = criarSupabaseMock();
  const load = carregarLoadContratos({ admin, userId, meusCc })(client, () => admin, {
    id: userId,
    centro_custo_ids: meusCc
  });
  const filtros = montaFiltrosContratos({ empresaValor, empresas: EMPRESAS });
  await load(filtros);
  return { ops, filtros };
}

const eqEmpresa = (ops) => ops.filter(([op, col]) => op === 'eq' && col === 'centro_custo_id');

describe('Filtro de empresa — do select para os parâmetros da consulta', () => {
  it('Blue Eventos → centro_custo_id = Blue Eventos', () => {
    const f = montaFiltrosContratos({ empresaValor: CC_EVENTOS, empresas: EMPRESAS });
    assert.equal(f.empresaTipo, 'empresa');
    assert.equal(f.centroCustoId, CC_EVENTOS);
    assert.equal(f.semEmpresa, false);
    assert.equal(f.empresaNome, 'Blue Eventos');
    assert.equal(f.semEmpresa, false);
  });

  it('Blue PRO → centro_custo_id = Blue PRO (nome usado no resumo)', () => {
    const f = montaFiltrosContratos({ empresaValor: CC_PRO, empresas: EMPRESAS });
    assert.equal(f.centroCustoId, CC_PRO);
    assert.equal(f.empresaNome, 'Blue PRO');
  });

  it('Blue Digital → centro_custo_id = Blue Digital', () => {
    const f = montaFiltrosContratos({ empresaValor: CC_DIGITAL, empresas: EMPRESAS });
    assert.equal(f.centroCustoId, CC_DIGITAL);
    assert.equal(f.empresaNome, 'Blue Digital');
  });

  it('Todas as Empresas (valor vazio) → nenhuma restrição de empresa', () => {
    const f = montaFiltrosContratos({ empresaValor: '', empresas: EMPRESAS });
    assert.equal(f.empresaTipo, 'todas');
    assert.equal(f.centroCustoId, '');
    assert.equal(f.semEmpresa, false);
  });

  it('Sem empresa → somente contratos com centro_custo_id nulo', () => {
    const f = montaFiltrosContratos({ empresaValor: CONTRATO_FILTRO_SEM_EMPRESA, empresas: EMPRESAS });
    assert.equal(f.empresaTipo, 'sem_empresa');
    assert.equal(f.semEmpresa, true);
    assert.equal(f.centroCustoId, '');
  });

  it('preserva busca, status e mês do evento', () => {
    const f = montaFiltrosContratos({
      busca: 'Maria',
      status: 'gerado',
      mesEvento: '2026-06',
      empresaValor: CC_PRO,
      empresas: EMPRESAS
    });
    assert.equal(f.busca, 'Maria');
    assert.equal(f.status, 'gerado');
    assert.equal(f.mesEvento, '2026-06');
    assert.equal(f.centroCustoId, CC_PRO);
  });
});

describe('Filtro de empresa — aplicado na consulta (loadContratos real)', () => {
  it('selecionando Blue Eventos, a consulta restringe a essa empresa', async () => {
    const { ops } = await consultaReal(CC_EVENTOS);
    assert.deepEqual(eqEmpresa(ops), [['eq', 'centro_custo_id', CC_EVENTOS]]);
    assert.ok(ops.some(([op, col]) => op === 'from' && col === 'contratos'));
  });

  it('selecionando Blue PRO, a consulta restringe a essa empresa', async () => {
    const { ops } = await consultaReal(CC_PRO);
    assert.deepEqual(eqEmpresa(ops), [['eq', 'centro_custo_id', CC_PRO]]);
    assert.ok(!eqEmpresa(ops).some(([, , v]) => v === CC_EVENTOS),
      'consulta não pode conter a Blue Eventos quando Blue PRO está selecionada');
  });

  it('selecionando Blue Digital, a consulta restringe a essa empresa', async () => {
    const { ops } = await consultaReal(CC_DIGITAL);
    assert.deepEqual(eqEmpresa(ops), [['eq', 'centro_custo_id', CC_DIGITAL]]);
  });

  it('Todas as Empresas não impõe restrição de empresa', async () => {
    const { ops } = await consultaReal('');
    assert.deepEqual(eqEmpresa(ops), []);
    assert.ok(!ops.some(([op, col]) => op === 'is' && col === 'centro_custo_id'));
  });

  it('Sem empresa usa is(centro_custo_id, null)', async () => {
    const { ops } = await consultaReal(CONTRATO_FILTRO_SEM_EMPRESA);
    assert.deepEqual(
      ops.filter(([op, col]) => op === 'is' && col === 'centro_custo_id'),
      [['is', 'centro_custo_id', null]]
    );
  });

  it('empresa combinada com status e mês segue restringindo tudo junto', async () => {
    const { client, ops } = criarSupabaseMock();
    const load = carregarLoadContratos()(client, () => true, { id: null, centro_custo_ids: [] });
    const filtros = montaFiltrosContratos({
      status: 'gerado',
      mesEvento: '2026-06',
      empresaValor: CC_PRO,
      empresas: EMPRESAS
    });
    await load(filtros);
    assert.deepEqual(eqEmpresa(ops), [['eq', 'centro_custo_id', CC_PRO]]);
    assert.ok(ops.some(([op, col, val]) => op === 'eq' && col === 'status' && val === 'gerado'));
    assert.ok(ops.some(([op, col, val]) => op === 'gte' && col === 'data_evento' && val === '2026-06-01'));
    assert.ok(ops.some(([op, col, val]) => op === 'lte' && col === 'data_evento' && val === '2026-06-31'));
  });

  it('para membro não-admin, o recorte de empresa continua junto com o escopo dele', async () => {
    const { ops } = await consultaReal(CC_PRO, {
      admin: false,
      userId: 'membro-1',
      meusCc: [CC_EVENTOS, CC_PRO]
    });
    assert.deepEqual(eqEmpresa(ops), [['eq', 'centro_custo_id', CC_PRO]]);
    assert.ok(ops.some(([op]) => op === 'or'), 'escopo do membro não pode sumir');
  });
});

describe('Lista vazia e recorte explícito', () => {
  it('empresa selecionada mostra a mensagem pedida', () => {
    const f = montaFiltrosContratos({ empresaValor: CC_PRO, empresas: EMPRESAS });
    assert.equal(mensagemListaVaziaContratos(f), 'Nenhum contrato encontrado para esta empresa.');
  });

  it('sem empresa e todas as empresas têm mensagens próprias', () => {
    assert.equal(
      mensagemListaVaziaContratos(montaFiltrosContratos({ empresaValor: CONTRATO_FILTRO_SEM_EMPRESA })),
      'Nenhum contrato encontrado sem empresa.'
    );
    assert.equal(mensagemListaVaziaContratos(montaFiltrosContratos({ empresaValor: '' })), 'Nenhum contrato encontrado.');
  });

  it('resumo deixa claro o que a lista está exibindo', () => {
    const f = montaFiltrosContratos({ empresaValor: CC_PRO, empresas: EMPRESAS });
    const txt = resumoFiltrosContratos(f, { total: 0 });
    assert.match(txt, /somente Blue PRO/);
    assert.match(txt, /Exibindo 0 contratos/);
  });

  it('resumo sinaliza alterações ainda não aplicadas', () => {
    const f = montaFiltrosContratos({ empresaValor: '', empresas: EMPRESAS });
    assert.match(resumoFiltrosContratos(f, { total: 3, pendente: true }), /clique em Filtrar/);
    assert.doesNotMatch(resumoFiltrosContratos(f, { total: 3, pendente: false }), /clique em Filtrar/);
  });
});

describe('Filtro de empresa — fiação no app.js', () => {
  it('refreshContratosTable lê os filtros da tela e manda para a consulta', () => {
    const leitor = extractFn(appJs, 'function _leFiltrosContratosDoDOM()');
    assert.ok(leitor, '_leFiltrosContratosDoDOM não encontrada');
    assert.ok(leitor.includes("getElementById('filterContratoEmpresa')"), 'não lê o select de empresa');

    const corpo = extractFn(appJs, 'async function refreshContratosTable(');
    assert.ok(corpo, 'refreshContratosTable não encontrada');
    assert.ok(corpo.includes('_leFiltrosContratosDoDOM()'), 'não lê os filtros da tela');
    assert.ok(corpo.includes('montaFiltrosContratos('), 'não monta os filtros');
    assert.ok(corpo.includes('await loadContratos(filtros)'), 'não consulta com os filtros montados');
    assert.ok(corpo.includes('_atualizaResumoLista()'), 'não atualiza o recorte exibido');
  });

  it('trocar de empresa aplica o filtro imediatamente', () => {
    assert.ok(appJs.includes(
      "getElementById('filterContratoEmpresa')?.addEventListener('change', () => {"
    ), 'sem listener de change no select de empresa');
    const idx = appJs.indexOf("getElementById('filterContratoEmpresa')?.addEventListener('change'");
    const trecho = appJs.slice(idx, idx + 400);
    assert.ok(trecho.includes('refreshContratosTable()'), 'troca de empresa não atualiza a lista');
    assert.ok(trecho.includes('_atualizaBotaoNovoContrato()'), 'botão de criar contrato não reage');
  });

  it('botão Filtrar mantém empresa + os demais filtros', () => {
    const idx = appJs.indexOf("getElementById('btnFilterContratos')?.addEventListener('click'");
    assert.ok(idx > -1, 'listener do Filtrar ausente');
    const trecho = appJs.slice(idx, idx + 300);
    assert.ok(trecho.includes('refreshContratosTable()'));
  });

  it('entrar na aba Contratos já aplica o filtro visível (sem clique extra)', () => {
    const corpo = extractFn(appJs, 'async function initContratos(');
    assert.ok(corpo, 'initContratos não encontrada');
    assert.ok(corpo.includes('await refreshContratosTable();'), 'init não refresca com filtros');
    assert.ok(!corpo.includes('_contratosData = await loadContratos();'),
      'entrada da aba continua carregando sem filtro');
    assert.ok(corpo.indexOf('populateContratoEmpresaFilter();') < corpo.indexOf('await refreshContratosTable();'),
      'select precisa ser montado antes da busca');
  });

  it('mensagem de lista vazia vem do filtro aplicado', () => {
    assert.ok(appJs.includes('mensagemListaVaziaContratos(_contratosFiltrosAplicados)'),
      'renderContratosTable não usa o filtro aplicado');
    assert.ok(indexHtml.includes('id="contratosListaResumo"'), 'recorte não tem elemento no HTML');
  });

  it('limpar filtros volta para todas as empresas', () => {
    const idx = appJs.indexOf("getElementById('btnClearContratos')?.addEventListener('click'");
    assert.ok(idx > -1, 'listener do Limpar ausente');
    const trecho = appJs.slice(idx, idx + 600);
    assert.ok(trecho.includes("empresa.value = ''"), 'limpar não zera a empresa');
    assert.ok(trecho.includes('refreshContratosTable()'), 'limpar não recarrega a lista');
  });
});

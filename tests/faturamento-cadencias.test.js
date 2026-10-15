import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Automação temporal de cadências de faturamento
   - state machine determinístico: Mês Passado → Trimestral → Anual
   - data de fechamento: último movimento (badge) > contrato > updated_at
   - execução forçada no render do CRM (trava limpa + log do resultado)
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');

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

function carregarHelpers() {
  const nomes = ['_dataLocalISO', '_normalizarNomeCadencia', '_enquadrarFaturamento', '_resolverDataFechamento'];
  const funcoes = nomes.map(n => {
    const corpo = extractFn(appJs, `function ${n}(`);
    assert.ok(corpo, `função ${n} ausente em app.js`);
    return corpo;
  }).join('; ');
  return new Function(`${funcoes}; return { _dataLocalISO, _normalizarNomeCadencia, _enquadrarFaturamento, _resolverDataFechamento };`)();
}

/* ===========================================================
   Suite: existência e gancho
   =========================================================== */
describe('Automação de faturamento · estrutura', () => {
  it('define reconciliarCadenciasFaturamento com filtro por centro de custo', () => {
    const corpo = extractFn(appJs, 'async function reconciliarCadenciasFaturamento(');
    assert.ok(corpo, 'reconciliarCadenciasFaturamento ausente');
    assert.ok(corpo.includes('centroCustoId = null'), 'sem parâmetro opcional de centro de custo');
    assert.ok(corpo.includes("porNome['faturamento mes passado']"), 'não resolve a cadência de mês passado');
    assert.ok(corpo.includes("porNome['faturamento trimestral']"), 'não resolve a cadência trimestral');
    assert.ok(corpo.includes("porNome['trimestral anual']"), 'não resolve a cadência anual');
    assert.ok(corpo.includes("porNome['contrato fechado']"), 'não resolve a cadência Contrato Fechado');
  });

  it('atualiza em batch e registra movimentações do sistema', () => {
    const corpo = extractFn(appJs, 'async function reconciliarCadenciasFaturamento(');
    assert.ok(corpo.includes('update({ cadencia_id: alvoId }).in(\'id\', ids)'),
      'sem batch update de cadencia_id');
    assert.ok(corpo.includes("movement_type: 'cadencia'"), 'sem movimentação de cadência');
    assert.ok(corpo.includes("insErr.code === '42703'"), 'sem fallback para banco sem user_id');
    assert.ok(!corpo.includes("description:"),
      'insert de lead_movements ainda envia description (coluna inexistente → PGRST204)');
    assert.ok(corpo.includes("'contrato-fechado': idFechado"),
      'destino do mês corrente (Contrato Fechado) ausente no mapa de destinos');
  });

  it('select de leads tolera coluna ausente (400/PGRST204) e filtra por .in()', () => {
    const corpo = extractFn(appJs, 'async function reconciliarCadenciasFaturamento(');
    assert.ok(corpo.includes('.in(\'cadencia_id\', idsCad)'), 'pool não filtra por .in(cadencia_id)');
    assert.ok(corpo.includes('[idFechado, idMes, idTrim, idAnual].filter(Boolean)'),
      'ids de cadência não passam por filter(Boolean)');
    assert.ok(corpo.includes("colunasLeads.join(',')"), 'select não usa a lista de colunas seguras');
    assert.ok(!corpo.includes('data_entrada_cadencia'),
      'select ainda pede a coluna inexistente data_entrada_cadencia (42703)');
    assert.ok(corpo.includes('order(\'created_at\', { ascending: true })'),
      'ordenação não usa { ascending: true }');
    assert.ok(corpo.includes('Coluna ausente no banco — removendo do select'),
      'sem retry removendo coluna ausente do select');
    assert.ok(corpo.includes('(?:[\\w"]+\\.)?'),
      'regex do retry não cobre nome qualificado (leads.coluna)');
    assert.ok(corpo.includes("console.error('[Faturamento] Detalhes do erro Supabase:'"),
      'sem log detalhado do erro do Supabase');
  });

  it('execução forçada no render do CRM: limpa trava, roda e loga o resultado', () => {
    assert.ok(appJs.includes("const _FATURAMENTO_GUARD_KEY = 'blue_faturamento_ultima_reconciliacao'"),
      'sem chave da trava no localStorage');
    const maybe = extractFn(appJs, 'async function maybeReconciliarFaturamento(');
    assert.ok(maybe, 'maybeReconciliarFaturamento ausente');
    assert.ok(maybe.includes('localStorage.removeItem(_FATURAMENTO_GUARD_KEY)'),
      'trava não é limpa antes da execução forçada');
    assert.ok(!maybe.includes('localStorage.getItem(_FATURAMENTO_GUARD_KEY)'),
      'execução ainda é bloqueada pela trava diária');
    assert.ok(maybe.includes("console.log('[Faturamento] Reconciliação executada: '"),
      'resultado da reconciliação não é logado');
    assert.ok(maybe.includes('reconciliarCadenciasFaturamento(null)'), 'não dispara a reconciliação');
    assert.ok(maybe.includes('refreshLeadsEClientsCache()'), 'não atualiza cache/kanban após mover leads');
    const showPage = appJs.slice(appJs.indexOf("if (page === 'crm') {"));
    assert.ok(showPage.startsWith('if (page === \'crm\') {') && showPage.includes('maybeReconciliarFaturamento()'),
      'setActivePage (CRM) não dispara a reconciliação');
  });
});

/* ===========================================================
   Suite: state machine de enquadramento
   =========================================================== */
describe('_enquadrarFaturamento · ciclo de vida por data de fechamento', () => {
  const { _enquadrarFaturamento: enq } = carregarHelpers();

  it('mês/ano corrente → contrato-fechado (permanece/retorna a Contrato Fechado)', () => {
    assert.equal(enq('2026-10-10', '2026-10-20'), 'contrato-fechado');
    assert.equal(enq('2026-10-01', '2026-10-31'), 'contrato-fechado');
    assert.equal(enq('2026-03-05', '2026-03-20'), 'contrato-fechado'); // mesmo mês, dia menor
  });

  it('mês imediatamente anterior → mes-passado', () => {
    assert.equal(enq('2026-03-15', '2026-04-01'), 'mes-passado');
    assert.equal(enq('2026-09-30', '2026-10-15'), 'mes-passado');
  });

  it('virada de ano: dezembro vira mes-passado em janeiro', () => {
    assert.equal(enq('2025-12-05', '2026-01-02'), 'mes-passado');
  });

  it('trimestres concluídos (2 a 3 meses atrás) → trimestral', () => {
    assert.equal(enq('2026-08-10', '2026-10-15'), 'trimestral'); // 2 meses
    assert.equal(enq('2026-07-15', '2026-10-15'), 'trimestral'); // 3 meses
    assert.equal(enq('2026-03-15', '2026-05-20'), 'trimestral');
    assert.equal(enq('2025-12-05', '2026-03-10'), 'trimestral'); // 3 meses
  });

  it('mais de 3 meses de fechamento → anual (histórico)', () => {
    assert.equal(enq('2026-06-15', '2026-10-15'), 'anual'); // 4 meses
    assert.equal(enq('2026-03-15', '2026-07-01'), 'anual');
    assert.equal(enq('2024-08-10', '2026-01-10'), 'anual');
  });

  it('data futura ou inválida → null (não mexe no lead)', () => {
    assert.equal(enq('2026-11-01', '2026-10-20'), null);
    assert.equal(enq('lixo', '2026-04-20'), null);
    assert.equal(enq('2026-03-15', ''), null);
    assert.equal(enq(null, '2026-04-20'), null);
  });
});

/* ===========================================================
   Suite: resolução da data de fechamento
   =========================================================== */
describe('_resolverDataFechamento · prioridade movimento > contrato > lead', () => {
  const { _resolverDataFechamento: resolver } = carregarHelpers();

  it('prioriza o ÚLTIMO movimento para Contrato Fechado (mesmo valor do badge)', () => {
    // lista em ordem desc (como a query constrói): [0] = mais recente
    const d = resolver('L1', { L1: ['2026-09-24T12:00:00Z', '2026-03-10T10:00:00Z'] }, { L1: ['2026-04-01'] }, { updated_at: '2026-05-01' });
    assert.equal(d, '2026-09-24T12:00:00Z');
    const unico = resolver('L1', { L1: ['2026-03-10T10:00:00Z'] }, {}, { updated_at: '2026-05-01' });
    assert.equal(unico, '2026-03-10T10:00:00Z');
  });

  it('sem movimento, usa o contrato mais antigo', () => {
    const d = resolver('L1', {}, { L1: ['2026-04-01', '2026-02-15'] }, { updated_at: '2026-05-01' });
    assert.equal(d, '2026-02-15');
  });

  it('sem movimento/contrato, cai para updated_at e depois created_at', () => {
    assert.equal(resolver('L1', {}, {}, { updated_at: '2026-05-01', created_at: '2026-01-01' }), '2026-05-01');
    assert.equal(resolver('L1', {}, {}, { created_at: '2026-01-01' }), '2026-01-01');
    assert.equal(resolver('L1', {}, {}, {}), null);
  });
});

/* ===========================================================
   Suite: helpers auxiliares
   =========================================================== */
describe('Helpers de faturamento', () => {
  const { _dataLocalISO, _normalizarNomeCadencia } = carregarHelpers();

  it('_dataLocalISO gera YYYY-MM-DD sem deslocamento de fuso', () => {
    assert.match(_dataLocalISO(new Date(2026, 0, 5)), /^2026-01-05$/);
    assert.match(_dataLocalISO(new Date(2026, 11, 31)), /^2026-12-31$/);
  });

  it('_normalizarNomeCadencia casa nomes com acento/caixa/espaços extras', () => {
    assert.equal(_normalizarNomeCadencia('Faturamento Mês Passado'), 'faturamento mes passado');
    assert.equal(_normalizarNomeCadencia('FATURAMENTO  MÊS PASSADO'), 'faturamento mes passado');
    assert.equal(_normalizarNomeCadencia('CONTRATO FECHADO'), 'contrato fechado');
    assert.equal(_normalizarNomeCadencia('  trimestral ANUAL '), 'trimestral anual');
    assert.equal(_normalizarNomeCadencia('Contrato Fechado'), 'contrato fechado');
  });
});

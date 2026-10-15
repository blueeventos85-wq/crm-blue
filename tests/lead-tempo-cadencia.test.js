import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Contador de tempo na cadência no card do lead
   - data de entrada = último movimento para a cadência atual
     (fallback updated_at/created_at)
   - formatarTempoNaCadencia: "Recém chegado"/"X min"/"Xh"/"Xd nesta etapa"
   - badge no card; mover o lead reinicia o contador
   - boot limpa a trava diária da reconciliação de faturamento
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const supabaseClient = readFileSync(join(root, 'supabaseClient.js'), 'utf8');
const stylesCss = readFileSync(join(root, 'styles.css'), 'utf8');

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

function carregarFormatar() {
  const corpo = extractFn(appJs, 'function formatarTempoNaCadencia(');
  assert.ok(corpo, 'formatarTempoNaCadencia ausente em app.js');
  return new Function(`${corpo}; return formatarTempoNaCadencia;`)();
}

/* ===========================================================
   Suite: formatarTempoNaCadencia
   =========================================================== */
describe('formatarTempoNaCadencia · texto amigável', () => {
  const fmt = carregarFormatar();

  it('menos de 1 minuto → "Recém chegado"', () => {
    assert.equal(fmt(new Date().toISOString()), 'Recém chegado');
    assert.equal(fmt(new Date(Date.now() - 30 * 1000).toISOString()), 'Recém chegado');
  });

  it('1 a 59 minutos → "X min nesta etapa"', () => {
    assert.equal(fmt(new Date(Date.now() - 30 * 60 * 1000).toISOString()), '30 min nesta etapa');
    assert.equal(fmt(new Date(Date.now() - 5 * 60 * 1000).toISOString()), '5 min nesta etapa');
  });

  it('1 a 23 horas → "Xh nesta etapa"', () => {
    assert.equal(fmt(new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()), '5h nesta etapa');
    assert.equal(fmt(new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()), '23h nesta etapa');
  });

  it('1 dia ou mais → "Xd nesta etapa"', () => {
    assert.equal(fmt(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()), '1d nesta etapa');
    assert.equal(fmt(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()), '3d nesta etapa');
    assert.equal(fmt(new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()), '15d nesta etapa');
  });

  it('entrada ausente ou inválida → string vazia (não renderiza badge)', () => {
    assert.equal(fmt(null), '');
    assert.equal(fmt(''), '');
    assert.equal(fmt('lixo'), '');
  });
});

/* ===========================================================
   Suite: badge no card do lead
   =========================================================== */
describe('leadCardHTML · badge de tempo na cadência', () => {
  const corpo = extractFn(appJs, 'function leadCardHTML(');

  it('renderiza o badge com ícone de relógio a partir de _entradaCadencia', () => {
    assert.ok(corpo, 'leadCardHTML ausente');
    assert.ok(corpo.includes('formatarTempoNaCadencia(l._entradaCadencia)'),
      'card não calcula o tempo na cadência');
    assert.ok(corpo.includes('lead-card-time-badge'), 'sem classe do badge de tempo');
    assert.ok(corpo.includes('data-lucide="clock"'), 'badge sem ícone de relógio');
    assert.ok(corpo.includes('Tempo nesta cadência'), 'badge sem tooltip');
  });

  it('badge aparece junto ao responsável (no meta do card)', () => {
    const iConst = corpo.indexOf('lead-card-time-badge');
    const iMeta = corpo.indexOf('<div class="lead-card-meta">');
    const iInterp = corpo.indexOf('${tempoBadge}', iMeta);
    const iResp = corpo.indexOf('lead-card-member-badge', iMeta);
    assert.ok(iConst > -1 && iConst < iMeta, 'badge definido fora da const tempoBadge');
    assert.ok(iMeta > -1, 'bloco lead-card-meta ausente no card');
    assert.ok(iInterp > iMeta && iInterp < iResp, 'badge interpolado fora do meta ou após o responsável');
  });

  it('estilo discreto slate definido no CSS (claro e dark)', () => {
    assert.ok(stylesCss.includes('.lead-card-time-badge'), 'CSS do badge ausente');
    assert.ok(stylesCss.includes('.theme-dark .lead-card-time-badge'), 'sem variante dark do badge');
  });
});

/* ===========================================================
   Suite: origem da data de entrada (fetchLeadsSupabase)
   =========================================================== */
describe('fetchLeadsSupabase · _entradaCadencia', () => {
  it('carrega o último movimento de cadência por lead (ordem desc)', () => {
    assert.ok(supabaseClient.includes(".from('lead_movements')"), 'sem consulta a lead_movements');
    assert.ok(supabaseClient.includes(".eq('movement_type', 'cadencia')"), 'sem filtro de movimentação de cadência');
    assert.ok(supabaseClient.includes("order('created_at', { ascending: false })"),
      'movimentações não ordenadas da mais recente');
    assert.ok(supabaseClient.includes('entradaMap[m.lead_id] = m'), 'mapa de entrada por lead ausente');
  });

  it('usa o movimento só quando to_value é a cadência atual; senão fallback', () => {
    assert.ok(supabaseClient.includes('ult.to_value === row.cadencia_id'),
      'movimento não é comparado com a cadência atual do lead');
    assert.ok(supabaseClient.includes('row.updated_at || row.created_at'),
      'sem fallback updated_at/created_at');
    assert.ok(supabaseClient.includes('_entradaCadencia:'), 'campo _entradaCadencia não mapeado no lead');
  });
});

/* ===========================================================
   Suite: mover lead reinicia o contador
   =========================================================== */
describe('Mover lead · contador reinicia', () => {
  it('updateLeadCadencia (DnD/menu) registra movimentação e atualiza _entradaCadencia', () => {
    const corpo = extractFn(appJs, 'async function updateLeadCadencia(');
    assert.ok(corpo, 'updateLeadCadencia ausente');
    assert.ok(corpo.includes('lead._entradaCadencia = new Date().toISOString()'),
      'contador não reinicia no arraste/menu');
    assert.ok(corpo.includes('insertMovement('), 'movimento de cadência não é registrado no DnD');
    assert.ok(corpo.includes("movement_type: 'cadencia'"), 'movimento registrado sem tipo cadencia');
    assert.ok(corpo.includes('from_value: oldStatus') && corpo.includes('to_value: newStatus'),
      'movimento sem origem/destino');
  });

  it('handleChangeCadence (journey) também reinicia o contador', () => {
    const corpo = extractFn(appJs, 'async function handleChangeCadence(');
    assert.ok(corpo, 'handleChangeCadence ausente');
    assert.ok(corpo.includes('lead._entradaCadencia = new Date().toISOString()'),
      'journey não reinicia o contador');
    assert.ok(corpo.includes('insertMovement('), 'journey sem registro de movimentação');
  });
});

/* ===========================================================
   Suite: boot limpa a trava da reconciliação
   =========================================================== */
describe('Boot · trava da reconciliação de faturamento', () => {
  it('DOMContentLoaded remove a chave diária para execução imediata', () => {
    const boot = appJs.slice(appJs.indexOf("document.addEventListener('DOMContentLoaded'"));
    assert.ok(boot.includes('localStorage.removeItem(_FATURAMENTO_GUARD_KEY)'),
      'boot não limpa a trava blue_faturamento_ultima_reconciliacao');
    assert.ok(appJs.includes("const _FATURAMENTO_GUARD_KEY = 'blue_faturamento_ultima_reconciliacao'"),
      'chave da trava ausente');
  });

  it('maybeReconciliarFaturamento ainda grava a trava após executar', () => {
    const maybe = extractFn(appJs, 'async function maybeReconciliarFaturamento(');
    assert.ok(maybe, 'maybeReconciliarFaturamento ausente');
    assert.ok(maybe.includes('localStorage.setItem(_FATURAMENTO_GUARD_KEY'), 'guard não é gravado após executar');
  });
});

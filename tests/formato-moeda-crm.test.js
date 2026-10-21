import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes: formatação monetária unificada no CRM
   - formatCurrency: helper global único, sempre R$ X.XXX,XX
   - sumHonorarios: mesma soma nos 3 superfícies (cards,
     cabeçalhos de coluna kanban e totalizador do topo)
   - nenhum arredondamento (Math.round/parseInt/toFixed) antes
     da renderização
   - o totalizador e o card atualizam juntos via renderAll()
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

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

/* Intl usa NBSP (U+00A0) entre "R$" e o número — normaliza p/ as asserções. */
const brl = s => String(s).replace(/\u00A0/g, ' ');

function carregarHelpers() {
  const src = [
    extractFn(appJs, 'function formatCurrency('),
    extractFn(appJs, 'function sumHonorarios('),
    extractFn(appJs, 'function parseMoeda(')
  ];
  src.forEach((s, i) => assert.ok(s, `bloco ${i} ausente`));
  return new Function(`${src.join('; ')}; return { formatCurrency, sumHonorarios };`)();
}

/* ===========================================================
   Suite: formatCurrency (helper global)
   =========================================================== */
describe('formatCurrency · helper global BRL com centavos', () => {
  const { formatCurrency } = carregarHelpers();

  it('sempre exibe 2 casas decimais no padrão brasileiro', () => {
    assert.equal(brl(formatCurrency(70873.55)), 'R$ 70.873,55');
    assert.equal(brl(formatCurrency(144293.5)), 'R$ 144.293,50');
    assert.equal(brl(formatCurrency(1234)), 'R$ 1.234,00');
    assert.equal(brl(formatCurrency(0)), 'R$ 0,00');
  });

  it('não arredonda para inteiro (centavos preservados)', () => {
    assert.notEqual(brl(formatCurrency(70873.55)), 'R$ 70.874');
    assert.ok(!/,\d?$/.test(brl(formatCurrency(144293.5)).replace(/\u00A0/g, '')),
      'valor com 1 casa decimal ainda escorrendo');
  });

  it('entradas inválidas/vazias viram R$ 0,00', () => {
    assert.equal(brl(formatCurrency(undefined)), 'R$ 0,00');
    assert.equal(brl(formatCurrency(null)), 'R$ 0,00');
    assert.equal(brl(formatCurrency(NaN)), 'R$ 0,00');
    assert.equal(brl(formatCurrency('abc')), 'R$ 0,00');
    assert.equal(brl(formatCurrency('')), 'R$ 0,00');
  });

  it('aceita número em string numérica (valor vindo do banco)', () => {
    assert.equal(brl(formatCurrency('144293.5')), 'R$ 144.293,50');
  });
});

/* ===========================================================
   Suite: sumHonorarios (soma canônica)
   =========================================================== */
describe('sumHonorarios · mesma fonte de cálculo', () => {
  const { sumHonorarios, formatCurrency } = carregarHelpers();

  it('soma ponto flutuante real sem arredondar antes da exibição', () => {
    const total = sumHonorarios([
      { honorarios: 70873.55 },
      { honorarios: 73420 }
    ]);
    assert.equal(total, 144293.55);
    assert.equal(brl(formatCurrency(total)), 'R$ 144.293,55');
  });

  it('mesma soma para lista vazia e campos ausentes', () => {
    assert.equal(sumHonorarios([]), 0);
    assert.equal(sumHonorarios(null), 0);
    assert.equal(sumHonorarios([{}, { honorarios: null }, { honorarios: 0 }]), 0);
  });

  it('tolera valor em string brasileira ("1.402,50") sem concatenar texto', () => {
    assert.equal(sumHonorarios([{ honorarios: '1.402,50' }, { honorarios: 500 }]), 1902.5);
  });

  it('não usa parseInt/Math.round/toFixed na soma', () => {
    const corpo = extractFn(appJs, 'function sumHonorarios(');
    assert.ok(!/parseInt|Math\.round|toFixed/.test(corpo), 'arredondamento dentro da soma');
  });
});

/* ===========================================================
   Suite: as 3 superfícies usam o mesmo helper
   =========================================================== */
describe('CRM · cards, colunas e totalizador sincronizados', () => {
  it('card de resumo (cadence-card-value) usa formatCurrency', () => {
    const summary = extractFn(appJs, 'function cadencesSummary(');
    assert.ok(summary, 'cadencesSummary ausente');
    assert.ok(summary.includes('sumHonorarios(list)'), 'card soma por conta própria');
    assert.ok(appJs.includes('formatCurrency(c.value)'), 'card não usa formatCurrency na renderização');
  });

  it('cabeçalho da coluna kanban usa formatCurrency na mesma soma', () => {
    const render = extractFn(appJs, 'function renderKanban(');
    assert.ok(render, 'renderKanban ausente');
    assert.ok(render.includes('const totalFat = sumHonorarios(list);'),
      'coluna não usa a soma canônica');
    assert.ok(render.includes('formatCurrency(totalFat)'), 'coluna não usa formatCurrency');
    assert.ok(!/Math\.round|parseInt|toFixed\(0\)/.test(render),
      'arredondamento antes da renderização na coluna');
  });

  it('totalizador do topo usa formatCurrency(sumHonorarios(...))', () => {
    const meta = extractFn(appJs, 'function updateKanbanMeta(');
    assert.ok(meta, 'updateKanbanMeta ausente');
    assert.ok(meta.includes('formatCurrency(sumHonorarios(visible))'),
      'totalizador sem helper unificado');
    assert.ok(!meta.includes('toLocaleString'), 'totalizador formata por conta própria');
  });

  it('formatBRL (usado em dashboards/tabelas) delega para formatCurrency', () => {
    const corpo = extractFn(appJs, 'function formatBRL(');
    assert.ok(corpo, 'formatBRL ausente');
    assert.ok(corpo.includes('formatCurrency('), 'formatBRL não delega ao helper global');
    assert.ok(!corpo.includes('maximumFractionDigits: 0'),
      'formatBRL ainda arredonda para inteiro');
  });

  it('pill do topo não tem "R$ " estático (evita R$ duplicado)', () => {
    const pill = indexHtml.match(/<span[^>]*id="kanbanValue"[^>]*>[\s\S]*?<\/span>/);
    assert.ok(pill, '#kanbanValue ausente');
    assert.ok(indexHtml.includes('<span id="kanbanValue">R$ 0,00</span>'),
      'valor inicial do pill fora do padrão R$ X.XXX,XX');
    assert.ok(!pill[0].includes('R$ <span'), 'prefixo R$ estático ainda presente');
  });

  it('renderAll atualiza card e coluna/totalizador juntos', () => {
    const corpo = extractFn(appJs, 'function renderAll(');
    assert.ok(corpo, 'renderAll ausente');
    assert.ok(corpo.includes('renderCadenceGrid();') && corpo.includes('renderKanban();'),
      'movimentação de lead não atualiza as três superfícies');
    assert.ok(appJs.includes('renderAll();'), 'nenhum caminho de mutação re-renderiza');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes: valores monetários e datas no PATCH de contratos
   - parseMoeda: "402,5" → 402.5 (evita 400 em colunas numéricas)
   - paraISODate: DD/MM/YYYY → YYYY-MM-DD (evita 400 em colunas date)
   - aplicação em collect/split/fillFromLead/edição
   - sanitizador do PATCH serializa números e datas
   - log do JSON da resposta em caso de erro 400
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');

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

function extrairConst(nome) {
  const m = appJs.match(new RegExp(`const ${nome} = \\[[^\\]]*\\];`));
  assert.ok(m, `const ${nome} ausente em app.js`);
  return m[0];
}

function carregarHelpers() {
  const src = [
    extrairConst('_CONTRATO_COLUNAS_TABELA'),
    extrairConst('_CONTRATO_CHAVES_UUID'),
    extrairConst('_CONTRATO_CHAVES_NUMERICAS'),
    extrairConst('_CONTRATO_CHAVES_DATA'),
    extractFn(appJs, 'function parseMoeda('),
    extractFn(appJs, 'function paraISODate('),
    extractFn(appJs, 'function _sanearPayloadContratoUpdate(')
  ];
  src.forEach((s, i) => assert.ok(s, `bloco ${i} ausente`));
  return new Function('console', `${src.join('; ')}; return { parseMoeda, paraISODate, _sanearPayloadContratoUpdate };`)({ warn() {}, error() {}, log() {} });
}

/* ===========================================================
   Suite: parseMoeda
   =========================================================== */
describe('parseMoeda · conversão de valores monetários', () => {
  const { parseMoeda } = carregarHelpers();

  it('vírgula decimal pt-BR: "402,5" → 402.5', () => {
    assert.equal(parseMoeda('402,5'), 402.5);
    assert.equal(parseMoeda('402,50'), 402.5);
  });

  it('símbolo e milhar: "R$ 1.402,50" → 1402.5', () => {
    assert.equal(parseMoeda('R$ 1.402,50'), 1402.5);
    assert.equal(parseMoeda('1.402'), 1402);
  });

  it('formato com ponto decimal: "1402.5" → 1402.5', () => {
    assert.equal(parseMoeda('1402.5'), 1402.5);
    assert.equal(parseMoeda('0,001'), 0.001);
  });

  it('números passam intactos; negativos funcionam', () => {
    assert.equal(parseMoeda(402.5), 402.5);
    assert.equal(parseMoeda(-402.5), -402.5);
    assert.equal(parseMoeda('-402,5'), -402.5);
  });

  it('vazio/inválido → 0 (nunca NaN no payload)', () => {
    assert.equal(parseMoeda(''), 0);
    assert.equal(parseMoeda(null), 0);
    assert.equal(parseMoeda(undefined), 0);
    assert.equal(parseMoeda('abc'), 0);
    assert.equal(parseMoeda(NaN), 0);
  });
});

/* ===========================================================
   Suite: paraISODate
   =========================================================== */
describe('paraISODate · datas em YYYY-MM-DD', () => {
  const { paraISODate } = carregarHelpers();

  it('converte DD/MM/YYYY → YYYY-MM-DD', () => {
    assert.equal(paraISODate('16/10/2026'), '2026-10-16');
    assert.equal(paraISODate('6/10/2026'), '2026-10-06');
  });

  it('mantém ISO válido', () => {
    assert.equal(paraISODate('2026-10-16'), '2026-10-16');
  });

  it('vazio/irreconhecível → null (evita 400 de date inválido)', () => {
    assert.equal(paraISODate(''), null);
    assert.equal(paraISODate(null), null);
    assert.equal(paraISODate(undefined), null);
    assert.equal(paraISODate('abc'), null);
    assert.equal(paraISODate('16-10-2026'), null);
  });
});

/* ===========================================================
   Suite: aplicação nos pontos de montagem do payload
   =========================================================== */
describe('Contratos · parseMoeda/paraISODate aplicados no payload', () => {
  it('collectContratoFormData usa parseMoeda em valor_total e parcelas', () => {
    const corpo = extractFn(appJs, 'function collectContratoFormData()');
    assert.ok(corpo, 'collectContratoFormData ausente');
    assert.ok(corpo.includes("parseMoeda(document.getElementById('contratoValorTotal')?.value)"),
      'valor_total sem parseMoeda');
    assert.ok(corpo.includes("parseMoeda(document.getElementById('contratoValorP' + i)?.value)"),
      'valor da parcela sem parseMoeda');
    assert.ok(!corpo.includes('parseFloat(document.getElementById(\'contratoValor'),
      'parseFloat legado ainda lê os campos de valor');
  });

  it('collectContratoFormData usa paraISODate em datas e vencimentos', () => {
    const corpo = extractFn(appJs, 'function collectContratoFormData()');
    assert.ok(corpo.includes("paraISODate(document.getElementById('contratoDataEvento')?.value)"),
      'data_evento sem paraISODate');
    assert.ok(corpo.includes("paraISODate(document.getElementById('contratoVencimentoP1')?.value)"),
      'vencimento da parcela 1 sem paraISODate');
    assert.ok(corpo.includes("paraISODate(document.getElementById('contratoVencimentoP' + i)?.value)"),
      'vencimento das parcelas sem paraISODate');
  });

  it('_aplicaSplitParcelas usa parseMoeda no total', () => {
    const corpo = extractFn(appJs, 'function _aplicaSplitParcelas(');
    assert.ok(corpo, '_aplicaSplitParcelas ausente');
    assert.ok(corpo.includes("parseMoeda(document.getElementById('contratoValorTotal')?.value)"),
      'split calculado com parseFloat legado');
  });

  it('fillContratoFromLead converte honorários e data do lead', () => {
    const corpo = extractFn(appJs, 'function fillContratoFromLead(');
    assert.ok(corpo, 'fillContratoFromLead ausente');
    assert.ok(corpo.includes('parseMoeda(lead.honorarios)'), 'honorários sem parseMoeda');
    assert.ok(corpo.includes('paraISODate(lead.data_evento)'), 'data_evento do lead sem paraISODate');
  });

  it('contratoEdit normaliza datas e valores ao preencher o form', () => {
    const corpo = extractFn(appJs, 'async function contratoEdit(');
    assert.ok(corpo, 'contratoEdit ausente');
    assert.ok(corpo.includes('paraISODate(data.data_evento)'), 'data_evento sem conversão na edição');
    assert.ok(corpo.includes('parseMoeda(data.valor_total)'), 'valor_total sem conversão na edição');
    assert.ok(corpo.includes('parseMoeda(parcelas[i - 1].valor)'), 'valor da parcela sem conversão');
    assert.ok(corpo.includes('paraISODate(parcelas[i - 1].vencimento)'), 'vencimento sem conversão');
  });
});

/* ===========================================================
   Suite: sanitizador do PATCH
   =========================================================== */
describe('_sanearPayloadContratoUpdate · números e datas', () => {
  const { _sanearPayloadContratoUpdate: sanear } = carregarHelpers();

  it('string com vírgula vira número: valor_total "402,5" → 402.5', () => {
    assert.equal(sanear({ valor_total: '402,5' }).valor_total, 402.5);
    assert.equal(sanear({ quantidade_horas: '2,5' }).quantidade_horas, 2.5);
    assert.equal(sanear({ quantidade_parcelas: '2' }).quantidade_parcelas, 2);
  });

  it('numérico vazio → null (nullable) / quantidade_parcelas ausente (NOT NULL preservada)', () => {
    assert.equal(sanear({ valor_total: '' }).valor_total, null);
    assert.equal(sanear({ quantidade_horas: '' }).quantidade_horas, null);
    assert.ok(!('quantidade_parcelas' in sanear({ quantidade_parcelas: '' })),
      'quantidade_parcelas vazia deve ser omitida');
  });

  it('datas: DD/MM → ISO; vazio → null; data_emissao inválida é omitida', () => {
    assert.equal(sanear({ data_evento: '16/10/2026' }).data_evento, '2026-10-16');
    assert.equal(sanear({ data_evento: '2026-10-16' }).data_evento, '2026-10-16');
    assert.equal(sanear({ data_evento: '' }).data_evento, null);
    assert.equal(sanear({ data_emissao: '16/10/2026' }).data_emissao, '2026-10-16',
      'data_emissao em DD/MM deve ser convertida para ISO');
    assert.ok(!('data_emissao' in sanear({ data_emissao: 'abc' })),
      'data_emissao irreconhecível deve ser omitida (NOT NULL preservada)');
    assert.equal(sanear({ data_emissao: '2026-10-16' }).data_emissao, '2026-10-16');
  });

  it('regressão: uuid vazio → null, NaN/undefined removidos, texto vazio mantido', () => {
    const out = sanear({ lead_id: '', contratante_email: '', valor_total: NaN, x: undefined, status: 'rascunho' });
    assert.equal(out.lead_id, null);
    assert.equal(out.contratante_email, '');
    assert.ok(!('valor_total' in out));
    assert.ok(!('x' in out));
    assert.equal(out.status, 'rascunho');
  });
});

/* ===========================================================
   Suite: log do JSON da resposta em erro de PATCH
   =========================================================== */
describe('PATCH de contratos · log do JSON de erro', () => {
  it('saveContrato loga o JSON da resposta do PostgREST', () => {
    const corpo = extractFn(appJs, 'async function saveContrato(');
    assert.ok(corpo, 'saveContrato ausente');
    assert.ok(corpo.includes("PATCH 400 — JSON da resposta:"), 'sem log identificado do PATCH 400');
    assert.ok(corpo.includes('JSON.stringify(error)'), 'não serializa o objeto de erro');
  });

  it('salvarContratoComoRascunho loga o JSON do erro', () => {
    const corpo = extractFn(appJs, 'async function salvarContratoComoRascunho(');
    assert.ok(corpo, 'salvarContratoComoRascunho ausente');
    assert.ok(corpo.includes('JSON.stringify(err)'), 'sem JSON do erro no rascunho');
  });
});

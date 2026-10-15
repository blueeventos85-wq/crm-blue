import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes: correção "Lead vinculado ausente" ao editar contrato
   - contratoEdit preserva o lead_id no hidden #contratoLeadId
     (mesmo quando o lead não está na lista carregada)
   - validação exige lead apenas na criação (edição não trava)
   - PATCH ao Supabase sanitizado (uuid vazio → null;
     undefined/NaN removidos — evitam 400 Bad Request)
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

function carregarSanear() {
  const constMatch = appJs.match(/const _CONTRATO_CHAVES_UUID = \[[^\]]*\];/);
  assert.ok(constMatch, '_CONTRATO_CHAVES_UUID ausente');
  const corpo = extractFn(appJs, 'function _sanearPayloadContratoUpdate(');
  assert.ok(corpo, '_sanearPayloadContratoUpdate ausente');
  return new Function(`${constMatch[0]}; ${corpo}; return _sanearPayloadContratoUpdate;`)();
}

/* ===========================================================
   Suite: contratoEdit preenche/mantém o lead no formulário
   =========================================================== */
describe('contratoEdit · lead preservado no formulário', () => {
  const corpo = extractFn(appJs, 'async function contratoEdit(');

  it('contratoEdit existe', () => {
    assert.ok(corpo, 'contratoEdit ausente em app.js');
  });

  it('limpa estado de lead da sessão anterior antes de preencher', () => {
    assert.ok(corpo.includes('_resetLeadSearchable()'),
      'contratoEdit sem _resetLeadSearchable (risco de lead de outra sessão)');
  });

  it('garante o lead na lista pesquisável antes de selecionar', () => {
    assert.ok(corpo.includes('_garantirLeadContratoNaLista(data.lead_id)'),
      'não busca o lead fora do escopo de loadContratoLeads');
  });

  it('sempre grava data.lead_id no hidden #contratoLeadId', () => {
    assert.ok(corpo.includes('hidden.value = data.lead_id'),
      'hidden contratoLeadId não recebe o lead do contrato');
    assert.ok(corpo.includes('_selectLeadById(data.lead_id)'),
      'não seleciona o lead atual na UI');
    assert.ok(corpo.includes('_mostrarLeadVinculadoFallback()'),
      'sem fallback de exibição quando o lead não está disponível');
  });

  it('helpers existem e popular o estado correto', () => {
    const garante = extractFn(appJs, 'async function _garantirLeadContratoNaLista(');
    assert.ok(garante, '_garantirLeadContratoNaLista ausente');
    assert.ok(garante.includes("from('leads')"), 'não consulta a tabela leads');
    assert.ok(garante.includes('maybeSingle()'), 'não busca o lead pontualmente');

    const fallback = extractFn(appJs, 'function _mostrarLeadVinculadoFallback(');
    assert.ok(fallback, '_mostrarLeadVinculadoFallback ausente');
    assert.ok(fallback.includes('leadSearchValue'), 'não exibe valor no controle do lead');
  });
});

/* ===========================================================
   Suite: validação — lead exigido só na criação
   =========================================================== */
describe('validateContratoForm · lead obrigatório apenas na criação', () => {
  const corpo = extractFn(appJs, 'function validateContratoForm()');

  it('validação existe', () => {
    assert.ok(corpo, 'validateContratoForm ausente');
  });

  it('ignora contratoLeadId quando em edição (não trava a edição)', () => {
    assert.ok(corpo.includes("f.id === 'contratoLeadId' && emEdicao"),
      'edição de contrato ainda exige lead vinculado');
    assert.ok(corpo.includes('const emEdicao ='), 'sem detecção de modo edição');
  });

  it('mantém contratoLeadId obrigatório na criação', () => {
    const required = appJs.match(/const _contratoRequiredFields = \[[\s\S]*?\];/);
    assert.ok(required, '_contratoRequiredFields ausente');
    assert.ok(required[0].includes("id: 'contratoLeadId', label: 'Lead vinculado'"),
      'lead deixou de ser campo obrigatório da criação');
  });

  it('mantém as validações de parcelas', () => {
    assert.ok(corpo.includes("id: 'contratoValorP' + i"), 'validação de valor da parcela removida');
    assert.ok(corpo.includes("id: 'contratoVencimentoP' + i"), 'validação de vencimento da parcela removida');
  });
});

/* ===========================================================
   Suite: PATCH sanitizado (evita 400)
   =========================================================== */
describe('PATCH de contratos · payload sanitizado', () => {
  it('saveContrato usa o payload sanitizado (inclusive no retry)', () => {
    const corpo = extractFn(appJs, 'async function saveContrato(');
    assert.ok(corpo, 'saveContrato ausente');
    assert.ok(corpo.includes('_sanearPayloadContratoUpdate(payload)'),
      'saveContrato não sanitiza o payload do update');
    assert.ok(corpo.includes('.update(patch)'), 'update não usa o patch sanitizado');
    assert.ok(corpo.includes('_contratoUpdateSemTipo(patch, existingId)'),
      'retry sem tipo_contrato não usa o patch sanitizado');
  });

  it('salvarContratoComoRascunho sanitiza o update', () => {
    const corpo = extractFn(appJs, 'async function salvarContratoComoRascunho(');
    assert.ok(corpo, 'salvarContratoComoRascunho ausente');
    assert.ok(corpo.includes('_sanearPayloadContratoUpdate(payload)'),
      'rascunho não sanitiza o payload do update');
    assert.ok(corpo.includes('.update(patch)'), 'update do rascunho não usa o patch sanitizado');
    assert.ok(corpo.includes('_contratoUpdateSemTipo(patch, existingId)'),
      'retry do rascunho não usa o patch sanitizado');
  });

  it('sanitizador: uuid vazio vira null, undefined/NaN saem, texto vazio permanece', () => {
    const sanear = carregarSanear();
    const out = sanear({
      lead_id: '',
      centro_custo_id: '',
      membro_id: 'uuid-valido',
      contratante_email: '',
      valor_total: NaN,
      quantidade_horas: Infinity,
      indefinido: undefined,
      status: 'rascunho'
    });
    assert.equal(out.lead_id, null, 'lead_id vazio deve virar null');
    assert.equal(out.centro_custo_id, null, 'centro_custo_id vazio deve virar null');
    assert.equal(out.membro_id, 'uuid-valido', 'uuid válido deve ser mantido');
    assert.equal(out.contratante_email, '', 'texto vazio deve ser mantido (limpeza de campo)');
    assert.ok(!('valor_total' in out), 'NaN deve ser removido');
    assert.ok(!('quantidade_horas' in out), 'Infinity deve ser removido');
    assert.ok(!('indefinido' in out), 'undefined deve ser removido');
    assert.equal(out.status, 'rascunho', 'chaves válidas passam intactas');
  });
});

/* ===========================================================
   Suite: campo de seleção de lead no modal
   =========================================================== */
describe('Modal de contrato · campo de seleção de lead', () => {
  it('index.html mantém o hidden #contratoLeadId e o buscador', () => {
    assert.ok(indexHtml.includes('<input type="hidden" id="contratoLeadId" />'),
      'hidden contratoLeadId ausente');
    assert.ok(indexHtml.includes('id="leadSearchControl"'),
      'controle do buscador de lead ausente');
  });
});

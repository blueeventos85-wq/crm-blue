import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   CORREÇÃO DEFINITIVA: PATCH 400 em contratos
   - whitelist de colunas reais (_CONTRATO_COLUNAS_TABELA)
   - sanitizador descarta chaves fora da tabela
   - _patchContrato: retry genérico removendo colunas ausentes
   - erro real exposto no log/toast
   - PDF não bloqueia se o save falhar
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

function extrairConst(nome) {
  const m = appJs.match(new RegExp(`const ${nome} = \\[[^\\]]*\\];`));
  assert.ok(m, `const ${nome} ausente em app.js`);
  return m[0];
}

function carregarSanear() {
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
  return new Function('console', `${src.join('; ')}; return { parseMoeda, _sanearPayloadContratoUpdate };`)({ warn() {}, error() {}, log() {} });
}

/* Executa _patchContrato extraída com stub do Supabase.
   erros[i] é o erro devolvido na tentativa i (0-based); sem erro → sucesso. */
async function executarPatch(patch, erros) {
  const corpo = extractFn(appJs, 'async function _patchContrato(');
  assert.ok(corpo, '_patchContrato ausente');
  const chamadas = [];
  const supabase = {
    from(tabela) {
      assert.equal(tabela, 'contratos');
      return {
        update(p) {
          chamadas.push({ ...p });
          return {
            eq(col, val) {
              assert.equal(col, 'id');
              assert.equal(val, 'c1');
              return {
                select() {
                  return {
                    single: async () => {
                      const idx = chamadas.length - 1;
                      const err = erros[idx] || null;
                      return err ? { data: null, error: err } : { data: { id: 'c1', ...p }, error: null };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const fn = new Function('_supabase', `${corpo}; return _patchContrato;`)(supabase);
  const resultado = await fn('c1', patch);
  return { resultado, chamadas };
}

/* ===========================================================
   Suite: whitelist de colunas
   =========================================================== */
describe('_CONTRATO_COLUNAS_TABELA · colunas reais da tabela', () => {
  const m = extrairConst('_CONTRATO_COLUNAS_TABELA');

  it('cobre colunas da base, de migrations e do payload do form', () => {
    for (const col of [
      'id', 'lead_id', 'membro_id', 'owner_id', 'centro_custo_id',
      'numero_contrato', 'status', 'servicos', 'descricao_servicos',
      'data_evento', 'quantidade_horas', 'valor_total', 'quantidade_parcelas',
      'parcelas', 'data_emissao', 'conteudo_contrato', 'pdf_storage_path',
      'tipo_contrato', 'deleted_at', 'assinado_storage_path', 'updated_at'
    ]) {
      assert.ok(m.includes(`'${col}'`), `whitelist sem a coluna ${col}`);
    }
  });

  it('sanitizador descarta chave fora da tabela e preserva status', () => {
    const { _sanearPayloadContratoUpdate: sanear } = carregarSanear();
    const out = sanear({ campo_virtual: 1, status: 'gerado', valor_total: '10,5' });
    assert.ok(!('campo_virtual' in out), 'chave fora da whitelist deve ser descartada');
    assert.equal(out.status, 'gerado', 'status deve ser preservado');
    assert.equal(out.valor_total, 10.5, 'numérico string deve virar number');
  });
});

/* ===========================================================
   Suite: _patchContrato (retry genérico com stub do Supabase)
   =========================================================== */
describe('_patchContrato · retry remove coluna ausente e repete', () => {
  it('coluna inexistente no 1º PATCH cai fora e o 2º PATCH dá certo', async () => {
    const { resultado, chamadas } = await executarPatch(
      { tipo_contrato: '100%', valor_total: 10 },
      [{ message: "Could not find the 'tipo_contrato' column of 'contratos' in the schema cache" }]
    );
    assert.equal(chamadas.length, 2, 'deve tentar o PATCH 2 vezes');
    assert.ok('tipo_contrato' in chamadas[0], '1ª tentativa leva a coluna');
    assert.ok(!('tipo_contrato' in chamadas[1]), '2ª tentativa não leva a coluna ausente');
    assert.equal(chamadas[1].valor_total, 10, 'demais campos permanecem no patch');
    assert.equal(resultado.error, null);
    assert.equal(resultado.data.id, 'c1');
  });

  it('mensagem no formato "column ... does not exist" também dispara o retry', async () => {
    const { resultado, chamadas } = await executarPatch(
      { descricao_servicos: 'x', status: 'rascunho' },
      [{ message: 'column contratos.descricao_servicos does not exist', details: '' }]
    );
    assert.equal(chamadas.length, 2);
    assert.ok(!('descricao_servicos' in chamadas[1]));
    assert.equal(chamadas[1].status, 'rascunho', 'status preservado no retry');
    assert.equal(resultado.error, null);
  });

  it('erro que não é de coluna retorna direto (1 tentativa)', async () => {
    const { resultado, chamadas } = await executarPatch(
      { lead_id: 'x' },
      [{ message: 'invalid input syntax for type uuid: ""', code: '22P02' }]
    );
    assert.equal(chamadas.length, 1, 'não deve repetir PATCH para erro não-coluna');
    assert.ok(resultado.error);
    assert.equal(resultado.error.code, '22P02');
  });

  it('coluna citada que não está no patch não gera retry infinito', async () => {
    const { resultado, chamadas } = await executarPatch(
      { valor_total: 5 },
      [{ message: "column contratos.coluna_outra does not exist" }]
    );
    assert.equal(chamadas.length, 1);
    assert.ok(resultado.error);
  });
});

/* ===========================================================
   Suite: save/rascunho usam _patchContrato + erro exposto
   =========================================================== */
describe('PATCH de contratos · fluxo definitivo', () => {
  it('saveContrato e salvarContratoComoRascunho usam _patchContrato', () => {
    for (const header of ['async function saveContrato(', 'async function salvarContratoComoRascunho(']) {
      const corpo = extractFn(appJs, header);
      assert.ok(corpo, `${header} ausente`);
      assert.ok(corpo.includes('_patchContrato(existingId, patch)'), `${header} sem _patchContrato`);
    }
  });

  it('erro real exposto no log e no toast', () => {
    const save = extractFn(appJs, 'async function saveContrato(');
    assert.ok(save.includes("[Contratos Erro Detalhado]"), 'saveContrato sem log de erro detalhado');
    assert.ok(save.includes('error.message || error.details || _friendlyContratoError(error)'),
      'toast do saveContrato esconde message/details');
    const rascunho = extractFn(appJs, 'async function salvarContratoComoRascunho(');
    assert.ok(rascunho.includes('[Contratos Erro Detalhado]'), 'rascunho sem log de erro detalhado');
    assert.ok(rascunho.includes('err.message || err.details || _friendlyContratoError(err)'),
      'toast do rascunho esconde message/details');
  });

  it('_friendlyContratoError cai para details quando não há message', () => {
    const corpo = extractFn(appJs, 'function _friendlyContratoError(');
    assert.ok(corpo, '_friendlyContratoError ausente');
    const fn = new Function(`${corpo}; return _friendlyContratoError;`)();
    assert.equal(fn({ details: 'coluna x ausente' }), 'coluna x ausente');
    assert.equal(fn({ message: 'msg direta' }), 'msg direta');
    assert.equal(fn({ code: '23505', message: 'dup' }), 'número de contrato duplicado. Aguarde um instante e tente novamente.');
  });
});

/* ===========================================================
   Suite: PDF não bloqueia na persistência
   =========================================================== */
describe('Fluxo de PDF · não trava no PATCH 400', () => {
  it('contratoGeneratePDF aceita id OU objeto em memória', () => {
    const gen = extractFn(appJs, 'async function contratoGeneratePDF(');
    assert.ok(gen, 'contratoGeneratePDF ausente');
    assert.ok(gen.includes("typeof idOuContrato === 'string'"), 'não detecta modo id (string)');
    assert.ok(gen.includes('contrato = idOuContrato'), 'não aceita objeto em memória');
  });

  it('update de status/gerado_em só roda para contrato persistido', () => {
    const gen = extractFn(appJs, 'async function contratoGeneratePDF(');
    assert.ok(gen.includes('if (contrato.id)'), 'update de status sem guarda de persistência');
    assert.ok(gen.includes('statusErr'), 'falha ao registrar status não é logada');
  });

  it('contratoGenerateFromModal gera o PDF mesmo se o save falhar', () => {
    const fromModal = extractFn(appJs, 'async function contratoGenerateFromModal(');
    assert.ok(fromModal, 'contratoGenerateFromModal ausente');
    assert.ok(fromModal.includes('collectContratoFormData()'), 'não captura formData antes do save');
    assert.ok(fromModal.includes('contratoGeneratePDF(saved || formData)'),
      'PDF bloqueado quando o save falha');
    assert.ok(!fromModal.includes('if (!saved) return;'), 'fluxo ainda bloqueia no falha do save');
  });
});

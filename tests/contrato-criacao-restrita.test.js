import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes estruturais: criação de contratos restrita a
   empresas com modelo configurado (hoje: Blue Eventos)
   -----------------------------------------------------------
   app.js não pode ser importado em Node (executa DOM no
   carregamento), então validamos a fiação de cada caminho
   de criação/edição e o markup do botão.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

/** Extrai o corpo de uma função top-level (contagem de chaves).
 *  O corpo começa no `) {` final dos parâmetros — evita parar em
 *  objetos usados como default (`({ ... } = {})`). */
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

describe('Contratos — botão de criação reagindo ao filtro de empresa', () => {
  it('o botão nasce desabilitado e tem o hint de motivo', () => {
    assert.match(indexHtml, /id="btnNovoContrato" disabled/);
    assert.match(indexHtml, /id="contratosAddHint"/);
  });

  it('possui a função que habilita/desabilita com o motivo', () => {
    const fn = extractFn(appJs, 'function _atualizaBotaoNovoContrato()');
    assert.ok(fn, 'função _atualizaBotaoNovoContrato ausente');
    assert.ok(fn.includes('motivoBloqueioCriacao'), 'não usa motivoBloqueioCriacao');
    assert.ok(fn.includes('btn.disabled = true'), 'não desabilita o botão');
    assert.ok(fn.includes('btn.disabled = false'), 'não habilita o botão');
    assert.ok(fn.includes('hint.textContent = motivo'), 'não exibe o motivo no hint');
  });

  it('é acionada na mudança do filtro, na limpeza e ao montar a lista', () => {
    const idx = appJs.indexOf("getElementById('filterContratoEmpresa')?.addEventListener('change'");
    assert.ok(idx > -1, 'sem listener de change no filtro');
    assert.ok(appJs.slice(idx, idx + 300).includes('_atualizaBotaoNovoContrato()'),
      'mudança de empresa não atualiza o botão de criação');
    assert.ok(appJs.includes('function populateContratoEmpresaFilter()'));
    const populate = extractFn(appJs, 'function populateContratoEmpresaFilter()');
    assert.ok(populate.includes('_atualizaBotaoNovoContrato()'), 'filtro não atualiza o botão');
    assert.ok(appJs.includes('await loadContratoModelos();'), 'modelos não são carregados no boot da aba');
  });
});

describe('Contratos — todo caminho de cadastro passa pelo bloqueio', () => {
  const caminhos = {
    saveContrato: 'async function saveContrato(',
    salvarContratoComoRascunho: 'async function salvarContratoComoRascunho(',
    openContratoPreview: 'async function openContratoPreview('
  };

  for (const [nome, header] of Object.entries(caminhos)) {
    it(`${nome}() verifica a empresa antes de gravar/gerar`, () => {
      const corpo = extractFn(appJs, header);
      assert.ok(corpo, `${nome}() não encontrada`);
      assert.ok(corpo.includes('_contratoBloqueioSalvar'), `${nome}() sem guarda de modelo`);
      assert.ok(corpo.includes("toast(bloqueio, 'error')"), `${nome}() não avisa o motivo`);
    });
  }

  it('as duas entradas de INSERT passam por funções guardadas', () => {
    const insert = extractFn(appJs, 'async function createContratoViaRPC(');
    assert.ok(insert);
    const save = extractFn(appJs, caminhos.saveContrato);
    const rascunho = extractFn(appJs, caminhos.salvarContratoComoRascunho);
    assert.ok(save.includes('createContratoViaRPC('));
    assert.ok(rascunho.includes('createContratoViaRPC('));
    assert.ok(save.indexOf('_contratoBloqueioSalvar') < save.indexOf('createContratoViaRPC('),
      'saveContrato grava antes de verificar');
    assert.ok(rascunho.indexOf('_contratoBloqueioSalvar') < rascunho.indexOf('createContratoViaRPC('),
      'salvarContratoComoRascunho grava antes de verificar');
  });

  it('_contratoBloqueioSalvar delega a regra ao helper puro podeSalvarContrato', () => {
    const corpo = extractFn(appJs, 'async function _contratoBloqueioSalvar(');
    assert.ok(corpo, '_contratoBloqueioSalvar ausente');
    assert.ok(corpo.includes('podeSalvarContrato('));
    assert.ok(corpo.includes('await loadContratoModelos()'));
    assert.ok(corpo.includes('isEdicao: !!existingId'));
  });
});

describe('Contratos — abertura do modal também é protegida', () => {
  it('openNovoContratoModal exige filtro e empresa com modelo', () => {
    const corpo = extractFn(appJs, 'async function openNovoContratoModal(');
    assert.ok(corpo, 'openNovoContratoModal não encontrada');
    assert.ok(corpo.includes('motivoBloqueioCriacao('), 'não valida o filtro');
    assert.ok(corpo.includes('idsEmpresaCriavel('), 'não valida empresa com modelo');
    assert.ok(corpo.indexOf('motivoBloqueioCriacao') < corpo.indexOf('_currentContratoData = null'),
      'validação acontece depois de abrir');
  });

  it('select do modal desabilita empresas sem modelo e só escolhe entre liberadas', () => {
    const corpo = extractFn(appJs, 'function populateContratoEmpresaSelect(');
    assert.ok(corpo, 'populateContratoEmpresaSelect não encontrada');
    assert.ok(corpo.includes('opt.disabled = true'), 'opções sem modelo continuam habilitadas');
    assert.ok(corpo.includes('criaveis.has(cc.id)'), 'não filtra por empresa criável');
    assert.ok(corpo.includes('opcoes: empresas.filter(cc => criaveis.has(cc.id))'),
      'default pode cair em empresa sem modelo');
  });

  it('edição preserva a empresa já salva (opção volta a ficar habilitada)', () => {
    const corpo = extractFn(appJs, 'function _garantirOpcaoEmpresaAtual(');
    assert.ok(corpo, '_garantirOpcaoEmpresaAtual não encontrada');
    assert.ok(corpo.includes('opt.disabled = false'), 'empresa salva fica travada');
  });

  it('lead só pode apontar o contrato para empresa com modelo', () => {
    const idx = appJs.indexOf('A empresa passa a seguir o lead');
    assert.ok(idx > -1, 'fluxo de lead não encontrado');
    const trecho = appJs.slice(idx, idx + 600);
    assert.ok(trecho.includes('idsEmpresaCriavel('), 'lead não valida modelo da empresa');
  });
});

describe('Contratos — fallback enquanto a tabela não existe', () => {
  it('loadContratoModelos sinaliza indisponibilidade da tabela', () => {
    const corpo = extractFn(appJs, 'async function loadContratoModelos(');
    assert.ok(corpo, 'loadContratoModelos não encontrada');
    assert.ok(corpo.includes('_contratoModelosIndisponivel = true'), 'erro não marca indisponível');
    assert.ok(corpo.includes('_contratoModelosIndisponivel = false'), 'sucesso não limpa a marca');
  });

  it('a flag inicial é "ainda não carregado" para não travar a Blue Eventos', () => {
    assert.match(appJs, /let _contratoModelosIndisponivel = true;/);
  });
});

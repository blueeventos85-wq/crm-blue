import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: busca de clientes/leads por telefone
   ===========================================================
   As funções compartilhadas são extraídas do próprio app.js
   para testar exatamente o código executado em produção.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');

function extrairFuncao(nome) {
  const inicio = appSource.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado em app.js`);
  return appSource.slice(inicio, fim + 2);
}

const src = ['normalizarTelefoneBusca', 'variantesTelefoneBusca', 'matchBuscaTexto']
  .map(extrairFuncao)
  .join('\n');
const matchBuscaTexto = new Function(`${src}; return matchBuscaTexto;`)();

const clienteA = {
  name: 'Alpha Eventos',
  email: 'contato@alpha.com',
  cnpj: '12.345.678/0001-90',
  telefone: '558594358894'
};
const clienteB = {
  name: 'Beta Producoes',
  email: 'beta@exemplo.com.br',
  cnpj: '98.765.432/0001-10',
  telefone: '5585994358894'
};

function busca(consulta, clientes) {
  return clientes.filter(c => matchBuscaTexto(consulta, {
    textos: [c.name, c.email, c.cnpj],
    telefones: [c.telefone]
  }));
}

describe('Cliente da Base · busca por telefone (558594358894)', () => {
  const termos = [
    ['8894', '4 últimos dígitos'],
    ['94358894', 'trecho do meio'],
    ['3588', 'trecho parcial de 4 dígitos'],
    ['943', 'trecho parcial de 3 dígitos'],
    ['8594358894', 'sem DDI 55'],
    ['558594358894', 'com DDI 55'],
    ['(85) 9435-8894', 'formatado com parênteses e hífen'],
    ['+55 85 9435-8894', 'colado com +55, espaços e hífen'],
    ['55 85 9435-8894', 'colado com 55 e espaços']
  ];

  for (const [termo, desc] of termos) {
    it(`deve encontrar o cliente ao buscar "${termo}" (${desc})`, () => {
      assert.ok(busca(termo, [clienteA]).includes(clienteA));
    });
  }
});

describe('Cliente da Base · busca por telefone (5585994358894)', () => {
  const termos = [
    ['8894', '4 últimos dígitos'],
    ['94358894', 'trecho do meio'],
    ['85994358894', 'sem DDI 55 (celular 9 dígitos)'],
    ['5585994358894', 'com DDI 55'],
    ['(85) 99435-8894', 'formatado com parênteses e hífen'],
    ['+55 85 99435-8894', 'colado com +55, espaços e hífen']
  ];

  for (const [termo, desc] of termos) {
    it(`deve encontrar o cliente ao buscar "${termo}" (${desc})`, () => {
      assert.ok(busca(termo, [clienteB]).includes(clienteB));
    });
  }

  it('85994358894 é outro número (85 99435-8894) e não pertence a 558594358894', () => {
    assert.equal(busca('85994358894', [clienteA]).includes(clienteA), false);
    assert.equal(busca('(85) 99435-8894', [clienteA]).includes(clienteA), false);
    assert.ok(busca('85994358894', [clienteB]).includes(clienteB));
  });
});

describe('busca por telefone · DDI 55 dos dois lados', () => {
  const casos = [
    ['558594358894', '8594358894', 'consulta com 55, salvo sem 55'],
    ['8594358894', '558594358894', 'consulta sem 55, salvo com 55'],
    ['+55 85 9435-8894', '(85) 9435-8894', 'consulta colada com +55, salvo formatado'],
    ['85 99435-8894', '5585994358894', 'consulta sem 55, salvo com 55 (celular)'],
    ['5585994358894', '85994358894', 'consulta com 55, salvo sem 55 (celular)']
  ];

  for (const [consulta, salvo, desc] of casos) {
    it(`deve encontrar "${salvo}" ao buscar "${consulta}" (${desc})`, () => {
      assert.equal(matchBuscaTexto(consulta, { textos: [], telefones: [salvo] }), true);
    });
  }
});

describe('busca · regras de mínimo de dígitos e OR com texto', () => {
  it('não deve buscar por telefone com menos de 3 dígitos', () => {
    assert.equal(matchBuscaTexto('88', { textos: [], telefones: ['558594358894'] }), false);
    assert.equal(matchBuscaTexto('8', { textos: [], telefones: ['558594358894'] }), false);
    assert.equal(matchBuscaTexto('55', { textos: [], telefones: ['558594358894'] }), false);
  });

  it('texto só com letras deve buscar apenas nome/e-mail (não telefone)', () => {
    assert.equal(matchBuscaTexto('ana', { textos: ['João Silva'], telefones: ['558594358894'] }), false);
    assert.equal(matchBuscaTexto('joão', { textos: ['João Silva'], telefones: ['558594358894'] }), true);
    assert.equal(matchBuscaTexto('silva', { textos: ['João Silva'], telefones: ['558594358894'] }), true);
  });

  it('deve combinar nome, e-mail e telefone em OR', () => {
    assert.equal(matchBuscaTexto('alpha', { textos: [clienteA.name, clienteA.email], telefones: [clienteA.telefone] }), true);
    assert.equal(matchBuscaTexto('alpha.com', { textos: [clienteA.name, clienteA.email], telefones: [clienteA.telefone] }), true);
    assert.equal(matchBuscaTexto('558594358894', { textos: [clienteA.name, clienteA.email], telefones: [clienteA.telefone] }), true);
    assert.equal(matchBuscaTexto('inexistente', { textos: [clienteA.name, clienteA.email], telefones: [clienteA.telefone] }), false);
  });

  it('consulta vazia deve retornar true (sem filtrar)', () => {
    assert.equal(matchBuscaTexto('', { textos: [clienteA.name], telefones: [clienteA.telefone] }), true);
    assert.equal(matchBuscaTexto('   ', { textos: [clienteA.name], telefones: [clienteA.telefone] }), true);
  });

  it('não deve encontrar telefone que não contém os dígitos buscados', () => {
    assert.equal(matchBuscaTexto('1111', { textos: [], telefones: ['558594358894'] }), false);
  });
});

describe('barras de busca do sistema usam a função compartilhada', () => {
  it('Cliente da Base busca nome, e-mail, cnpj e telefone', () => {
    assert.ok(appSource.includes('matchBuscaTexto(clienteSearchQuery'));
    assert.ok(appSource.includes('textos: [c.name, c.email, c.cnpj]'));
    assert.ok(appSource.includes('telefones: [c.telefone]'));
  });

  it('CRM busca empresa, e-mail, cnpj e telefone', () => {
    assert.ok(appSource.includes('matchBuscaTexto(leadSearchQuery'));
    assert.ok(appSource.includes('textos: [l.empresa, l.email, l.cnpj]'));
  });

  it('Conversas (lista e vínculo de lead) usa a função compartilhada', () => {
    assert.ok(appSource.includes('matchBuscaTexto(term,'));
  });

  it('autocompletar do calendário e seleção de lead dos contratos usam a função', () => {
    assert.ok(appSource.includes('matchBuscaTexto(q,'));
    assert.ok(appSource.includes('matchBuscaTexto(b,'));
    assert.ok(appSource.includes('matchBuscaTexto(filters.busca,'));
  });

  it('contador "X clientes encontrados" usa o tamanho da lista filtrada', () => {
    assert.ok(appSource.includes('${filtered.length} cliente'));
  });
});

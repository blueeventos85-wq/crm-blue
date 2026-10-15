import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildContratoBluePro, montaClausulaCusto } from '../src/lib/contrato/bluepro.js';
import { DEFAULT_CONTRATO_MODELO } from '../src/lib/contrato/modelo.js';

/* ===========================================================
   Fluxos de criação: Contrato 100% | 50% | Parcelado (2x–5x)
   + Cláusula 4ª dinâmica no template oficial Blue PRO.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

const semNbsp = (texto) => String(texto).replace(/\u00A0/g, ' ');

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

const CONTRATO_100 = {
  contratante_nome: 'Corpo Dourado Indústria de Cosméticos e Perfumaria LTDA',
  contratante_cpf_cnpj: '11.132.348/0001-59',
  descricao_servicos: '2 (duas) promotoras para Ação Promocional',
  data_evento: '2026-10-18',
  hora_inicio: '16:00',
  hora_fim: '19:00',
  endereco_evento: 'Av. Washington Soares, 999 - Edson Queiroz, Fortaleza - CE, 60811-341',
  valor_total: 450,
  quantidade_parcelas: 1,
  parcelas: [{ parcela: 1, valor: 450, vencimento: '2026-10-16' }],
  tipo_contrato: '100%',
  data_emissao: '2026-10-13'
};

const CONTRATO_50 = {
  ...CONTRATO_100,
  quantidade_parcelas: 2,
  parcelas: [
    { parcela: 1, valor: 225, vencimento: '2026-10-16' },
    { parcela: 2, valor: 225, vencimento: '2026-10-17' }
  ],
  tipo_contrato: '50%'
};

const CONTRATO_3X = {
  ...CONTRATO_100,
  quantidade_parcelas: 3,
  parcelas: [
    { parcela: 1, valor: 150, vencimento: '2026-10-10' },
    { parcela: 2, valor: 150, vencimento: '2026-10-14' },
    { parcela: 3, valor: 150, vencimento: '2026-10-17' }
  ],
  tipo_contrato: '3x'
};

describe('Menu "+ Adicionar contrato"', () => {
  it('oferece 100%, 50%, parcelado 2x–5x e a proposta desabilitada', () => {
    assert.match(indexHtml, /id="btnNovoContrato" disabled/);
    assert.match(indexHtml, /id="contratosAddDropdown"/);
    assert.match(indexHtml, /data-tipo="100"[^>]*>[\s\S]*?Contrato 100%/);
    assert.match(indexHtml, /data-tipo="50"[^>]*>[\s\S]*?Contrato 50%/);
    assert.match(indexHtml, /data-tipo="parcelado"[^>]*>[\s\S]*?Contrato Parcelado/);
    for (const n of [2, 3, 4, 5]) {
      assert.match(indexHtml, new RegExp(`data-tipo="${n}"[^>]*>Parcelado ${n}x`),
        `sem a opção Parcelado ${n}x`);
    }
    assert.match(indexHtml, /data-tipo="proposta"[^>]*disabled[^>]*>[\s\S]*?Proposta para o cliente[\s\S]*?Em breve/);
  });

  it('abre o modal com o tipo escolhido (submenu 2x–5x incluído)', () => {
    const corpo = extractFn(appJs, 'function _alternaMenuNovoContrato()');
    assert.ok(corpo, '_alternaMenuNovoContrato ausente');
    assert.ok(corpo.includes('contratosAddDropdown'), 'não manipula o dropdown');

    assert.ok(appJs.includes("querySelectorAll('.contratos-add-option[data-tipo]')"),
      'sem handler das opções do menu');
    const idx = appJs.indexOf("querySelectorAll('.contratos-add-option[data-tipo]')");
    const trecho = appJs.slice(idx, idx + 500);
    assert.ok(trecho.includes("tipo === 'parcelado'"), 'não trata o toggle do parcelado');
    assert.ok(trecho.includes('_alternaSubmenuParcelado()'), 'não abre o submenu 2x–5x');
    assert.ok(trecho.includes('openNovoContratoModal({ tipo: fluxo })'),
      'opção do menu não abre o modal com o tipo');
  });

  it('abre o modal no fluxo escolhido e no título correspondente', () => {
    const corpo = extractFn(appJs, 'async function openNovoContratoModal(');
    assert.ok(corpo, 'openNovoContratoModal ausente');
    assert.ok(corpo.includes('_aplicaFluxoContrato'), 'não aplica o fluxo escolhido');
    assert.ok(corpo.includes('opts?.tipo'), 'ignora o tipo recebido');
    assert.ok(corpo.includes('_tituloFluxoContrato()'), 'não usa o título do fluxo');

    const titulo = extractFn(appJs, 'function _tituloFluxoContrato()');
    assert.ok(titulo, '_tituloFluxoContrato ausente');
    assert.ok(titulo.includes("Gerar Contrato 50% (2x)"), 'título do fluxo 50% ausente');
    assert.ok(titulo.includes('Gerar Contrato Parcelado'), 'título do parcelado ausente');
    assert.ok(titulo.includes("Gerar Contrato'"), 'título do 100% ausente');
  });
});

describe('Modal — condições de pagamento e parcelas dinâmicas', () => {
  it('seletor cobre 100%, 50/50 e parcelado 2x–5x', () => {
    const sel = indexHtml.match(/<select id="contratoCondicaoPagamento">[\s\S]*?<\/select>/);
    assert.ok(sel, 'seletor de condição ausente');
    assert.match(sel[0], /<option value="1">/);
    assert.match(sel[0], /<option value="50">/);
    for (const n of [2, 3, 4, 5]) {
      assert.match(sel[0], new RegExp(`<option value="${n}">`), `sem a condição parcelada ${n}x`);
    }
    for (const n of [3, 4, 5]) {
      assert.ok(indexHtml.includes(`id="rowParcelaVal${n}"`), `sem a linha de valor da parcela ${n}`);
      assert.ok(indexHtml.includes(`id="rowParcelaVenc${n}"`), `sem a linha de vencimento da parcela ${n}`);
      assert.ok(indexHtml.includes(`id="contratoValorP${n}"`), `sem o campo de valor da parcela ${n}`);
      assert.ok(indexHtml.includes(`id="contratoVencimentoP${n}"`), `sem o campo de data da parcela ${n}`);
    }
  });

  it('converte a condição no número de parcelas (1 | 2 | até 5)', () => {
    const corpo = extractFn(appJs, 'function _parcelasDaCondicao(');
    assert.ok(corpo, '_parcelasDaCondicao ausente');
    assert.ok(corpo.includes("v === '50'"), '50/50 não vira 2 parcelas');
    assert.ok(corpo.includes('Math.min'), 'não limita o parcelamento em 5');
  });

  it('divide o valor total em N parcelas iguais', () => {
    const corpo = extractFn(appJs, 'function _aplicaSplitParcelas()');
    assert.ok(corpo, '_aplicaSplitParcelas ausente');
    assert.ok(corpo.includes('Math.round(total / n'), 'não calcula a parcela unitária');
    assert.ok(corpo.includes("'contratoValorP' + i"), 'não preenche as parcelas em loop');
    assert.ok(corpo.includes("'contratoValorP' + n"), 'não fecha a última parcela com o resto');
  });

  it('recalcula as parcelas ao digitar o valor total', () => {
    const idx = appJs.indexOf("getElementById('contratoValorTotal')?.addEventListener('input'");
    assert.ok(idx > -1, 'sem listener de input no valor total');
    assert.ok(appJs.slice(idx, idx + 300).includes('_aplicaSplitParcelas()'),
      'valor total não dispara o rateio');
  });

  it('ajusta labels e linhas das parcelas conforme a condição', () => {
    const corpo = extractFn(appJs, 'function _sincronizaParcelasUI(');
    assert.ok(corpo, '_sincronizaParcelasUI ausente');
    assert.ok(corpo.includes('Data da'), 'label do 50% ausente');
    assert.ok(corpo.includes('Vencimento'), 'label do parcelado ausente');
    assert.ok(corpo.includes("rowParcelaVal' + i"), 'não mostra/esconde as linhas em loop');
    assert.ok(corpo.includes('i <= 5'), 'não considera até a 5ª parcela');
  });

  it('exige datas e valores de cada parcela na validação', () => {
    const corpo = extractFn(appJs, 'function validateContratoForm()');
    assert.ok(corpo, 'validateContratoForm ausente');
    assert.ok(corpo.includes("id: 'contratoValorP' + i"), 'não valida o valor da parcela i');
    assert.ok(corpo.includes("id: 'contratoVencimentoP' + i"), 'não valida a data da parcela i');
  });

  it('collect grava todas as parcelas escolhidas', () => {
    const corpo = extractFn(appJs, 'function collectContratoFormData()');
    assert.ok(corpo, 'collectContratoFormData ausente');
    assert.ok(corpo.includes('_parcelasDaCondicao(condicao)'), 'não deriva a quantidade de parcelas');
    assert.ok(corpo.includes("for (let i = 1; i <= qtdParcelas; i++)"), 'não monta as parcelas em loop');
    assert.ok(corpo.includes('quantidade_parcelas: qtdParcelas'), 'não salva a quantidade real de parcelas');
  });
});

describe('Cláusula 4ª do Contrato 50% (Blue PRO)', () => {
  it('usa o texto oficial 50% (entrada + véspera)', () => {
    const texto = semNbsp(montaClausulaCusto(CONTRATO_50));
    assert.ok(texto.includes('custo total de R$ 450,00 (quatrocentos e cinquenta reais)'), 'sem o total com extenso');
    assert.ok(texto.includes('em 2 parcelas: a 1ª parcela em 16/10/2026 no valor de R$ 225,00'), 'sem a 1ª parcela');
    assert.ok(texto.includes('e a 2ª parcela em 17/10/2026 (véspera da ação) no valor de R$ 225,00'), 'sem a 2ª parcela (véspera)');
    assert.ok(texto.includes('conforme Cláusula 3ª.'), 'sem o fecho da cláusula 3ª');
    assert.ok(!texto.includes('no dia 16/10/2026, conforme as condições'), 'mantém o texto de pagamento único');
  });

  it('calcula 50%/50% quando as parcelas não vêm preenchidas', () => {
    const texto = semNbsp(montaClausulaCusto({ ...CONTRATO_50, parcelas: [] }));
    assert.ok(texto.includes('R$ 225,00'), 'não divide o total pela metade');
    assert.equal((texto.match(/R\$ 225,00/g) || []).length, 2, 'as duas parcelas devem ser a metade');
  });

  it('contrato 100% mantém o pagamento único', () => {
    const texto = semNbsp(montaClausulaCusto(CONTRATO_100));
    assert.ok(texto.includes('no dia 16/10/2026'), 'perde a data única de pagamento');
    assert.ok(texto.includes('conforme as condições estabelecidas na Cláusula 3ª deste contrato'), 'perde o texto padrão');
    assert.ok(!texto.includes('em 2 parcelas'), 'não deve parcelar o contrato 100%');
  });

  it('o contrato completo Blue PRO renderiza a cláusula e o PIX', () => {
    const html = buildContratoBluePro({
      data: CONTRATO_50,
      doc: DEFAULT_CONTRATO_MODELO,
      header: '[CAB]',
      marcaCss: '',
      footer: () => ''
    });
    const texto = semNbsp(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    assert.ok(texto.includes('em 2 parcelas'), 'sem a cláusula parcelada');
    assert.ok(texto.includes('CHAVE PIX: 59.417.603/0001-36'), 'sem os dados de pagamento');
    assert.ok(texto.includes('Banco: Cora'), 'sem o banco');
    assert.ok(!texto.includes('aluguel'), 'template com cláusula de locação');
  });
});

describe('Cláusula 4ª do Contrato Parcelado (Blue PRO)', () => {
  it('lista o cronograma de N parcelas (3x)', () => {
    const texto = semNbsp(montaClausulaCusto(CONTRATO_3X));
    assert.ok(texto.includes('em 3 parcelas, conforme cronograma abaixo'), 'sem a abertura do cronograma');
    assert.ok(texto.includes('- 1ª parcela: R$ 150,00 (cem e cinquenta reais) com vencimento em 10/10/2026;'), 'sem a parcela 1');
    assert.ok(texto.includes('- 2ª parcela: R$ 150,00 (cem e cinquenta reais) com vencimento em 14/10/2026;'), 'sem a parcela 2');
    assert.ok(texto.includes('- 3ª parcela: R$ 150,00 (cem e cinquenta reais) com vencimento em 17/10/2026;'), 'sem a parcela 3');
    assert.ok(!texto.includes('véspera da ação'), 'parcelado não usa o texto do 50%');
    assert.ok(texto.includes('- 4ª parcela:') === false, 'não deve listar parcela inexistente');
  });

  it('rateia 5x quando as parcelas não vêm preenchidas', () => {
    const texto = semNbsp(montaClausulaCusto({
      ...CONTRATO_100,
      valor_total: 1000,
      quantidade_parcelas: 5,
      parcelas: [],
      tipo_contrato: '5x'
    }));
    assert.ok(texto.includes('em 5 parcelas'), 'sem as 5 parcelas');
    assert.equal((texto.match(/com vencimento em/g) || []).length, 5, 'cronograma deve ter 5 vencimentos');
    assert.equal((texto.match(/R\$ 200,00/g) || []).length, 5, 'deve ratear 5x de R$ 200,00');
  });

  it('renderiza o cronograma com quebras de linha no HTML', () => {
    const html = buildContratoBluePro({
      data: CONTRATO_3X,
      doc: DEFAULT_CONTRATO_MODELO,
      header: '[CAB]',
      marcaCss: '',
      footer: () => ''
    });
    assert.ok(html.includes('conforme cronograma abaixo:<br>'), 'cronograma sem quebras de linha');
    assert.ok(html.includes('- 3ª parcela:'), 'sem a última linha do cronograma');
  });
});

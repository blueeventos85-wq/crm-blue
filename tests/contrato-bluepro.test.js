import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildContratoBluePro,
  ehEmpresaBluePro,
  montaDescricaoServico,
  montaValorServico,
  montaDataPagamento,
  montaDataVigencia
} from '../src/lib/contrato/bluepro.js';
import { DEFAULT_CONTRATO_MODELO } from '../src/lib/contrato/modelo.js';

/* Dados de exemplo vindos do formulário (Corpo Dourado) */
const CONTRATO_EXEMPLO = {
  contratante_nome: 'Corpo Dourado Indústria de Cosméticos e Perfumaria LTDA',
  contratante_cpf_cnpj: '11.132.348/0001-59',
  contratante_endereco: 'AV ALINE DE CASTRO ALVES, S/N',
  contratante_bairro: 'VILA CAMPESTRE-TAPUIO',
  contratante_cidade: 'Aquiraz',
  contratante_estado: 'CE',
  contratante_cep: '61.700-000',
  descricao_servicos: '2 (duas) promotoras para Ação Promocional',
  data_evento: '2026-10-18',
  hora_inicio: '16:00',
  hora_fim: '19:00',
  endereco_evento: 'Av. Washington Soares, 999 - Edson Queiroz, Fortaleza - CE, 60811-341',
  valor_total: 450,
  quantidade_parcelas: 1,
  parcelas: [{ parcela: 1, valor: 450, vencimento: '2026-10-16' }],
  data_emissao: '2026-10-13'
};

/* toLocaleString('pt-BR') usa espaço inquebrável depois de "R$" */
const semNbsp = (texto) => String(texto).replace(/\u00A0/g, ' ');

function gerarHtml(data = CONTRATO_EXEMPLO, doc = DEFAULT_CONTRATO_MODELO) {
  return buildContratoBluePro({
    data,
    doc,
    header: '<header class="contrato-cabecalho">Agência Blue PRO</header>',
    marcaCss: '',
    footer: (n) => `<div class="contrato-rodape">${n} / 4</div>`
  });
}

describe('ehEmpresaBluePro()', () => {
  it('reconhece a empresa pelo nome (caixa e espaços ignorados)', () => {
    assert.equal(ehEmpresaBluePro('Blue PRO'), true);
    assert.equal(ehEmpresaBluePro('  blue pro '), true);
    assert.equal(ehEmpresaBluePro('Agência Blue PRO'), true);
  });

  it('outras empresas não ativam o template', () => {
    assert.equal(ehEmpresaBluePro('Blue Eventos'), false);
    assert.equal(ehEmpresaBluePro('Blue Digital'), false);
    assert.equal(ehEmpresaBluePro(''), false);
    assert.equal(ehEmpresaBluePro(null), false);
  });
});

describe('Campos dinâmicos do contrato Blue PRO', () => {
  it('descrição montada igual ao payload do formulário', () => {
    assert.equal(
      montaDescricaoServico(CONTRATO_EXEMPLO),
      '– Contratação de 2 (duas) promotoras para Ação Promocional a ser realizada no dia: 18/10/2026 das 16:00 horas às 19:00 horas. No endereço: Av. Washington Soares, 999 - Edson Queiroz, Fortaleza - CE, 60811-341.'
    );
  });

  it('valor com extenso', () => {
    assert.equal(semNbsp(montaValorServico(CONTRATO_EXEMPLO)), 'R$ 450,00 (quatrocentos e cinquenta reais)');
  });

  it('pagamento = vencimento da 1ª parcela e vigência = data de emissão', () => {
    assert.equal(montaDataPagamento(CONTRATO_EXEMPLO), '16/10/2026');
    assert.equal(montaDataVigencia(CONTRATO_EXEMPLO), '13/10/2026');
  });
});

describe('buildContratoBluePro() — template oficial preenchido', () => {
  const html = semNbsp(gerarHtml());

  it('monta as 4 páginas do documento', () => {
    assert.ok(html.includes('contrato-documento'));
    const paginas = html.match(/class="contrato-pagina(?=[ "])/g) || [];
    assert.equal(paginas.length, 4);
    assert.ok(html.includes('contrato-page-break'));
  });

  it('preenche o CONTRATANTE com os dados do formulário', () => {
    assert.ok(html.includes('Corpo Dourado Indústria de Cosméticos e Perfumaria LTDA'));
    assert.ok(html.includes('inscrito no CNPJ: 11.132.348/0001-59'));
    assert.ok(html.includes('com endereço na AV ALINE DE CASTRO ALVES, S/N'));
    assert.ok(html.includes('- Bairro: VILA CAMPESTRE-TAPUIO'));
    assert.ok(html.includes('- Aquiraz/CE'));
    assert.ok(html.includes('- CEP: 61.700-000.'));
  });

  it('mantém a CONTRATADA com os dados legais do modelo', () => {
    assert.ok(html.includes('Agência Blue Organização de Eventos e Inteligência Empresarial Ltda.'));
    assert.ok(html.includes('CNPJ: 59.417.603/0001-36'));
    assert.ok(html.includes('com sede em Av. Eng. Humberto Monte, 2929, Pici, Fortaleza/CE'));
    assert.ok(html.includes('CEP: 60.440-593'));
  });

  it('injeta a descrição, o valor, o pagamento e a vigência', () => {
    assert.ok(html.includes(montaDescricaoServico(CONTRATO_EXEMPLO)));
    assert.ok(html.includes('R$ 450,00 (quatrocentos e cinquenta reais)'));
    assert.ok(html.includes('no dia 16/10/2026'));
    assert.ok(html.includes('vigora a partir do dia 13/10/2026'));
    assert.ok(html.includes('Fortaleza - CE, 13/10/2026.'));
  });

  it('mantém os dados bancários do Banco Cora', () => {
    assert.ok(html.includes('CHAVE PIX: 59.417.603/0001-36'));
    assert.ok(html.includes('Titular: Agência Blue Organização de Eventos e Inteligência Empresarial Ltda'));
    assert.ok(html.includes('Banco: Cora'));
  });

  it('mantém ética com promotores, não aliciamento e multa de 30%', () => {
    assert.ok(html.includes('>3.5</span> Não aliciar:'));
    assert.ok(html.includes('>3.6</span> Não prometer vantagens:'));
    assert.ok(html.includes('>3.7</span> Não pegar contatos dos promotores:'));
    assert.ok(html.includes('>3.8</span> Manter contato somente com a CONTRATADA:'));
    assert.ok(html.includes('>3.9</span> Receber fotos e relatórios finais somente da CONTRATADA:'));
    assert.ok(html.includes('multa de 30% do valor total do contrato'));
    assert.ok(html.includes('foro da comarca de Fortaleza - CE.'));
  });

  it('Cláusula 3ª segue o modelo Blue PRO (pagamento, responsável, materiais, energia, ética)', () => {
    assert.ok(html.includes('inclusão aos órgãos de proteção ao crédito'));
    assert.ok(html.includes('Designar um responsável, através de pessoa especialmente credenciada'));
    assert.ok(html.includes('brindes de divulgação e apoio para a ação'));
    assert.ok(html.includes('Responsabilizar-se por ponto de energia'));
    assert.ok(html.includes('Blitz Promocional'));
  });

  it('página 2 usa subcláusulas 3.1 a 3.9 em sequência, sem marcadores de lista', () => {
    const pagina2 = html.split('class="contrato-pagina contrato-page-break"')[1] || '';
    assert.ok(pagina2, 'página 2 ausente');
    assert.doesNotMatch(pagina2, /[●•○▪◦]/, 'página 2 ainda contém bullets');
    const numeros = [...pagina2.matchAll(/contrato-subclausula-num">([^<]+)</g)].map(m => m[1]);
    assert.deepEqual(
      numeros,
      ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9']
    );
    const paragrafos = pagina2.match(/<p class="contrato-subclausula">/g) || [];
    assert.equal(paragrafos.length, 9);
  });

  it('não herda cláusulas de locação/festa da Blue Eventos', () => {
    const proibidos = ['aluguel', 'convidados', 'reserva de data', 'juros de mora', 'reserva de', 'danos causados', '30 (trinta) dias'];
    for (const marcador of proibidos) {
      assert.doesNotMatch(html, new RegExp(marcador, 'i'), `conteúdo Blue PRO contém "${marcador}"`);
    }
  });

  it('não contém a linha removida "Pegar contato dos promotores para contratação por fora"', () => {
    assert.doesNotMatch(html, /Pegar contato dos promotores para contrata[çc][ãa]o por fora/);
  });

  it('traz todas as cláusulas 1ª a 9ª', () => {
    for (const n of ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª', '7ª', '8ª', '9ª']) {
      assert.ok(html.includes(`Cláusula ${n}.`), `falta a Cláusula ${n}`);
    }
  });

  it('escapa valores do formulário (nenhum HTML injetado)', () => {
    const htmlInjetado = gerarHtml({
      ...CONTRATO_EXEMPLO,
      contratante_nome: '<script>alert(1)</script>'
    });
    assert.ok(!htmlInjetado.includes('<script>'));
    assert.ok(htmlInjetado.includes('&lt;script&gt;'));
  });
});

/* ===========================================================
   Fiação do app.js: derivação para o template Blue PRO e
   regeneração de conteúdo salvo obsoleto.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const stylesCss = readFileSync(join(root, 'styles.css'), 'utf8');

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

describe('app.js — derivação para o template Blue PRO', () => {
  it('buildPDFContent escolhe o builder Blue PRO pela empresa', () => {
    const corpo = extractFn(appJs, 'function buildPDFContent(');
    assert.ok(corpo, 'buildPDFContent ausente');
    assert.ok(corpo.includes('ehEmpresaBluePro('), 'não valida a empresa');
    assert.ok(corpo.includes('buildContratoBluePro('), 'não usa o builder Blue PRO');
    assert.ok(corpo.indexOf('ehEmpresaBluePro') < corpo.indexOf('const qtdParcelas'),
      'derivação acontece depois das cláusulas de locação');
  });

  it('resolveNomeEmpresaContrato é resiliente (lead + busca pontual no banco)', () => {
    const corpo = extractFn(appJs, 'async function resolveNomeEmpresaContrato(');
    assert.ok(corpo, 'resolveNomeEmpresaContrato ausente');
    assert.ok(corpo.includes("from('centros_custo')"), 'não busca o nome quando o cache falha');
    assert.ok(corpo.includes('_contratosLeadsList'), 'não usa a empresa do lead como fallback');
  });

  it('todos os caminhos resolvem a empresa antes de gerar o HTML', () => {
    const caminhos = [
      'async function saveContrato(',
      'async function openContratoPreview(',
      'async function contratoGeneratePDF(',
      'async function _ccModeloPreview('
    ];
    for (const header of caminhos) {
      const corpo = extractFn(appJs, header);
      assert.ok(corpo, `${header} ausente`);
      assert.ok(corpo.includes('resolveNomeEmpresaContrato('), `${header} não resolve a empresa`);
      assert.ok(corpo.includes('empresaNome'), `${header} não repassa o nome resolvido`);
    }
  });

  it('contratoGeneratePDF regenera conteúdo salvo de outro template', () => {
    const corpo = extractFn(appJs, 'async function contratoGeneratePDF(');
    assert.ok(corpo, 'contratoGeneratePDF ausente');
    assert.ok(corpo.includes('_CONTRATO_MARCADORES_EVENTOS'), 'não detecta conteúdo obsoleto');
    assert.ok(corpo.includes('buildPDFContent(contrato, modeloPdf'), 'não regenera o conteúdo');
  });
});

describe('styles.css — recuo das subcláusulas numeradas', () => {
  it('número na margem com recuo pendente e texto justificado', () => {
    assert.ok(stylesCss.includes('.contrato-subclausulas'), 'regra do container ausente');
    assert.ok(stylesCss.includes('.contrato-subclausula'), 'regra do item ausente');
    assert.ok(stylesCss.includes('.contrato-subclausula-num'), 'regra do número ausente');
    assert.match(stylesCss, /\.contrato-subclausula\s*\{[^}]*text-indent:\s*-10mm/, 'sem recuo pendente');
    assert.match(stylesCss, /\.contrato-subclausula\s*\{[^}]*text-align:\s*justify/, 'item não justificado');
    assert.match(stylesCss, /\.contrato-subclausula-num\s*\{[^}]*text-indent:\s*0/, 'número herdando o recuo');
  });
});

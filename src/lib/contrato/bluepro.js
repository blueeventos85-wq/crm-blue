/* ============================================
   TEMPLATE DE CONTRATO — BLUE PRO
   Conteúdo textual ESTRITO ao modelo oficial
   Blue PRO (sem cláusulas de locação/festa da
   Blue Eventos: "aluguel", "convidados",
   "reserva de data", juros etc.).
   Puro (sem DOM, sem banco): usado por
   app.js (buildPDFContent) e por
   tests/contrato-bluepro.test.js.
   ============================================ */

import { fmtDateBR, fmtTimeBR, fmtCurrency, numeroExtenso } from './formato.js';

export const NOME_EMPRESA_BLUE_PRO = 'blue pro';

/* Nome do centro de custo que ativa este template. */
export function ehEmpresaBluePro(nome) {
  const normalizado = String(nome ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return normalizado.includes(NOME_EMPRESA_BLUE_PRO);
}

function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _v(valor, padrao = '—') {
  const texto = (valor === null || valor === undefined) ? '' : String(valor).trim();
  return texto || padrao;
}

/* "R$ 450,00 (quatrocentos e cinquenta reais)" */
function _valorExtenso(valor) {
  return `${fmtCurrency(valor)} (${numeroExtenso(valor)})`;
}

/* DESCRIÇÃO DO(S) SERVIÇO(S) montada a partir dos campos do modal. */
export function montaDescricaoServico(data = {}) {
  const servico = _v(data.descricao_servicos);
  const dataEvento = fmtDateBR(data.data_evento);
  const horaInicio = fmtTimeBR(data.hora_inicio);
  const horaFim = fmtTimeBR(data.hora_fim);
  const local = _v(data.endereco_evento);
  return `– Contratação de ${servico} a ser realizada no dia: ${dataEvento} das ${horaInicio} horas às ${horaFim} horas. No endereço: ${local}.`;
}

/* "R$ 450,00 (quatrocentos e cinquenta reais)" */
export function montaValorServico(data = {}) {
  return _valorExtenso(data.valor_total);
}

/* Dia do pagamento = vencimento da 1ª parcela. */
export function montaDataPagamento(data = {}) {
  const vencimento = data.parcelas && data.parcelas[0] ? data.parcelas[0].vencimento : '';
  return fmtDateBR(vencimento);
}

/* ---- Cláusula 4ª: custo e forma de pagamento ----
   100%: pagamento integral em cota única.
   50%: 2 parcelas (entrada + véspera da ação).
   Parcelado: Nx com cronograma de vencimentos. */
function _parcelasDoContrato(data = {}) {
  const total = Number(data.valor_total) || 0;
  const qtd = Math.max(parseInt(data.quantidade_parcelas) || 1, 1);
  const lista = Array.isArray(data.parcelas) ? data.parcelas : [];
  const base = Math.round(total / qtd * 100) / 100;
  const valores = [];
  let soma = 0;
  for (let i = 0; i < qtd; i++) {
    const bruto = lista[i] && lista[i].valor !== undefined && lista[i].valor !== null && lista[i].valor !== ''
      ? Number(lista[i].valor)
      : base;
    valores.push(bruto);
    soma += bruto;
  }
  const dif = Math.round((total - soma) * 100) / 100;
  if (dif !== 0) valores[qtd - 1] = Math.round((valores[qtd - 1] + dif) * 100) / 100;
  return valores.map((valor, i) => ({
    valor: _valorExtenso(valor),
    data: _v(fmtDateBR(lista[i] && lista[i].vencimento), '—')
  }));
}

export function montaClausulaCusto(data = {}) {
  const qtdParcelas = Math.max(parseInt(data.quantidade_parcelas) || 1, 1);
  const total = _valorExtenso(data.valor_total);

  if (qtdParcelas <= 1) {
    return `Cláusula 4ª. O desenvolvimento completo do projeto por parte da CONTRATADA possui custo total de ${total}, a ser pago pela CONTRATANTE à CONTRATADA no dia ${_v(montaDataPagamento(data), '—')}, conforme as condições estabelecidas na Cláusula 3ª deste contrato.`;
  }

  const parcelas = _parcelasDoContrato(data);

  if (data.tipo_contrato === '50%') {
    return `Cláusula 4ª. O desenvolvimento completo do projeto por parte da CONTRATADA possui custo total de ${total}, a ser pago pela CONTRATANTE à CONTRATADA em 2 parcelas: a 1ª parcela em ${parcelas[0].data} no valor de ${parcelas[0].valor}, e a 2ª parcela em ${parcelas[1].data} (véspera da ação) no valor de ${parcelas[1].valor}, conforme Cláusula 3ª.`;
  }

  const cronograma = parcelas
    .map((p, i) => `- ${i + 1}ª parcela: ${p.valor} com vencimento em ${p.data};`)
    .join('\n');
  return `Cláusula 4ª. O desenvolvimento completo do projeto por parte da CONTRATADA possui custo total de ${total}, a ser pago pela CONTRATANTE à CONTRATADA em ${qtdParcelas} parcelas, conforme cronograma abaixo:\n${cronograma}`;
}

/* Vigência e assinatura = data de assinatura/emissão do contrato. */
export function montaDataVigencia(data = {}) {
  return fmtDateBR(data.data_emissao || '');
}

function _pagina({ numero, conteudo, header, marcaCss, footer }) {
  const cls = numero > 1 ? 'contrato-pagina contrato-page-break' : 'contrato-pagina';
  return `
  <div class="${cls}">
    <div class="contrato-marca-dagua" aria-hidden="true"${marcaCss}></div>
    <div class="contrato-pagina__conteudo">
      ${header}
      ${conteudo}
    </div>
    ${footer(numero)}
  </div>`;
}

/* ---- Cláusula 2ª: direitos e deveres da CONTRATADA (5 itens) ---- */
const OBRIGACOES_CONTRATADA = [
  '1. Utilizar das técnicas disponíveis para a realização das atividades aliadas à consultoria e/ou prestação de serviços, empregando seus melhores esforços na consecução da mesma.',
  '2. Se aplicada em contrato, disponibilizar uma equipe tecnicamente capacitada para a realização do serviço, no âmbito da matéria da consultoria e/ou prestação de serviços devida e/ou nomear um coordenador desta equipe, responsável pela administração das atividades.',
  '3. Fornecer equipamentos, dependências e serviços que se fizerem necessários para a execução da consultoria e/ou prestação de serviços, mediante remuneração.',
  '4. A CONTRATADA não se responsabiliza por problemas de terceiros que impactam na desistência da ação pela CONTRATANTE, assim como problemas climáticos acontecidos diferente da previsão do tempo acordada.',
  '5. A contratada não se responsabiliza pelo teor do conteúdo da ação promocional da contratante e nem possui algum vínculo com a promoção, desconto ou oferta oferecida. Sendo de total responsabilidade por parte da contratante para com o público.'
];

/* ---- Cláusula 3ª: direitos e deveres da CONTRATANTE ----
   Sem qualquer menção a convidados, danos a equipamentos,
   reserva de data ou regras de festa/locação. */
const OBRIGACOES_CONTRATANTE = [
  '● Pagamento: Realizar o pagamento conforme disposto na cláusula 4ª deste contrato, caso não haja pagamento será realizada inclusão aos órgãos de proteção ao crédito.',
  '● Responsável: Designar um responsável, através de pessoa especialmente credenciada, para atendimento a dúvidas e para as reuniões referentes a este contrato, se necessário for.',
  '● Materiais e deslocamento: Caso a contratante não solicite os serviços de Coordenação oferecidos pela contratada, a mesma deverá se responsabilizar por equipamentos, acessórios, distribuição de material ou brindes de divulgação e apoio para a ação, assim como deslocamento do pessoal quando for necessário.',
  '● Ponto de energia: Responsabilizar-se por ponto de energia caso seja contratado o serviço de Blitz Promocional.',
  '● Não aliciar: Não fazer qualquer tipo de abordagem ou tentativa de persuasão para recrutar ou desviar promotores contratados por terceiros.',
  '● Não prometer vantagens: Abster-se de fazer promessas ou oferecer benefícios indevidos aos promotores contratados com o intuito de influenciar seu desempenho ou fidelidade à CONTRATADA.',
  '● Não pegar contatos dos promotores: É vedado obter, de forma não autorizada, os dados de contato pessoal ou profissional dos promotores contratados, como telefone, e-mail ou endereço.',
  '● Manter contato somente com a CONTRATADA: Estabelecer comunicação exclusivamente com a empresa contratante, a CONTRATADA, evitando qualquer tipo de interação direta com os promotores contratados fora do âmbito profissional estabelecido.',
  '● Receber fotos e relatórios finais somente da CONTRATADA: Receber e analisar apenas fotos e relatórios finais, provenientes dos promotores contratados, conforme as orientações e procedimentos estabelecidos.'
];

const _lista = (itens) => `
      <div class="contrato-clausula contrato-lista-container">
        ${itens.map(t => `<p>${esc(t)}</p>`).join('\n        ')}
      </div>`;

/* Monta o contrato Blue PRO completo (4 páginas A4). */
export function buildContratoBluePro({
  data = {},
  doc = {},
  header = '',
  marcaCss = '',
  footer = () => ''
} = {}) {
  const titulo = _v(doc.titulo, 'Contrato de Prestação de Serviços');
  const descricao = montaDescricaoServico(data);
  const clausulaCusto = montaClausulaCusto(data);
  const dataVigencia = montaDataVigencia(data);

  const contratante = `${_v(data.contratante_nome)}, inscrito no CNPJ: ${_v(data.contratante_cpf_cnpj)} com endereço na ${_v(data.contratante_endereco)} - Bairro: ${_v(data.contratante_bairro)} - ${_v(data.contratante_cidade)}/${_v(data.contratante_estado)} - CEP: ${_v(data.contratante_cep)}`;

  const contratada = `${_v(doc.contratada_razao_social)}, CNPJ: ${_v(doc.contratada_cnpj)}, com sede em ${_v(doc.contratada_endereco)} - CEP: ${_v(doc.contratada_cep)}`;

  const paginas = [];

  /* ---- Página 1: identificação, objeto e obrigações da CONTRATADA ---- */
  paginas.push(_pagina({
    numero: 1, header, marcaCss, footer,
    conteudo: `
      <h1 class="contrato-titulo">${esc(titulo)}</h1>

      <p class="contrato-clausula contrato-justificado">
        <strong>CONTRATANTE:</strong> ${esc(contratante)}.
      </p>

      <p class="contrato-clausula contrato-justificado">
        <strong>CONTRATADA:</strong> ${esc(contratada)}.
      </p>

      <p class="contrato-clausula contrato-justificado">
        As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Prestação de Serviços em Ação Promocional, que se regerá pelas cláusulas seguintes e pelas condições descritas no presente.
      </p>

      <h2 class="contrato-secao-titulo">DO OBJETO DO CONTRATO</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 1ª. É objeto do presente contrato, a prestação dos serviços por parte da CONTRATADA à CONTRATANTE sobre as seguintes descrições:
      </p>

      <p class="contrato-servico-titulo">DESCRIÇÃO DO(S) SERVIÇO(S)</p>

      <p class="contrato-clausula contrato-justificado">${esc(descricao)}</p>

      <h2 class="contrato-secao-titulo">DAS OBRIGAÇÕES DA CONTRATADA</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 2ª. São direitos e deveres da CONTRATADA:
      </p>
      ${_lista(OBRIGACOES_CONTRATADA)}`
  }));

  /* ---- Página 2: obrigações da CONTRATANTE ---- */
  paginas.push(_pagina({
    numero: 2, header, marcaCss, footer,
    conteudo: `
      <h2 class="contrato-secao-titulo">DAS OBRIGAÇÕES DA CONTRATANTE</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 3ª. São direitos e deveres da CONTRATANTE:
      </p>
      ${_lista(OBRIGACOES_CONTRATANTE)}`
  }));

  /* ---- Página 3: custo, pagamento e prazo ---- */
  paginas.push(_pagina({
    numero: 3, header, marcaCss, footer,
    conteudo: `
      <h2 class="contrato-secao-titulo">DO CUSTO E DA FORMA DE PAGAMENTO</h2>

      <p class="contrato-clausula contrato-justificado">
        ${esc(clausulaCusto).replace(/\n/g, '<br>')}
      </p>

      <p class="contrato-clausula contrato-justificado">
        Dados para o pagamento.
      </p>

      <div class="contrato-clausula contrato-lista-container">
        <p>CHAVE PIX: 59.417.603/0001-36</p>
        <p>Titular: Agência Blue Organização de Eventos e Inteligência Empresarial Ltda</p>
        <p>CNPJ: 59.417.603/0001-36</p>
        <p>Banco: Cora</p>
      </div>

      <h2 class="contrato-secao-titulo">DO PRAZO E CRONOGRAMA</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 5ª. O prazo do presente contrato vigora a partir do dia ${esc(dataVigencia)}. Para cancelamento do contrato, uma das partes deve notificar a outra com no máximo 24hs após assinatura do contrato (mediante confirmação da outra parte), só pode ser feito por concordância de ambas partes, caso contrário, implicará em multa prevista na Cláusula 7ª.
      </p>`
  }));

  /* ---- Página 4: rescisão, multa, alterações e foro ---- */
  paginas.push(_pagina({
    numero: 4, header, marcaCss, footer,
    conteudo: `
      <h2 class="contrato-secao-titulo">DA RESCISÃO E ALTERAÇÃO DE CLÁUSULAS</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 6ª. A rescisão do presente instrumento não extinguirá os direitos e obrigações que as partes tenham entre si e para com terceiros.
      </p>
      <p class="contrato-clausula contrato-justificado">
        Cláusula 7ª. Pagará multa de 30% do valor total do contrato, contado a partir da data de rescisão unilateral, corrigido no momento do pagamento, qualquer das partes que der causa à rescisão do presente contrato por não cumprir as obrigações aqui assumidas.
      </p>
      <p class="contrato-clausula contrato-justificado">
        Cláusula 8ª. Este contrato poderá ser revisado, ampliado, reduzido e modificado a qualquer tempo, mediante a anuência das partes envolvidas.
      </p>

      <h2 class="contrato-secao-titulo">DO FORO</h2>

      <p class="contrato-clausula contrato-justificado">
        Cláusula 9ª. Para dirimir quaisquer controvérsias oriundas do contrato, as partes elegem o foro da comarca de Fortaleza - CE.
      </p>

      <p class="contrato-clausula contrato-justificado" style="margin-top: 10mm;">
        Por estarem assim justos e contratados, firmam o presente instrumento.
      </p>

      <p class="contrato-clausula" style="text-align: right; margin-top: 6mm;">
        Fortaleza - CE, ${esc(dataVigencia)}.
      </p>`
  }));

  return `<div class="contrato-documento">${paginas.join('')}</div>`;
}

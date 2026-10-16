/* ============================================
   TEMPLATE DE PROPOSTA COMERCIAL — BLUE PRO
   Geração das páginas A4 em HTML para PDF
   Respeitando layout oficial de 5+ páginas
   Puro (sem DOM, sem banco): testável em Node
   ============================================ */

import { fmtDateBR, fmtCurrency } from './formato.js';
import {
  LOGO_BLUE_PRO_BASE64,
  WATERMARK_CAPA_BASE64,
  FOTO_INSTITUCIONAL_BASE64,
  WATERMARK_P4_BASE64,
  ZAP_DOODLE_BASE64
} from './proposta_assets_base64.js';

export {
  LOGO_BLUE_PRO_BASE64,
  WATERMARK_CAPA_BASE64,
  FOTO_INSTITUCIONAL_BASE64,
  WATERMARK_P4_BASE64,
  ZAP_DOODLE_BASE64
} from './proposta_assets_base64.js';

export const A4_LARGURA_PX = 794;
export const A4_ALTURA_PX = 1123;

/* Paleta oficial medida no modelo "PROPOSTA COMERCIAL - IAP-4.pdf" */
export const PROPOSTA_CORES = {
  navy: '#002D72',
  indigo: '#17028A',
  capaTitulo: '#043D74',
  banda: '#AFC6E5',
  linhaNum: '#A5CBFF',
  linhaTinta: '#ECF4FF',
  badge: '#B82400',
  texto: '#1F1F1F',
  arcos: '#F4DFF8',
  arcosCapa: '#E4E8F0',
  amarelo: '#FFD51E',
  verde: '#08583F',
  lineAzul: '#004AAD'
};

/* Assets padrão: Data URIs embutidas (0 requisições de rede, sem 404/CORS
   no deploy). Os caminhos em /assets/ continuam válidos como override. */
export const PROPOSTA_LOGO_TRANSPARENTE_PADRAO = LOGO_BLUE_PRO_BASE64;
export const PROPOSTA_WATERMARK_PADRAO = WATERMARK_CAPA_BASE64;
export const PROPOSTA_WATERMARK_P4_PADRAO = WATERMARK_P4_BASE64;
export const PROPOSTA_SKYLINE_PADRAO = FOTO_INSTITUCIONAL_BASE64;
export const PROPOSTA_ZAP_DOODLE_PADRAO = ZAP_DOODLE_BASE64;

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

export const SERVICOS_PROMOCIONAIS_COL1 = [
  'Produção de eventos',
  'Ações Promocionais',
  'Promotores de Vendas',
  'Blitz Promocional',
  'Roleta de Brindes',
  'Entrega de Brindes',
  'Marketing Digital',
  'Brindes Personalizados',
  'Panfletagem',
  'Degustação',
  'Locução',
  'Recepção',
  'Faixa Humana',
  'Consultoria em Marketing',
  'Consultoria Comercial'
];

export const SERVICOS_PROMOCIONAIS_COL2 = [
  'Captação de Leads',
  'Gestor de Tráfego',
  'Social Media',
  'SEO Google',
  'Bandeirada',
  'Endomarketing',
  'Coffee Break',
  'Promotores de Stand',
  'Lançamentos',
  'Trade Marketing',
  'Live Marketing',
  'Shopper Marketing',
  'Palestras e treinamentos',
  'Congressos',
  'e muito mais...'
];

export const TEXTO_INSTITUCIONAL_EMPRESA = 
  'Somos a Blue PRO, uma Agência de comunicação de marketing e Publicidade exclusiva de Fortaleza e Regiões. ' +
  'Construímos uma equipe de profissionais apaixonados e cheios de ideias que se dedicaram para produzir grandes ' +
  'resultados para nossos clientes. Por meio de uma enorme variedade de serviços, fornecemos orientação ' +
  'estratégica, apresentando a solução certa para cada cliente que atendemos.';

/* Calcula a quantidade de páginas e divide os itens da tabela */
export function particionarItensTabela(itens = [], limitePorPagina = 7) {
  if (!Array.isArray(itens) || itens.length === 0) {
    return [[]];
  }
  const chunks = [];
  for (let i = 0; i < itens.length; i += limitePorPagina) {
    chunks.push(itens.slice(i, i + limitePorPagina));
  }
  return chunks;
}

/* --------------------------------------------
   Rodapé: página 1 em texto simples;
   páginas 2+ na faixa navy oficial (branco)
   -------------------------------------------- */
function _renderRodape(paginaAtual, totalPaginas, { barra = true, empresa = '' } = {}) {
  const rotulo = `Página: ${paginaAtual}/${totalPaginas}`;

  if (!barra) {
    return `
    <div class="proposta-rodape proposta-rodape--texto">
      <span>${rotulo}</span>
    </div>`;
  }

  const linhasEmpresa = empresa
    ? empresa
        .split('<br>')
        .map(l => `<p class="proposta-rodape__empresa-linha">${l}</p>`)
        .join('')
    : '';

  return `
    <div class="proposta-rodape proposta-rodape--barra">
      ${linhasEmpresa ? `<div class="proposta-rodape__empresa">${linhasEmpresa}</div>` : ''}
      <span class="proposta-rodape__pag">${rotulo}</span>
    </div>`;
}

/* Círculos concêntricos (capa) — divs, pois html2canvas não rasteriza <svg> */
function _renderCircles(items, className) {
  return items.map(r => `<span class="${className}" style="width:${r * 2}px;height:${r * 2}px;"></span>`).join('\n');
}

/* Página 1: Capa */
function _renderPaginaCapa({ propostoA, logoUrl, watermarkUrl, totalPaginas }) {
  return `
  <div class="contrato-pagina proposta-pagina proposta-pagina--capa">
    <div class="proposta-capa__circulos" aria-hidden="true">
      ${_renderCircles([240, 360, 480, 600, 680], 'proposta-capa__circulo proposta-capa__circulo--tr')}
      ${_renderCircles([200, 300, 400, 500], 'proposta-capa__circulo proposta-capa__circulo--bl')}
    </div>

    <div class="proposta-capa__header">
      <img src="${esc(logoUrl)}" alt="Agência Blue PRO" class="proposta-logo-img" />
    </div>

    <div class="proposta-capa__hero">
      <h1 class="proposta-capa__titulo">
        <span>PROPOSTA</span>
        <span>COMERCIAL</span>
      </h1>
    </div>

    <img src="${esc(watermarkUrl)}" alt="" aria-hidden="true" class="proposta-capa__watermark" />

    <div class="proposta-capa__bottom">
      <div class="proposta-capa__proposto-label">PROPOSTO A:</div>
      <div class="proposta-capa__proposto-nome">${esc(_v(propostoA))}</div>
    </div>

    ${_renderRodape(1, totalPaginas, { barra: false })}
  </div>`;
}

/* Página 2: Institucional & Bases do Projeto */
function _renderPaginaInstitucional({ basesProjeto, logoUrl, skylineUrl, totalPaginas }) {
  const basesLinhas = String(basesProjeto || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const basesHtml = basesLinhas.length
    ? basesLinhas.map(l => `<p class="proposta-bases-item">• ${esc(l.replace(/^[•\-\*]\s*/, ''))}</p>`).join('\n')
    : `<p class="proposta-bases-item">• ${esc(_v(basesProjeto, 'Ações Promocionais e Marketing'))}</p>`;

  return `
  <div class="contrato-pagina contrato-page-break proposta-pagina proposta-pagina--institucional">
    <div class="proposta-inst__foto" style="background-image: url('${esc(skylineUrl)}');" aria-hidden="true"></div>

    <div class="proposta-inst__header">
      <img src="${esc(logoUrl)}" alt="Agência Blue PRO" class="proposta-logo-img" />
      <div class="proposta-inst__logo-line"></div>
    </div>

    <div class="proposta-inst__conteudo">
      <div class="proposta-inst__bloco">
        <h2 class="proposta-inst__titulo">A EMPRESA</h2>
        <p class="proposta-inst__texto">${esc(TEXTO_INSTITUCIONAL_EMPRESA)}</p>
      </div>

      <div class="proposta-inst__bloco proposta-inst__bloco--bases">
        <h2 class="proposta-inst__titulo">BASES DO PROJETO</h2>
        <div class="proposta-bases-lista">
          ${basesHtml}
        </div>
      </div>
    </div>

    <div class="proposta-inst__bg-curves" aria-hidden="true">
      <span style="width:840px;height:840px;"></span>
      <span style="width:680px;height:680px;"></span>
      <span style="width:520px;height:520px;"></span>
    </div>

    ${_renderRodape(2, totalPaginas)}
  </div>`;
}

/* Página 3+: Tabela Comercial & Custos */
function _renderPaginaTabela({
  itensChunk = [],
  offsetIndex = 0,
  dataStr = '',
  tituloPeriodo = '',
  valorTotal = 0,
  isLastTablePage = true,
  numeroPagina = 3,
  totalPaginas = 5,
  logoUrl = ''
}) {
  const dataFormatada = fmtDateBR(dataStr) || new Date().toLocaleDateString('pt-BR');

  const rowsHtml = itensChunk.map((item, idx) => {
    const num = offsetIndex + idx + 1;
    const desc = esc(_v(item.descricao));
    const qde = parseInt(item.quantidade) || 1;
    const valorUnit = Number(item.valor_unitario) || 0;
    const acoes = parseInt(item.acoes) || 1;
    const subtotal = Number(item.subtotal !== undefined ? item.subtotal : qde * valorUnit * acoes);
    const isOdd = idx % 2 === 0;

    return `
      <tr class="${isOdd ? 'proposta-tabela__tr--odd' : 'proposta-tabela__tr--even'}">
        <td class="proposta-col--num">${num}</td>
        <td class="proposta-col--desc">${desc}</td>
        <td class="proposta-col--qde">${qde}</td>
        <td class="proposta-col--unit">${fmtCurrency(valorUnit)}</td>
        <td class="proposta-col--acoes">${acoes}</td>
        <td class="proposta-col--subtotal">${fmtCurrency(subtotal)}</td>
      </tr>
    `;
  }).join('');

  const totalBadgeHtml = isLastTablePage ? `
    <div class="proposta-tabela__total-wrapper">
      <div class="proposta-tabela__total-badge">
        <span class="proposta-tabela__total-label">TOTAL:</span>
        <span class="proposta-tabela__total-val">${fmtCurrency(valorTotal)}</span>
      </div>
    </div>
  ` : '';

  return `
  <div class="contrato-pagina contrato-page-break proposta-pagina proposta-pagina--tabela">
    <div class="proposta-tab__band">
      <img src="${esc(logoUrl)}" alt="Agência Blue PRO" class="proposta-logo-img" />
      <div class="proposta-tab__line"></div>
      <div class="proposta-tab__data">
        <div class="proposta-tab__data-label">Data</div>
        <div class="proposta-tab__data-val">${esc(dataFormatada)}</div>
      </div>
    </div>

    <div class="proposta-ribbon-wrap">
      <div class="proposta-ribbon">
        <span>${esc(_v(tituloPeriodo, 'PROPOSTA DE SERVIÇOS')).replace(/\n/g, '<br>')}</span>
      </div>
    </div>

    <div class="proposta-tabela-container">
      <table class="proposta-tabela">
        <thead>
          <tr>
            <th class="proposta-col--num">Nº</th>
            <th class="proposta-col--desc">Descrição do Serviço</th>
            <th class="proposta-col--qde">Qde</th>
            <th class="proposta-col--unit">Valor Unit.</th>
            <th class="proposta-col--acoes">Ações</th>
            <th class="proposta-col--subtotal">Valor</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      ${totalBadgeHtml}
    </div>

    ${_renderRodape(numeroPagina, totalPaginas)}
  </div>`;
}

/* Página de Serviços Extras Promocionais */
function _renderPaginaServicosExtras({ numeroPagina, totalPaginas, watermarkP4Url, zapDoodleUrl }) {
  const col1Html = SERVICOS_PROMOCIONAIS_COL1.map(s => `<li>${esc(s)}</li>`).join('\n');
  const col2Html = SERVICOS_PROMOCIONAIS_COL2.map(s => `<li>${esc(s)}</li>`).join('\n');

  return `
  <div class="contrato-pagina contrato-page-break proposta-pagina proposta-pagina--extras">
    ${_renderDotsGrid()}

    <div class="proposta-extras__marca-agua" aria-hidden="true">
      <span class="proposta-extras__marca-agua-circulo"></span>
      <img src="${esc(watermarkP4Url)}" alt="" class="proposta-extras__marca-agua-img" />
    </div>

    <div class="proposta-extras__header-pill">
      <h2>AUMENTE SUAS VENDAS<br>COM AÇÕES PROMOCIONAIS</h2>
    </div>

    <div class="proposta-extras__grid">
      <ul class="proposta-extras__col">
        ${col1Html}
      </ul>
      <ul class="proposta-extras__col">
        ${col2Html}
      </ul>
    </div>

    <div class="proposta-extras__cta-box">
      <div class="proposta-extras__yellow-banner">
        VISITE NOSSO SITE E CONHEÇA TODOS OS NOSSOS SERVIÇOS
      </div>
      <a class="proposta-extras__site-link" href="https://www.agenciabluepro.com.br" target="_blank" rel="noopener">
        www.agenciabluepro.com.br
      </a>
      <div class="proposta-extras__zap-wrap">
        <img src="${esc(zapDoodleUrl)}" alt="chama no ZAP" class="proposta-extras__zap-doodle-img" />
        <div class="proposta-extras__zap-pill">
          (85) 9 9149-9320
        </div>
      </div>
    </div>

    ${_renderRodape(numeroPagina, totalPaginas)}
  </div>`;
}

/* Página de Contracapa */
function _renderPaginaContracapa({ numeroPagina, totalPaginas, logoUrl }) {
  return `
  <div class="contrato-pagina contrato-page-break proposta-pagina proposta-pagina--contracapa">
    ${_renderDotsGrid()}

    <div class="proposta-contracapa__center">
      <img src="${esc(logoUrl)}" alt="Agência Blue PRO" class="proposta-contracapa__logo" />
      <div class="proposta-contracapa__links">
        <div class="proposta-contracapa__insta">
          <svg class="proposta-contracapa__insta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
          <span>@agenciabluepro</span>
        </div>
        <div class="proposta-contracapa__site">
          www.agenciabluepro.com.br
        </div>
      </div>
    </div>

    ${_renderRodape(numeroPagina, totalPaginas, {
      empresa: 'BLUE MARKETING CONSULTORIA EMPRESARIAL<br>CNPJ: 59.417.603/0001-36'
    })}
  </div>`;
}

/* Padrão de pontilhado nos cantos (Páginas 4 e 5) */
function _renderDotsGrid() {
  return `
    <div class="proposta-dots-grid proposta-dots-grid--top-left" aria-hidden="true">
      ${Array(36).fill('<span></span>').join('')}
    </div>
    <div class="proposta-dots-grid proposta-dots-grid--bottom-right" aria-hidden="true">
      ${Array(36).fill('<span></span>').join('')}
    </div>
  `;
}

/* Construtor completo do documento da Proposta Comercial */
export function buildPropostaComercialPages(proposta = {}) {
  const logoUrl = proposta.logoUrl || PROPOSTA_LOGO_TRANSPARENTE_PADRAO;
  const watermarkUrl = proposta.watermarkUrl || PROPOSTA_WATERMARK_PADRAO;
  const skylineUrl = proposta.skylineUrl || PROPOSTA_SKYLINE_PADRAO;
  const itens = Array.isArray(proposta.itens) ? proposta.itens : [];
  const chunks = particionarItensTabela(itens, 7);
  const qtdPaginasTabela = chunks.length;

  // Total de páginas = Capa (1) + Institucional (1) + Tabelas (N) + Extras (1) + Contracapa (1)
  const totalPaginas = 1 + 1 + qtdPaginasTabela + 1 + 1;

  const paginas = [];

  // 1. Capa
  paginas.push(_renderPaginaCapa({
    propostoA: proposta.propostoA || proposta.contratante_nome,
    logoUrl,
    watermarkUrl,
    totalPaginas
  }));

  // 2. Institucional
  paginas.push(_renderPaginaInstitucional({
    basesProjeto: proposta.basesProjeto,
    logoUrl,
    skylineUrl,
    totalPaginas
  }));

  // 3+. Tabelas de Itens
  let itemOffset = 0;
  chunks.forEach((chunk, index) => {
    const numPagina = 3 + index;
    const isLast = index === chunks.length - 1;
    paginas.push(_renderPaginaTabela({
      itensChunk: chunk,
      offsetIndex: itemOffset,
      dataStr: proposta.dataProposta,
      tituloPeriodo: proposta.tituloPeriodo,
      valorTotal: Number(proposta.valorTotal || 0),
      isLastTablePage: isLast,
      numeroPagina: numPagina,
      totalPaginas,
      logoUrl
    }));
    itemOffset += chunk.length;
  });

  // 4. Extras
  const paginaExtrasNum = 3 + qtdPaginasTabela;
  paginas.push(_renderPaginaServicosExtras({
    numeroPagina: paginaExtrasNum,
    totalPaginas,
    watermarkP4Url: proposta.watermarkP4Url || PROPOSTA_WATERMARK_P4_PADRAO,
    zapDoodleUrl: proposta.zapDoodleUrl || PROPOSTA_ZAP_DOODLE_PADRAO
  }));

  // 5. Contracapa
  const paginaContracapaNum = paginaExtrasNum + 1;
  paginas.push(_renderPaginaContracapa({
    numeroPagina: paginaContracapaNum,
    totalPaginas,
    logoUrl
  }));

  return `<div class="contrato-documento proposta-documento">${paginas.join('\n')}</div>`;
}

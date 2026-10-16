import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPropostaComercialPages,
  particionarItensTabela,
  SERVICOS_PROMOCIONAIS_COL1,
  SERVICOS_PROMOCIONAIS_COL2,
  TEXTO_INSTITUCIONAL_EMPRESA,
  PROPOSTA_LOGO_TRANSPARENTE_PADRAO
} from '../src/lib/contrato/proposta_pdf.js';

const root = process.cwd();
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const stylesCss = readFileSync(join(root, 'styles.css'), 'utf8');

describe('Módulo de Proposta Comercial — Builder de PDF (proposta_pdf.js)', () => {
  it('exporta constantes de serviços promocionais e texto institucional', () => {
    assert.equal(SERVICOS_PROMOCIONAIS_COL1.length, 15);
    assert.equal(SERVICOS_PROMOCIONAIS_COL2.length, 15);
    assert.ok(TEXTO_INSTITUCIONAL_EMPRESA.includes('Somos a Blue PRO'));
  });

  it('particionarItensTabela divide itens corretamente por limite de página', () => {
    const itens1 = [{ descricao: 'Item 1' }, { descricao: 'Item 2' }];
    assert.equal(particionarItensTabela(itens1, 7).length, 1);

    const itens10 = Array.from({ length: 10 }, (_, i) => ({ descricao: `Item ${i + 1}` }));
    const chunks = particionarItensTabela(itens10, 7);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 7);
    assert.equal(chunks[1].length, 3);
  });

  it('buildPropostaComercialPages gera 5 páginas para até 7 itens com paginação 1/5 a 5/5', () => {
    const html = buildPropostaComercialPages({
      propostoA: 'EMPRESA CLIENTE TESTE',
      basesProjeto: 'PANFLETAGEM E DEGUSTAÇÃO',
      dataProposta: '2026-10-20',
      tituloPeriodo: 'AÇÃO DE MARKETING - 20 A 22/10',
      valorTotal: 1500,
      itens: [
        { descricao: 'PROMOTORA DE VENDAS', quantidade: 2, valor_unitario: 150, acoes: 3, subtotal: 900 },
        { descricao: 'COORDENAÇÃO GERAL', quantidade: 1, valor_unitario: 200, acoes: 3, subtotal: 600 }
      ]
    });

    assert.ok(html.includes('PROPOSTA'), 'não contém PROPOSTA');
    assert.ok(html.includes('COMERCIAL'), 'não contém COMERCIAL');
    assert.ok(html.includes('EMPRESA CLIENTE TESTE'), 'não contém cliente');
    assert.ok(html.includes('A EMPRESA'), 'não contém seção A EMPRESA');
    assert.ok(html.includes('BASES DO PROJETO'), 'não contém BASES DO PROJETO');
    assert.ok(html.includes('PANFLETAGEM E DEGUSTAÇÃO'), 'não contém texto das bases');
    assert.ok(html.includes('AÇÃO DE MARKETING - 20 A 22/10'), 'não contém título da ação');
    assert.ok(html.includes('PROMOTORA DE VENDAS'), 'não contém item da tabela');
    assert.ok(html.includes('R$&nbsp;1.500,00') || html.includes('1.500,00'), 'não contém total formatado');
    assert.ok(html.includes('AUMENTE SUAS VENDAS'), 'não contém seção de serviços extras');
    assert.ok(html.includes('chama no ZAP'), 'não contém doodle do whatsapp');
    assert.ok(html.includes('marca-agua-p4.png'), 'não contém marca d\'água da página de extras');
    assert.ok(html.includes('chama-no-zap.png'), 'não contém imagem do doodle do whatsapp');
    assert.ok(html.includes('(85) 9 9149-9320'), 'não contém telefone do whatsapp');
    assert.ok(html.includes('@agenciabluepro'), 'não contém instagram');
    assert.ok(html.includes('www.agenciabluepro.com.br'), 'não contém site');
    assert.ok(html.includes('59.417.603/0001-36'), 'não contém CNPJ');

    // Paginação: 5 páginas
    assert.ok(html.includes('Página: 1/5'));
    assert.ok(html.includes('Página: 2/5'));
    assert.ok(html.includes('Página: 3/5'));
    assert.ok(html.includes('Página: 4/5'));
    assert.ok(html.includes('Página: 5/5'));
  });

  it('buildPropostaComercialPages quebra tabela em múltiplas páginas se houver mais de 7 itens', () => {
    const itens10 = Array.from({ length: 10 }, (_, i) => ({
      descricao: `SERVIÇO ESPECIAL ${i + 1}`,
      quantidade: 1,
      valor_unitario: 100,
      acoes: 1,
      subtotal: 100
    }));

    const html = buildPropostaComercialPages({
      propostoA: 'TESTE MULTIPAGINAS',
      itens: itens10,
      valorTotal: 1000
    });

    // 1 Capa + 1 Inst + 2 Tabelas + 1 Extras + 1 Contracapa = 6 páginas
    assert.ok(html.includes('Página: 1/6'));
    assert.ok(html.includes('Página: 2/6'));
    assert.ok(html.includes('Página: 3/6'));
    assert.ok(html.includes('Página: 4/6'));
    assert.ok(html.includes('Página: 5/6'));
    assert.ok(html.includes('Página: 6/6'));
  });

  it('usa a logo sem fundo branco por padrão e o asset PNG transparente existe', () => {
    const html = buildPropostaComercialPages({
      propostoA: 'LOGO TRANSPARENTE',
      itens: [{ descricao: 'SERVIÇO', quantidade: 1, valor_unitario: 100, acoes: 1, subtotal: 100 }]
    });

    assert.equal(
      PROPOSTA_LOGO_TRANSPARENTE_PADRAO,
      '/assets/proposta/logo_blue_pro_transparente.png'
    );
    assert.ok(
      html.includes('/assets/proposta/logo_blue_pro_transparente.png'),
      'builder não usa a logo transparente'
    );
    assert.ok(
      !html.includes('/assets/logo_blue_pro.png'),
      'builder ainda referencia a logo com fundo branco'
    );

    const logoBytes = readFileSync(join(root, 'public/assets/proposta/logo_blue_pro_transparente.png'));
    // IHDR: largura (16), altura (20), bit depth (24), color type (25)
    assert.equal(logoBytes[25], 6, 'logo não está em RGBA (color type 6)');
  });

  it('rodapé da contracapa renderiza Razão Social e CNPJ em duas linhas dentro da faixa', () => {
    const html = buildPropostaComercialPages({
      propostoA: 'RODAPE TESTE',
      itens: [{ descricao: 'SERVIÇO', quantidade: 1, valor_unitario: 100, acoes: 1, subtotal: 100 }]
    });

    const empresa = html.match(/proposta-rodape__empresa[\s\S]{0,400}/);
    assert.ok(empresa, 'bloco de empresa do rodapé ausente');
    const bloco = empresa[0];
    assert.ok(bloco.includes('proposta-rodape__empresa-linha'));
    assert.ok(bloco.includes('BLUE MARKETING CONSULTORIA EMPRESARIAL'));
    assert.ok(bloco.includes('CNPJ: 59.417.603/0001-36'));
    assert.equal((bloco.match(/proposta-rodape__empresa-linha/g) || []).length, 2);
  });
});

describe('Interface da Proposta Comercial (index.html e styles.css)', () => {
  it('menu Adicionar Contrato tem a opção Proposta Comercial ativa e identificada como PDF', () => {
    assert.match(indexHtml, /data-tipo="proposta"[^>]*>[\s\S]*?Proposta Comercial[\s\S]*?PDF/);
    assert.doesNotMatch(indexHtml, /data-tipo="proposta"[^>]*disabled/);
    assert.doesNotMatch(indexHtml, /data-tipo="proposta"[^>]*contratos-add-option--disabled/);
  });

  it('index.html contém a estrutura do modal de Proposta Comercial com todos os campos exigidos', () => {
    assert.match(indexHtml, /id="modalPropostaOverlay"/);
    assert.match(indexHtml, /id="modalPropostaComercial"/);
    assert.match(indexHtml, /id="propostaLeadSearchable"/);
    assert.match(indexHtml, /id="propostaEmpresa"/);
    assert.match(indexHtml, /id="propostaPropostoA"/);
    assert.match(indexHtml, /id="propostaBasesProjeto"/);
    assert.match(indexHtml, /id="propostaData"/);
    assert.match(indexHtml, /id="propostaTituloPeriodo"/);
    assert.match(indexHtml, /id="tabelaPropostaItens"/);
    assert.match(indexHtml, /id="btnAdicionarItemProposta"/);
    assert.match(indexHtml, /id="propostaTotalBox"/);
    assert.match(indexHtml, /id="propostaTotalDisplay"/);
    assert.match(indexHtml, /id="btnGerarPropostaPdf"/);
    assert.match(indexHtml, /id="btnCancelarProposta"/);
  });
});

describe('Integração no app.js', () => {
  it('app.js importa buildPropostaComercialPages', () => {
    assert.ok(appJs.includes('buildPropostaComercialPages'));
  });

  it('app.js trata clique em data-tipo="proposta" e abre abrirModalPropostaComercial', () => {
    assert.ok(appJs.includes("tipo === 'proposta'"));
    assert.ok(appJs.includes('abrirModalPropostaComercial()'));
  });

  it('funções de proposta comercial estão declaradas e expostas em window', () => {
    assert.ok(appJs.includes('function abrirModalPropostaComercial('));
    assert.ok(appJs.includes('function fecharModalPropostaComercial('));
    assert.ok(appJs.includes('function propostaAdicionarItem('));
    assert.ok(appJs.includes('function propostaRemoverItem('));
    assert.ok(appJs.includes('function propostaRecalcularTotais('));
    assert.ok(appJs.includes('async function propostaGerarPDF('));

    assert.ok(appJs.includes('window.abrirModalPropostaComercial = abrirModalPropostaComercial'));
    assert.ok(appJs.includes('window.fecharModalPropostaComercial = fecharModalPropostaComercial'));
    assert.ok(appJs.includes('window.propostaAdicionarItem = propostaAdicionarItem'));
    assert.ok(appJs.includes('window.propostaRemoverItem = propostaRemoverItem'));
    assert.ok(appJs.includes('window.propostaRecalcularTotais = propostaRecalcularTotais'));
    assert.ok(appJs.includes('window.propostaGerarPDF = propostaGerarPDF'));
  });

  it('propostaGerarPDF salva contrato com tipo_contrato="proposta"', () => {
    assert.ok(appJs.includes("tipo_contrato: 'proposta'"));
  });
});

describe('Performance e estados de exportação do PDF (app.js + styles.css)', () => {
  it('propostaGerarPDF mostra spinner e libera o botão/overlay no finally', () => {
    assert.ok(appJs.includes('proposta-btn-spinner'), 'spinner do botão ausente');
    assert.ok(appJs.includes('Gerando PDF...'), 'texto de carregamento ausente');
    assert.ok(
      appJs.includes('_propostaMarcarExportando(true)') &&
        appJs.includes('_propostaMarcarExportando(false)'),
      'marcador de exportação não é aplicado e removido'
    );
    assert.ok(appJs.includes('btnGerarHtmlOriginal'), 'HTML original do botão não é restaurado');
    assert.ok(appJs.includes("modalOverlay.style.pointerEvents = ''"), 'pointer-events do overlay não é restaurado');
    assert.ok(
      appJs.includes('modalOverlay.classList.remove(\'modal-proposta-overlay--exportando\')'),
      'classe de exportação não é removida ao fechar'
    );
  });

  it('html2canvas usa willReadFrequently e devolve o quadro entre páginas', () => {
    assert.ok(appJs.includes('willReadFrequently: true'), 'willReadFrequently ausente');
    assert.ok(
      appJs.includes('await new Promise(r => setTimeout(r, 0))'),
      'não há rendição entre páginas para a UI não travar'
    );
  });

  it('estilos de carregamento e marca dágua da p4 existem no CSS', () => {
    assert.ok(stylesCss.includes('#btnGerarPropostaPdf:disabled'));
    assert.ok(stylesCss.includes('.proposta-btn-spinner'));
    assert.ok(stylesCss.includes('@keyframes proposta-btn-spin'));
    assert.ok(stylesCss.includes('.modal-proposta-overlay--exportando'));
    // Marca d'água discreta e atrás do conteúdo
    assert.match(stylesCss, /\.proposta-extras__marca-agua \{[^}]*opacity: 0\.12/);
    assert.match(stylesCss, /\.proposta-extras__grid \{[^}]*z-index: 2/);
    assert.match(stylesCss, /\.proposta-extras__cta-box \{[^}]*z-index: 2/);
    assert.match(stylesCss, /\.proposta-extras__header-pill \{[^}]*z-index: 2/);
  });

  it('logo do PDF não pinta fundo branco sobre a faixa da página 3', () => {
    assert.match(stylesCss, /\.proposta-logo-img \{[^}]*background: transparent/);
    assert.match(stylesCss, /\.proposta-logo-img \{[^}]*mix-blend-mode: multiply/);
  });

  it('bloco do rodapé da contracapa cabe dentro da faixa navy (11px / line-height 1.3)', () => {
    assert.match(stylesCss, /\.proposta-rodape__empresa \{[^}]*height: 38px/);
    assert.match(stylesCss, /\.proposta-rodape__empresa \{[^}]*font-size: 11px/);
    assert.match(stylesCss, /\.proposta-rodape__empresa \{[^}]*padding-left: 35px/);
    assert.match(stylesCss, /\.proposta-rodape__empresa \{[^}]*z-index: 10/);
    assert.match(stylesCss, /\.proposta-rodape__empresa-linha \{[^}]*line-height: 1\.3/);
  });
});

describe('Persistência da Proposta na tabela de Contratos (app.js)', () => {
  it('propostaGerarPDF persiste, fecha o modal e atualiza a tabela com os filtros atuais', () => {
    const corpo = appJs.slice(appJs.indexOf('async function propostaGerarPDF('));
    assert.ok(corpo.includes('_montarPropostaPayload('), 'não monta o payload da proposta');
    assert.ok(corpo.includes('_salvarPropostaComoContrato('), 'não persiste a proposta');
    assert.ok(corpo.includes('fecharModalPropostaComercial();'), 'não fecha o modal após gerar');
    assert.ok(corpo.includes('await refreshContratosTable();'), 'não recarrega a tabela de contratos');
    assert.ok(corpo.includes('gerada e registrada com sucesso'), 'não notifica sucesso');
  });

  it('_montarPropostaPayload usa as colunas reais (numero_contrato, tipo, centro_custo_id)', () => {
    const corpo = appJs.slice(appJs.indexOf('function _montarPropostaPayload('));
    assert.ok(corpo.includes('numero_contrato: _gerarNumeroProposta()'), 'sem numero_contrato PROP-XXXX');
    assert.ok(corpo.includes("tipo_contrato: 'proposta'"), 'sem tipo_contrato proposta');
    assert.ok(corpo.includes("status: 'gerado'"), 'sem status gerado (valido no CHECK)');
    assert.ok(corpo.includes('centro_custo_id:'), 'sem centro_custo_id (filtro de empresa)');
    assert.ok(corpo.includes('pdf_storage_path:'), 'sem pdf_storage_path (download)');
    assert.ok(corpo.includes('conteudo_contrato:'), 'sem conteudo_contrato (preview)');
  });

  it('há fallback em localStorage (crm_contratos) quando o Supabase falha', () => {
    assert.ok(appJs.includes("'crm_contratos'"), 'chave do localStorage ausente');
    assert.ok(appJs.includes('function _salvarPropostaLocal('), 'sem gravação local');
    assert.ok(appJs.includes('function _carregarContratosLocais('), 'sem leitura local');
    assert.ok(appJs.includes('function _excluirContratoLocal('), 'sem exclusão local');
    assert.ok(appJs.includes("origem: 'local'"), 'não marca origem local na queda');

    // loadContratos precisa mesclar propostas locais que não estão no banco
    const load = appJs.slice(appJs.indexOf('async function loadContratos('));
    assert.ok(load.includes('pendentesLocais'), 'loadContratos não mescla propostas locais');
    assert.ok(load.includes('_carregarContratosLocais'), 'loadContratos não usa o fallback local');
  });

  it('tabela exibe botão de visualizar PDF e permite excluir proposta', () => {
    const render = appJs.slice(appJs.indexOf('function renderContratosTable('));
    assert.ok(render.includes("c.tipo_contrato === 'proposta'"), 'tabela não detecta proposta');
    assert.ok(render.includes('contratoVerPropostaPDF('), 'sem botão de visualizar PDF da proposta');
    assert.ok(render.includes("|| ehProposta"), 'exclusão não liberada para proposta');
    assert.ok(render.includes("'${c.tipo_contrato || ''}'"), 'tipo não passado para contratoExcluir');
  });

  it('contratoExcluir aceita proposta (tipo) e contratoVerPropostaPDF está exposta', () => {
    const excluir = appJs.slice(appJs.indexOf('function contratoExcluir('));
    assert.ok(excluir.includes("tipo = ''"), 'contratoExcluir não recebe tipo');
    assert.ok(excluir.includes('const ehProposta = tipo ==='), 'contratoExcluir não trata proposta');

    assert.ok(appJs.includes('async function contratoVerPropostaPDF('), 'função de visualizar ausente');
    assert.ok(appJs.includes('window.contratoVerPropostaPDF = contratoVerPropostaPDF'), 'não exposta em window');
  });
});

describe('Edição de Proposta Comercial pela tabela de Contratos (app.js)', () => {
  it('contratoEdit roteia propostas para abrirModalEdicaoProposta (evita "Erro ao carregar contrato")', () => {
    const edit = appJs.slice(appJs.indexOf('async function contratoEdit('));
    assert.ok(edit.includes("tipo_contrato === 'proposta'"), 'contratoEdit não detecta proposta');
    assert.ok(edit.includes('await abrirModalEdicaoProposta(id);'), 'não chama o fluxo de edição de proposta');
    assert.ok(
      edit.indexOf("tipo_contrato === 'proposta'") < edit.indexOf("if (!_supabase) return;"),
      'roteamento precisa ocorrer antes do bloqueio por ausência de Supabase'
    );
  });

  it('abrirModalEdicaoProposta recupera campos e itens e abre o modal preenchido', () => {
    const corpo = appJs.slice(appJs.indexOf('async function abrirModalEdicaoProposta('));
    assert.ok(corpo.includes('_normalizaServicosProposta(c)'), 'não normaliza os itens salvos');
    assert.ok(corpo.includes('editandoId: c.id'), 'não preserva o id');
    assert.ok(corpo.includes('editandoNumero: c.numero_contrato'), 'não preserva o numero');
    assert.ok(corpo.includes('centroCustoId: c.centro_custo_id'), 'não recupera a empresa emitente');
    assert.ok(corpo.includes('propostoA: c.contratante_nome'), 'não recupera o "Proposto a"');
    assert.ok(appJs.includes('window.abrirModalEdicaoProposta = abrirModalEdicaoProposta'), 'não exposta em window');
  });

  it('modo edição muda o rótulo do botão e o título do modal', () => {
    const abrir = appJs.slice(appJs.indexOf('async function abrirModalPropostaComercial('));
    assert.ok(abrir.includes('_propostaEditandoId = opts.editandoId'), 'não guarda o estado de edição');
    assert.ok(abrir.includes('Salvar Alterações / Atualizar PDF'), 'botão sem rótulo de edição');
    assert.ok(abrir.includes('Editar Proposta Comercial'), 'título sem indicação de edição');
    assert.ok(abrir.includes('ehEdicao'), 'sem flag de edição');
  });

  it('payload de proposta guarda itens completos + basesProjeto/tituloPeriodo para reedição', () => {
    const payload = appJs.slice(appJs.indexOf('function _montarPropostaPayload('));
    assert.ok(payload.includes('basesProjeto: dados.basesProjeto'), 'sem basesProjeto no payload');
    assert.ok(payload.includes('tituloPeriodo: dados.tituloPeriodo'), 'sem tituloPeriodo no payload');
    assert.ok(payload.includes('valor_unitario: i.valor_unitario'), 'sem valor_unitario por item');
    assert.ok(payload.includes('acoes: i.acoes'), 'sem acoes por item');
    assert.ok(payload.includes('quantidade: i.quantidade'), 'sem quantidade por item');
  });

  it('_normalizaServicosProposta aceita wrapper, array de strings e array de objetos', () => {
    const fn = appJs.slice(appJs.indexOf('function _normalizaServicosProposta('));
    assert.ok(fn.includes('Array.isArray(raw.itens)'), 'sem tratamento de wrapper');
    assert.ok(fn.includes("typeof s === 'string'"), 'sem conversão de string em item');
    assert.ok(fn.includes('descricao_servicos'), 'sem fallback para descricao_servicos');
  });

  it('_atualizarPropostaExistente preserva id/numero e trata o fallback local', () => {
    const corpo = appJs.slice(appJs.indexOf('async function _atualizarPropostaExistente('));
    assert.ok(corpo.includes('numero_contrato: _ignorado'), 'não preserva o numero_contrato original');
    assert.ok(corpo.includes('patch.id = id'), 'não preserva o id original');
    assert.ok(corpo.includes('_patchContrato(id, patch)'), 'não atualiza no banco');
    assert.ok(corpo.includes('_gravarContratosLocais'), 'não atualiza o fallback local');
  });

  it('propostaGerarPDF atualiza em vez de duplicar e regenera o PDF', () => {
    const corpo = appJs.slice(appJs.indexOf('async function propostaGerarPDF('));
    assert.ok(corpo.includes('const ehEdicao = !!_propostaEditandoId'), 'sem flag de edição no gerador');
    assert.ok(corpo.includes('_atualizarPropostaExistente(_propostaEditandoId'), 'não atualiza a proposta existente');
    assert.ok(corpo.includes('Proposta comercial atualizada com sucesso!'), 'toast de edição ausente');
    assert.ok(corpo.includes('existente?.pdf_storage_path'), 'não reutiliza o path do PDF já enviado');
  });
});

describe('Contracapa — CNPJ atualizado (proposta_pdf.js)', () => {
  it('usa o novo CNPJ 59.417.603/0001-36 e não mantém o antigo', () => {
    const fonte = readFileSync(join(root, 'src/lib/contrato/proposta_pdf.js'), 'utf8');
    assert.ok(fonte.includes('CNPJ: 59.417.603/0001-36'), 'novo CNPJ ausente no builder');
    assert.ok(!fonte.includes('50.159.695/0001-27'), 'CNPJ antigo ainda presente no builder');
  });
});

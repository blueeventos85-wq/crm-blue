import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes de regressão: boot, autenticação e navegação
   -----------------------------------------------------------
   app.js é um monólito carregado como <script type="module"> e
   não pode ser importado em Node (executa DOM no carregamento).
   Estes testes validam as invariantes estruturais que causavam
   os bugs de "tela bugada" / "só atualiza com F5":
     - scripts do head sem defer (parse bloqueado);
     - handlers duplicados de navegação;
     - inicialização de sessão concorrente;
     - catch de boot destrutivo;
     - cadastro sem invalidação de cache.
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const supabaseClientJs = readFileSync(join(root, 'supabaseClient.js'), 'utf8');

/** Extrai o corpo de uma função top-level (contagem de chaves). */
function extractFn(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  let i = source.indexOf('{', start + header.length);
  if (i === -1) return null;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe('index.html · carregamento de scripts', () => {
  it('todos os <script src> clássicos do <head> usam defer', () => {
    const head = indexHtml.slice(indexHtml.indexOf('<head>'), indexHtml.indexOf('</head>'));
    const tags = head.match(/<script[^>]*\ssrc=[^>]*>/g) || [];
    assert.ok(tags.length >= 5, `esperava vários scripts no head, encontrei ${tags.length}`);
    const semDefer = tags.filter(t => !t.includes('defer') && !t.includes('type="module"'));
    assert.deepEqual(semDefer, [], `scripts bloqueando o parse: ${semDefer.join(' | ')}`);
  });

  it('não há onclick inline quebrado de navegação (sidebar usa delegação)', () => {
    assert.ok(!/onclick="setActivePage\(/.test(indexHtml),
      'setActivePage não é global por padrão; o bind deve ser feito em JS');
  });
});

describe('app.js · exposição de globals para onclick', () => {
  it('expõe as funções usadas em onclick gerado', () => {
    for (const fn of ['setActivePage', 'convSendMessageSuggestion', 'convToggleArchive', 'openCcModal']) {
      assert.ok(appJs.includes(`window.${fn} = ${fn};`), `window.${fn} não está exposta`);
    }
  });
});

describe('app.js · autenticação (single-flight)', () => {
  const initAuth = extractFn(appJs, 'async function initAuth()');

  it('initAuth existe', () => {
    assert.ok(initAuth, 'initAuth não encontrada');
  });

  it('onAuthStateChange delega para _ensureAuthReady (sem 2ª inicialização)', () => {
    assert.ok(initAuth.includes('_ensureAuthReady(newSession)'), 'handler não usa single-flight');
    assert.ok(!initAuth.includes("event === 'INITIAL_SESSION'"),
      'o caminho especial de INITIAL_SESSION duplicava toda a inicialização');
  });

  it('o handler de auth tem try/catch próprio (erro não pode esconder a tela)', () => {
    assert.ok(/onAuthStateChange\(async \(event, newSession\) => \{\s*try \{/.test(initAuth),
      'callback sem try/catch: a lib reinvoca com session=null e derruba o app');
  });

  it('esconde o overlay somente depois de onAuthReady (permissões carregadas)', () => {
    const finish = extractFn(appJs, 'async function _finishAuthSession(session)');
    assert.ok(finish, '_finishAuthSession não encontrada');
    const iReady = finish.indexOf('await onAuthReady()');
    const iHide = finish.indexOf('hideAuthOverlay()');
    assert.ok(iReady > -1 && iHide > -1, 'trecho incompleto');
    assert.ok(iHide > iReady, 'hideAuthOverlay() rodando antes de onAuthReady()');
  });

  it('onAuthReady não zera mais a flag de bind dos listeners de Configurações', () => {
    const onAuthReady = extractFn(appJs, 'async function onAuthReady()');
    assert.ok(onAuthReady, 'onAuthReady não encontrada');
    assert.ok(!onAuthReady.includes('_settingsBound = false'),
      'zerar _settingsBound a cada evento de auth re-instalava os listeners');
  });
});

describe('app.js · boot', () => {
  const boot = appJs.slice(appJs.indexOf("document.addEventListener('DOMContentLoaded'"));

  it('o catch de boot não destrói o DOM', () => {
    assert.ok(!/document\.body\.innerHTML\s*=\s*'<div style="padding:40px/.test(boot),
      'erro no boot apagava a tela inteira (obrigava F5)');
    assert.ok(boot.includes('toast('), 'erro de boot deve avisar o usuário sem apagar a UI');
  });

  it('não inicializa Calibragem no boot (dependia de leads e podia redirecionar)', () => {
    assert.ok(!/^\s*initCalibragem\(\);/m.test(boot), 'initCalibragem() ainda roda no boot');
  });

  it('as cargas do Supabase rodam em paralelo (Promise.all)', () => {
    assert.ok(boot.includes('Promise.all('), 'boot voltou a ser totalmente sequencial');
    assert.ok(boot.includes('bootLoad('), 'helper de carga paralela ausente');
  });

  it('re-renderiza a Home com os dados já carregados', () => {
    assert.ok(/renderClients\(\);[\s\S]*setActivePage\('home'\)/.test(boot),
      'Home deixou de ser re-renderizada ao final do boot');
  });

  it('marca o boot como concluído (para recarregar em re-login)', () => {
    assert.ok(boot.includes('_bootDataLoaded = true;'), 'flag de boot não é setada');
    const onAuthReady = extractFn(appJs, 'async function onAuthReady()');
    assert.ok(onAuthReady.includes('if (_bootDataLoaded) refreshLeadsEClientsCache()'),
      'troca de usuário no mesmo load ficava com as listas do usuário anterior');
  });
});

describe('app.js · navegação', () => {
  it('setActivePage valida se a página existe (evita tela em branco)', () => {
    const fn = extractFn(appJs, 'function setActivePage(page)');
    assert.ok(fn, 'setActivePage não encontrada');
    assert.ok(fn.includes(`document.getElementById(\`page-\${page}\`)`),
      'sem validação todas as páginas perdem .active');
  });

  it('auditoria registra apenas quando a rota muda', () => {
    const fn = extractFn(appJs, 'function setActivePage(page)');
    assert.ok(fn.includes('const pageChanged = prevPage !== page;'), 'auditoria duplicada por visita');
  });

  it('sidebar navega por delegação única (sem bind por item)', () => {
    const sidebar = extractFn(appJs, 'function renderSidebar()');
    assert.ok(sidebar, 'renderSidebar não encontrada');
    assert.ok(sidebar.includes('_navClickBound'), 'delegação ausente no container');
    assert.ok(!/nav\.innerHTML[\s\S]*?\$\$\('\.nav-item'\)\.forEach\(item => \{\s*item\.addEventListener/.test(sidebar),
      'bind por item ainda presente em renderSidebar');
    const interactions = extractFn(appJs, 'function initInteractions()');
    assert.ok(!interactions.includes("$$('.nav-item').forEach"),
      'initInteractions ainda binda nav-item (duplicaria a navegação)');
  });

  it('initDashboardPeriod só instala os listeners uma vez', () => {
    const fn = extractFn(appJs, 'function initDashboardPeriod()');
    assert.ok(fn.includes('_dashPeriodBound'), 'guard ausente: 4 listeners a cada visita ao Dashboard');
    const guardAt = fn.indexOf('_dashPeriodBound = true');
    const firstBind = fn.indexOf('addEventListener');
    assert.ok(guardAt > -1 && guardAt < firstBind, 'guard aplicado depois do bind');
  });

  it('Calibragem: binds de abas e relatório são únicos', () => {
    assert.ok(appJs.includes('let _calibControlsBound = false;'));
    assert.ok(appJs.includes('let _calibReportBound = false;'));
  });

  it('seção de Branding só binda uma vez', () => {
    const fn = extractFn(appJs, 'function initBrandingSection()');
    assert.ok(fn.includes('_brandingBound'), 'guard ausente: ~10 listeners a cada visita às Configurações');
  });

  it('resetAuthState sincroniza o DOM (página ativa + home limpa)', () => {
    const fn = extractFn(appJs, 'function resetAuthState()');
    assert.ok(fn.includes(`document.getElementById('page-home')`), 'logout não resetava a página visível');
    assert.ok(fn.includes('stopLeadsRealtime()'), 'canal realtime não era encerrado no logout');
  });
});

describe('app.js · invalidação pós-cadastro (sem F5)', () => {
  it('possui os helpers de refresh de cache', () => {
    for (const fn of ['refreshLeadsEClientsCache', 'refreshServicosCache', 'refreshCadenciasCache']) {
      assert.ok(appJs.includes(`async function ${fn}()`), `${fn} ausente`);
    }
  });

  it('saveLead recarrega leads/clientes após gravar com sucesso', () => {
    const fn = extractFn(appJs, 'async function saveLead()');
    assert.ok(fn.includes('if (savedOk) await refreshLeadsEClientsCache();'),
      'cadastro de lead não atualizava a página Cliente da Base');
  });

  it('exclusão em massa também limpa o array de leads (CRM)', () => {
    const fn = extractFn(appJs, 'async function deleteMassLeads()');
    assert.ok(fn.includes('leads = leads.filter'), 'leads excluídos continuavam no CRM');
    assert.ok(fn.includes('invalidateDashCache()'), 'KPIs do Dashboard ficavam desatualizados');
  });

  it('CRUD de serviço invalida o cache global de serviços', () => {
    const save = extractFn(appJs, 'async function handleServicoSave()');
    const del = extractFn(appJs, 'async function handleServicoDelete()');
    assert.ok(save.includes('refreshServicosCache()'), 'handleServicoSave sem refresh');
    assert.ok(del.includes('refreshServicosCache()'), 'handleServicoDelete sem refresh');
    assert.ok(supabaseClientJs.includes('function invalidateServicosCache()'),
      'cache de serviços mora em supabaseClient.js e precisa ser invalidável');
    assert.ok(supabaseClientJs.includes('window.invalidateServicosCache = invalidateServicosCache;'));
  });

  it('CRUD de cadência recarrega as cadências do CRM', () => {
    const save = extractFn(appJs, 'async function handleCadenciaSave()');
    const del = extractFn(appJs, 'async function handleCadenciaDelete()');
    assert.ok(save.includes('refreshCadenciasCache()'));
    assert.ok(del.includes('refreshCadenciasCache()'));
  });

  it('salvar empresa recarrega centros de custo e vínculos', () => {
    const fn = extractFn(appJs, 'async function handleEmpresaSave()');
    assert.ok(fn.includes('loadCentrosCustoFromSupabase()'), 'dropdowns ficavam com dados antigos');
    assert.ok(fn.includes('loadVinculosServicos()'), 'vínculos de serviço não recarregavam');
  });
});

describe('app.js · realtime de leads', () => {
  it('assina o canal e encerra no logout', () => {
    assert.ok(appJs.includes('function initLeadsRealtime()'));
    const onAuthReady = extractFn(appJs, 'async function onAuthReady()');
    assert.ok(onAuthReady.includes('initLeadsRealtime()'), 'canal não iniciado após o login');
    assert.ok(appJs.includes('function stopLeadsRealtime()'));
  });

  it('o refetch é debounceado (rajadas de INSERT não geram N refetches)', () => {
    const fn = extractFn(appJs, 'function initLeadsRealtime()');
    assert.ok(fn.includes('_leadsRealtimeTimer'), 'sem debounce');
    assert.ok(fn.includes('setTimeout('));
  });
});

describe('app.js · correções pontuais', () => {
  it('editor de imagem reabilita o botão de enviar no finally', () => {
    const fn = extractFn(appJs, 'async function _convEditorSend()');
    assert.ok(fn, '_convEditorSend não encontrada');
    assert.ok(/finally \{[\s\S]*?btn\.disabled = false/.test(fn),
      'botão ficava desabilitado após a primeira edição');
  });

  it('exclusão de mensagem reabilita o botão no finally', () => {
    const fn = extractFn(appJs, 'async function _convDeleteMessage(scope, btn)');
    assert.ok(fn && /finally \{[\s\S]*?btn\.disabled = false/.test(fn));
  });

  it('Auditoria não gera mais dados fictícios', () => {
    assert.ok(!appJs.includes('generateAuditMockData'), 'mock de auditoria ainda presente');
    assert.ok(appJs.includes('function mapAuditRows('), 'mapeamento real não encontrado');
    const init = extractFn(appJs, 'async function initAuditoria()');
    assert.ok(init.includes('mapAuditRows('), 'initAuditoria ainda usa fallback');
    assert.ok(!init.includes('generateAuditMockData'));
  });

  it('polling de QR usa o centro de custo e renova o QR', () => {
    const fn = extractFn(appJs, 'function waStartQrPolling(instanceName, centrosCustoId)');
    assert.ok(fn, 'waStartQrPolling não encontrada');
    assert.ok(fn.includes('waFetchConfig(currentUser.id, centrosCustoId)'),
      'status consultado só por membro_id não achava a instância por empresa');
    assert.ok(fn.includes('refreshQr'), 'nada renovava o QR expirado (spinner infinito)');
  });
});

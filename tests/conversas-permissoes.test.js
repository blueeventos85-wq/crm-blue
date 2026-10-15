import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ===========================================================
   Testes: Central de Atendimento (Conversas)
   - visibilidade da lista (sem filtro rígido de membro)
   - contadores/filtro "Contatos não identificados" por lead
   - busca por conteúdo de mensagens
   - sincronização de histórico
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(join(root, 'app.js'), 'utf8');
const waSource = readFileSync(join(root, 'src/lib/whatsapp/whatsapp-service.js'), 'utf8');
const historyFnSource = readFileSync(join(root, 'supabase/functions/wa-sync-history/index.ts'), 'utf8');
const webhookSource = readFileSync(join(root, 'supabase/functions/evolution-webhook/index.ts'), 'utf8');
const syncLeadSource = readFileSync(join(root, 'supabase/functions/sync-contact-to-lead/index.ts'), 'utf8');

function extrairFuncao(nome) {
  const inicio = appSource.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função ${nome} não encontrada em app.js`);
  const fim = appSource.indexOf('\n}', inicio);
  assert.ok(fim > inicio, `fim da função ${nome} não encontrado em app.js`);
  return appSource.slice(inicio, fim + 2);
}

describe('Conversas · visibilidade da lista', () => {
  const src = extrairFuncao('loadConversasChats');

  it('não filtra mais por membro_id (RLS/centro de custo governa)', () => {
    assert.ok(!src.includes(`.eq('membro_id', membroId)`), 'loadConversasChats ainda filtra por membro_id');
  });

  it('filtra por centro de custo apenas quando empresa está selecionada', () => {
    assert.ok(src.includes(`if (ccId) {`) && src.includes(`q.eq('centros_custo_id', ccId)`),
      'filtro condicional de centro de custo ausente');
  });

  it('permite carregar com "Todas as Empresas" (sem guard de ccId nulo)', () => {
    assert.ok(!src.includes('Selecione uma empresa para ver as conversas'), 'guard antigo de empresa ainda presente');
  });

  it('não assina realtime nem atualiza eventos pelo membro do usuário', () => {
    const rtSrc = extrairFuncao('_convSubscribeRealtime');
    assert.ok(!rtSrc.includes('if (!ccId) return;'), 'realtime ainda bloqueia empresa nula');
    assert.ok(!rtSrc.includes('conv.membro_id !== membroId'), 'INSERT realtime ainda filtra por membro');
    assert.ok(!rtSrc.includes('updated.membro_id !== membroId'), 'UPDATE realtime ainda filtra por membro');
  });
});

describe('Conversas · contatos não identificados', () => {
  it('_convUpdateStats conta conversas sem lead (não-grupos)', () => {
    const statsSrc = extrairFuncao('_convUpdateStats');
    assert.ok(statsSrc.includes('!c.is_group && !c.lead_id'), 'contador não usa lead_id');
    assert.ok(!statsSrc.includes('!c.assigned_to'), 'contador ainda usa assigned_to');
    assert.ok(!statsSrc.includes('getCurrentUserId()'), 'stats não deve depender de getCurrentUserId');
    assert.ok(statsSrc.includes('[Conversas] Stats:'), 'log de stats ausente');
  });

  it('_convApplyFilter usa a mesma regra de lead no filtro', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    assert.ok(filterSrc.includes('!c.is_group && !c.lead_id'), 'filtro unidentified não usa lead_id');
  });

  it('filtra de verdade por lead ausente (comportamento)', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    const makeFilter = new Function(
      'conversasState', 'matchBuscaTexto', '_renderConvChatList', '_convUpdateStats', 'getCurrentUserId',
      `${filterSrc}; return _convApplyFilter;`
    );
    const chats = [
      { id: '1', is_group: false, lead_id: null, contact_name: 'Sem Lead', last_message: 'oi', last_message_at: '2026-10-07T10:00:00+00:00' },
      { id: '2', is_group: false, lead_id: 'lead-1', contact_name: 'Com Lead', last_message: 'oi', last_message_at: '2026-10-07T10:00:00+00:00' },
      { id: '3', is_group: true, lead_id: null, contact_name: 'Grupo' },
      { id: '4', is_group: false, lead_id: null, contact_name: 'Vazia Sem Lead' },
    ];
    const conversasState = { allChats: chats, filter: 'unidentified', searchTerm: '' };
    const apply = makeFilter(conversasState, () => true, () => {}, () => {}, () => null);
    apply();
    assert.deepEqual(conversasState.chats.map(c => c.id), ['1']);
  });

  it('ordena por last_message_at decrescente (ordem cronológica real)', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    const makeFilter = new Function(
      'conversasState', 'matchBuscaTexto', '_renderConvChatList', '_convUpdateStats', 'getCurrentUserId',
      `${filterSrc}; return _convApplyFilter;`
    );
    const conversasState = {
      allChats: [
        { id: 'old', last_message_at: '2026-10-01T10:00:00+00:00', is_group: false, lead_id: null },
        { id: 'new', last_message_at: '2026-10-07T10:00:00+00:00', is_group: false, lead_id: null },
        { id: 'mid', last_message_at: '2026-10-04T10:00:00+00:00', is_group: false, lead_id: null },
      ],
      filter: 'all',
      searchTerm: '',
    };
    const apply = makeFilter(conversasState, () => false, () => {}, () => {}, () => null);
    apply();
    assert.deepEqual(conversasState.chats.map(c => c.id), ['new', 'mid', 'old']);
  });

  it('recalcula contadores ao aplicar filtro', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    assert.ok(filterSrc.includes('_convUpdateStats()'), '_convApplyFilter não atualiza stats');
  });
});

describe('Conversas · busca por conteúdo de mensagens', () => {
  it('busca conteúdo via ilike em content_text', () => {
    const searchSrc = extrairFuncao('_convSearchMessagesContent');
    assert.ok(searchSrc.includes(`ilike('content_text'`), 'ilike em content_text ausente');
    assert.ok(searchSrc.includes('new Set('), 'resultado não vira Set de conversation_id');
  });

  it('lista casa por conteúdo ou por nome/telefone', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    const makeFilter = new Function(
      'conversasState', 'matchBuscaTexto', '_renderConvChatList', '_convUpdateStats', 'getCurrentUserId',
      `${filterSrc}; return _convApplyFilter;`
    );
    const conversasState = {
      allChats: [
        { id: '1', _conversationId: 'conv-1', contact_name: 'Maria', contact_phone: '5585999999999', last_message: 'oi' },
        { id: '2', _conversationId: 'conv-2', contact_name: 'Jose', contact_phone: '5585888888888', last_message: 'tchau' },
      ],
      filter: 'all',
      searchTerm: 'prazer',
      _searchContentIds: new Set(['conv-2']),
    };
    const matchStub = (term, campos) => campos.textos.some(t => String(t || '').includes(term));
    const apply = makeFilter(conversasState, matchStub, () => {}, () => {}, () => null);
    apply();
    assert.deepEqual(conversasState.chats.map(c => c.id), ['2']);
  });
});

describe('Conversas · sincronização de histórico', () => {
  it('botão de refresh dispara a importação de histórico', () => {
    const syncSrc = extrairFuncao('_convSyncContactsAndReload');
    assert.ok(syncSrc.includes('waSyncHistory('), '_convSyncContactsAndReload não chama waSyncHistory');
    assert.ok(syncSrc.includes(`'chats'`), 'etapa de lista de chats ausente');
    assert.ok(syncSrc.includes(`'messages'`), 'etapa de páginas de mensagens ausente');
    assert.ok(syncSrc.includes('setProgress'), 'progresso não é exibido');
  });

  it('serviço client expõe waSyncHistory', () => {
    assert.ok(waSource.includes('async function waSyncHistory'), 'waSyncHistory ausente em whatsapp-service.js');
    assert.ok(waSource.includes('window.waSyncHistory = waSyncHistory'), 'waSyncHistory não exportado em window');
  });

  it('Edge function wa-sync-history usa findMessages com paginação e dedup por message_id', () => {
    assert.ok(historyFnSource.includes('/chat/findMessages/'), 'rota findMessages ausente');
    assert.ok(historyFnSource.includes('message_id'), 'dedup por message_id ausente');
    assert.ok(historyFnSource.includes('PAGE_SIZE'), 'paginação ausente');
  });

  it('chats não deriva telefone do id interno (usa resolveChatJid)', () => {
    assert.ok(historyFnSource.includes('resolveChatJid('), 'resolveChatJid ausente');
    assert.ok(!/const rawId = String\(chat\?\.id/.test(historyFnSource), 'rawId ainda prefere chat.id (ObjectId)');
    assert.ok(historyFnSource.includes('resolveMessagePhone('), 'resolveMessagePhone ausente (lid sem alt não vira lixo)');
  });

  it('mensagens de grupo sem participant ainda guardam o remetente (senderRepaired)', () => {
    assert.ok(historyFnSource.includes('senderRepair'), 'reparo de remetente ausente');
    assert.ok(historyFnSource.includes('refresh_conversation_last_message'), 'refresh de última mensagem ausente');
  });

  it('loadTenantMaps pagina contatos/conversas (sem truncar no limite de 1000 do PostgREST)', () => {
    assert.ok(historyFnSource.includes('fetchTenantRows'), 'helper de paginação ausente');
    assert.ok(/fetchTenantRows\([\s\S]*?\.range\(from, from \+ pageSize - 1\)/.test(historyFnSource), 'range de paginação ausente');
    assert.ok(historyFnSource.includes("fetchTenantRows(supabase, 'contacts'"), 'contatos não usam o helper paginado');
    assert.ok(historyFnSource.includes("fetchTenantRows(supabase, 'conversations'"), 'conversas não usam o helper paginado');
  });

  it('findOrCreate* retorna created/remoteJid para contadores e patches corretos', () => {
    assert.ok(historyFnSource.includes('Promise<{ id: string; created: boolean }>'), 'retorno created ausente');
    assert.ok(historyFnSource.includes('remoteJid: existing.remote_jid || \'\''), 'remote_jid real não é retornado p/ conversa existente');
    assert.ok(historyFnSource.includes('if (contactRes.created) createdContacts++'), 'contador de contatos ainda conta mapa-vazio');
  });

  it('webhook resolve lid via remoteJidAlt e usa pushName como remetente de grupo', () => {
    assert.ok(webhookSource.includes('remoteJidAlt'), 'webhook não consulta remoteJidAlt');
    assert.ok(webhookSource.includes('usablePushName'), 'webhook sem fallback de pushName p/ grupo');
    assert.ok(webhookSource.includes('g?.remoteJid || g?.jid || g?.id'), 'groups.update ainda prefere id interno');
  });

  it('botão Criar lead existe na conversa e abre modal com nome/e-mail/telefone', () => {
    assert.ok(appSource.includes('btnConvCriarLead'), 'botão btnConvCriarLead ausente no header');
    assert.ok(appSource.includes('_convOpenCriarLeadModal'), 'handler de abertura do modal ausente');
    assert.ok(appSource.includes('convCriarLeadFromModal'), 'função de criação de lead ausente');
    assert.ok(appSource.includes('convCriarLeadName') && appSource.includes('convCriarLeadEmail') && appSource.includes('convCriarLeadPhone'), 'campos do modal incompletos');
    assert.ok(appSource.includes("invoke('sync-contact-to-lead'"), 'fluxo não usa a Edge Function sync-contact-to-lead');
  });

  it('sync-contact-to-lead aceita nome/e-mail/telefone e vincula todas as conversas do contato', () => {
    assert.ok(syncLeadSource.includes('nome, email, telefone'), 'parâmetros nome/email/telefone ausentes');
    assert.ok(syncLeadSource.includes('email: emailLead'), 'e-mail não é gravado no lead');
    assert.ok(/from\('conversations'\)[\s\S]{0,200}?eq\('contact_id', contactId\)/.test(syncLeadSource), 'vínculo de conversa ausente');
    assert.ok(!/eq\('contact_id', contactId\)\s*\.eq\('status', 'open'\)/.test(syncLeadSource), 'vínculo restrito a conversas abertas');
  });
});

describe('Conversas · histórico paginado (scroll para cima)', () => {
  it('_convQueryMsgPage busca decrescente com limit e corte por created_at', () => {
    const src = extrairFuncao('_convQueryMsgPage');
    assert.ok(src.includes('ascending: false'), 'paginação deve ordenar decrescente');
    assert.ok(src.includes('.limit(CONV_MSG_PAGE)'), 'limit da página ausente');
    assert.ok(src.includes(`.lt('created_at', before)`), 'corte da página anterior ausente');
  });

  it('_convLoadOlderMessages prepensa antigas preservando o scroll', () => {
    const src = extrairFuncao('_convLoadOlderMessages');
    assert.ok(src.includes('_msgLoadingOlder'), 'guard de carregamento concorrente ausente');
    assert.ok(src.includes('_msgRenderScrollHeight'), 'preservação de scroll ausente');
    assert.ok(src.includes('[...older, ...st.messages]'), 'mensagens antigas não entram no início');
    assert.ok(src.includes('_msgHasMore = rows.length === CONV_MSG_PAGE'), 'limite de páginas não é derivado do tamanho');
  });

  it('_convLoadMessages só carrega a última página (não tudo)', () => {
    const src = extrairFuncao('_convLoadMessages');
    assert.ok(src.includes('_convQueryMsgPage(chatId, null)'), 'não usa a query paginada');
    assert.ok(src.includes('_msgHasMore'), 'não marca existência de mensagens anteriores');
    assert.ok(!src.includes(`ascending: true`), 'ainda busca tudo em ascendente');
  });

  it('renderização restaura o scroll quando há prepend', () => {
    const src = extrairFuncao('_renderConvMessages');
    assert.ok(src.includes('_msgRenderScrollHeight'), 'restore de scroll ausente');
    assert.ok(src.includes('prevTop + (container.scrollHeight - prevHeight)'), 'cálculo do restore incorreto');
  });

  it('initConversas amarra o scroll do chat ao carregamento de mensagens antigas', () => {
    assert.ok(appSource.includes('msgBox._convScrollBound'), 'listener de scroll não é idempotente');
    assert.ok(appSource.includes('msgBox.scrollTop <= 120'), 'gatilho de scroll topo ausente');
    assert.ok(appSource.includes('_convLoadOlderMessages()'), 'scroll não dispara carga de mensagens antigas');
  });
});

describe('Conversas · recarga da conversa aberta', () => {
  it('botão Atualizar recarrega a conversa aberta', () => {
    const syncSrc = extrairFuncao('_convSyncContactsAndReload');
    assert.ok(syncSrc.includes('_convReloadOpenChat(true)'), 'refresh não recarrega o chat aberto');
  });

  it('fallback de 15s recarrega o chat aberto apenas quando há mudança', () => {
    const rtSrc = extrairFuncao('_convSubscribeRealtime');
    assert.ok(rtSrc.includes('_convReloadOpenChat(false)'), 'fallback não recarrega o chat aberto');
  });

  it('_convReloadOpenChat compara a última mensagem antes de recarregar', () => {
    const src = extrairFuncao('_convReloadOpenChat');
    assert.ok(src.includes('remote === local'), 'comparação da última mensagem ausente');
    assert.ok(src.includes('_convLoadMessages'), 'não recarrega via _convLoadMessages');
    assert.ok(src.includes('!force'), 'modo manual não pula a comparação');
  });
});

describe('Conversas · identificação de contatos', () => {
  it('select da lista inclui remote_jid (fallback de telefone/título)', () => {
    const src = extrairFuncao('loadConversasChats');
    assert.ok(src.includes('remote_jid'), 'remote_jid ausente no select');
    assert.ok(src.includes('remoteJidDigits'), 'dígitos do remoteJid não são derivados');
  });

  it('título individual cai para o nome do lead antes do telefone', () => {
    const src = extrairFuncao('loadConversasChats');
    assert.ok(src.includes(`isGenericConvName(lead?.nome, phoneDigits)`), 'fallback de nome do lead ausente');
    assert.ok(src.includes(`'Contato sem identificação'`), 'fallback final ausente');
  });

  it('contact_phone usa remote_jid como último fallback', () => {
    const src = extrairFuncao('loadConversasChats');
    assert.ok(src.includes('contact.phone || remoteJidDigits'), 'contact_phone sem fallback de remote_jid');
  });
});

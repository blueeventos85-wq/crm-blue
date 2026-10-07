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
    assert.ok(src.includes(`if (ccId) q = q.eq('centros_custo_id', ccId)`), 'filtro condicional de centro de custo ausente');
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
  });

  it('_convApplyFilter usa a mesma regra de lead no filtro', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    assert.ok(filterSrc.includes('!c.is_group && !c.lead_id'), 'filtro unidentified não usa lead_id');
  });

  it('filtra de verdade por lead ausente (comportamento)', () => {
    const filterSrc = extrairFuncao('_convApplyFilter');
    const makeFilter = new Function(
      'conversasState', 'matchBuscaTexto', '_renderConvChatList', 'getCurrentUserId',
      `${filterSrc}; return _convApplyFilter;`
    );
    const chats = [
      { id: '1', is_group: false, lead_id: null, contact_name: 'Sem Lead' },
      { id: '2', is_group: false, lead_id: 'lead-1', contact_name: 'Com Lead' },
      { id: '3', is_group: true, lead_id: null, contact_name: 'Grupo' },
    ];
    const conversasState = { allChats: chats, filter: 'unidentified', searchTerm: '' };
    const apply = makeFilter(conversasState, () => true, () => {}, () => null);
    apply();
    assert.deepEqual(conversasState.chats.map(c => c.id), ['1']);
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
      'conversasState', 'matchBuscaTexto', '_renderConvChatList', 'getCurrentUserId',
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
    const apply = makeFilter(conversasState, matchStub, () => {}, () => null);
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
});

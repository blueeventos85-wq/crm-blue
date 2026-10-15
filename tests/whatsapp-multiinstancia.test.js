import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   WhatsApp multi-instância:
   - UI de listagem/vincular em Configurações > WhatsApp
   - service: waFetchAllConfigs / waInstanceLink / waSetWebhook
   - Edge Function wa-instance-link + eventos do webhook
   - banner de "instância não configurada" no filtro de Conversas
   - migration de diagnóstico + vínculo + RLS + backfill
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const serviceJs = readFileSync(join(root, 'src/lib/whatsapp/whatsapp-service.js'), 'utf8');
const connectFn = readFileSync(join(root, 'supabase/functions/evolution-connect/index.ts'), 'utf8');
const linkFn = readFileSync(join(root, 'supabase/functions/wa-instance-link/index.ts'), 'utf8');
const webhookFn = readFileSync(join(root, 'supabase/functions/evolution-webhook/index.ts'), 'utf8');
const mediaProxyFn = readFileSync(join(root, 'supabase/functions/evolution-media-proxy/index.ts'), 'utf8');
const migration = readFileSync(join(root, 'Colunas:Tabelas/migration_whatsapp_multinstance_fix.sql'), 'utf8');
const migrationBlueproFix = readFileSync(join(root, 'Colunas:Tabelas/migration_bluepro_webhook_fix.sql'), 'utf8');
const syncContactsFn = readFileSync(join(root, 'supabase/functions/wa-sync-contacts/index.ts'), 'utf8');
const syncHistoryFn = readFileSync(join(root, 'supabase/functions/wa-sync-history/index.ts'), 'utf8');

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

describe('UI multi-instância (Configurações > WhatsApp)', () => {
  it('index.html tem lista de instâncias + form de vínculo', () => {
    for (const id of ['waInstancesList', 'waInstancesCount', 'waLinkInstanceForm',
      'waLinkCentroCustoSelect', 'waLinkInstanceName', 'waLinkNumero',
      'waLinkInstanceBtn', 'waNewInstanceBtn', 'waLinkSubmitBtn', 'waLinkCancelBtn']) {
      assert.ok(indexHtml.includes(`id="${id}"`), `elemento #${id} ausente no index.html`);
    }
  });

  it('initWhatsAppConfig carrega a lista e binda as ações', () => {
    const corpo = extractFn(appJs, 'async function initWhatsAppConfig()');
    assert.ok(corpo, 'initWhatsAppConfig ausente');
    assert.ok(corpo.includes('waLoadInstances()'), 'não carrega a lista de instâncias');
    assert.ok(corpo.includes("getElementById('waLinkInstanceBtn')"), 'botão de vincular sem bind');
    assert.ok(corpo.includes("getElementById('waNewInstanceBtn')"), 'botão de nova instância sem bind');
    assert.ok(corpo.includes("data-action"), 'sem delegação de ações na lista');
  });

  it('waLoadInstances renderiza cards com empresa, status e ações', () => {
    const corpo = extractFn(appJs, 'async function waLoadInstances()');
    assert.ok(corpo, 'waLoadInstances ausente');
    assert.ok(corpo.includes('waFetchAllConfigs'), 'não usa waFetchAllConfigs');
    assert.ok(corpo.includes('data-action="select"'), 'card sem ação Selecionar');
    assert.ok(corpo.includes('data-action="sync"'), 'card sem ação Sincronizar');
    assert.ok(corpo.includes('data-action="unlink"'), 'card sem ação Desvincular');
    assert.ok(corpo.includes('provider_config?.instanceName'), 'card sem nome da instância');
  });

  it('waHandleLinkInstance chama waInstanceLink e recarrega', () => {
    const corpo = extractFn(appJs, 'async function waHandleLinkInstance()');
    assert.ok(corpo, 'waHandleLinkInstance ausente');
    assert.ok(corpo.includes('waInstanceLink('), 'não chama waInstanceLink');
    assert.ok(corpo.includes('waLoadInstances()'), 'não recarrega a lista após vincular');
    assert.ok(corpo.includes('waLoadStatus()'), 'não atualiza o status após vincular');
    assert.ok(corpo.includes('waLinkCentroCustoSelect'), 'não lê o select de empresa do form de vínculo');
  });

  it('waHandleSyncInstance usa waSetWebhook e waHandleUnlinkInstance usa waUnlinkInstance', () => {
    const sync = extractFn(appJs, 'async function waHandleSyncInstance(');
    assert.ok(sync, 'waHandleSyncInstance ausente');
    assert.ok(sync.includes('waSetWebhook('), 'sync não usa waSetWebhook');
    const unlink = extractFn(appJs, 'async function waHandleUnlinkInstance(');
    assert.ok(unlink, 'waHandleUnlinkInstance ausente');
    assert.ok(unlink.includes('waUnlinkInstance('), 'unlink não usa waUnlinkInstance');
    assert.ok(unlink.includes('confirm('), 'unlink sem confirmação');
  });
});

describe('whatsapp-service: multi-instância', () => {
  it('expõe waFetchAllConfigs, waInstanceLink, waSetWebhook e waUnlinkInstance', () => {
    for (const fn of ['waFetchAllConfigs', 'waInstanceLink', 'waSetWebhook', 'waUnlinkInstance']) {
      assert.ok(serviceJs.includes(`window.${fn} = ${fn}`), `window.${fn} não exposto`);
      assert.ok(new RegExp(`async function ${fn}\\(`).test(serviceJs), `function ${fn} ausente`);
    }
  });

  it('waFetchAllConfigs lista configs por CC do membro ou fallback membro_id', () => {
    const corpo = extractFn(serviceJs, 'async function waFetchAllConfigs(');
    assert.ok(corpo, 'waFetchAllConfigs ausente');
    assert.ok(corpo.includes('membro_centros_custo'), 'não usa o pivot de empresas');
    assert.ok(corpo.includes('centros_custo_id.in.'), 'não filtra por CCs do membro');
    assert.ok(corpo.includes('membro_id.eq.'), 'sem fallback por membro_id');
  });

  it('waInstanceLink valida nome/CC e chama a Edge Function wa-instance-link', () => {
    const corpo = extractFn(serviceJs, 'async function waInstanceLink(');
    assert.ok(corpo, 'waInstanceLink ausente');
    assert.ok(corpo.includes('instanceName é obrigatório'), 'sem validação de nome');
    assert.ok(corpo.includes('centrosCustoId é obrigatório'), 'sem validação de CC');
    assert.ok(corpo.includes("waInvokeFunction('wa-instance-link'"), 'não chama wa-instance-link');
    assert.ok(corpo.includes('numero'), 'não repassa o número');
  });

  it('waConnect repassa integration e faz trim do instanceName', () => {
    const corpo = extractFn(serviceJs, 'async function waConnect(');
    assert.ok(corpo, 'waConnect ausente');
    assert.ok(corpo.includes('integration'), 'não repassa integration');
    assert.ok(corpo.includes('.trim()'), 'não normaliza o nome da instância');
    assert.ok(corpo.includes('integration: cleanIntegration'), 'não envia integration no payload');
  });
});

describe('Edge Functions (webhook + vínculo)', () => {
  it('evolution-connect inscreve os eventos completos do webhook', () => {
    for (const ev of ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT',
      'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'GROUPS_UPDATE', 'CONTACTS_UPDATE']) {
      assert.ok(connectFn.includes(`'${ev}'`), `evento ${ev} ausente no evolution-connect`);
    }
    assert.ok(connectFn.includes('body.integration'), 'evolution-connect não lê integration do body');
    assert.ok(connectFn.includes('.trim()'), 'evolution-connect não normaliza instanceName');
  });

  it('wa-instance-link valida instância na Evolution e registra webhook', () => {
    assert.ok(linkFn.includes('connectionState'), 'não consulta o estado da instância');
    assert.ok(linkFn.includes('setWebhook'), 'não registra o webhook');
    assert.ok(linkFn.includes('/functions/v1/evolution-webhook'), 'webhook não aponta para a função certa');
    assert.ok(linkFn.includes('connectionState'), 'sem fallback de estado');
    for (const ev of ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT',
      'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONTACTS_UPDATE']) {
      assert.ok(linkFn.includes(`'${ev}'`), `evento ${ev} ausente no wa-instance-link`);
    }
  });

  it('wa-instance-link faz upsert em whatsapp_config com CC e status', () => {
    assert.ok(linkFn.includes("from('whatsapp_config')"), 'não acessa whatsapp_config');
    assert.ok(linkFn.includes('centros_custo_id'), 'não grava o vínculo com a empresa');
    assert.ok(linkFn.includes('mapStatus'), 'não mapeia o state da Evolution para status');
    assert.ok(linkFn.includes('409'), 'sem recusa de conflito de vínculo');
    assert.ok(linkFn.includes("provider: 'evolution_api'"), 'insert sem provider correto');
  });
});

describe('Filtro de Conversas — instância não configurada', () => {
  it('loadConversasChats marca se há instância vinculada', () => {
    const corpo = extractFn(appJs, 'async function loadConversasChats()');
    assert.ok(corpo, 'loadConversasChats ausente');
    assert.ok(corpo.includes('_waConfigHasInstance'), 'não marca a presença de instância');
    assert.ok(corpo.includes('waFetchConfig'), 'não busca a config da empresa');
  });

  it('estado da tela guarda selectedCentroCustoNome e _waConfigHasInstance', () => {
    const iState = appJs.indexOf('const conversasState = {');
    assert.ok(iState > -1, 'conversasState ausente');
    const bloco = appJs.slice(iState, iState + 1200);
    assert.ok(bloco.includes('selectedCentroCustoNome'), 'sem selectedCentroCustoNome');
    assert.ok(bloco.includes('_waConfigHasInstance'), 'sem _waConfigHasInstance');
  });

  it('_renderConvChatList mostra banner com link para Configurações > WhatsApp', () => {
    const corpo = extractFn(appJs, 'function _renderConvChatList()');
    assert.ok(corpo, '_renderConvChatList ausente');
    assert.ok(corpo.includes('_waConfigHasInstance'), 'não verifica a instância no vazio');
    assert.ok(corpo.includes('convEmptyWaConfigBtn'), 'sem botão para abrir as configurações');
    assert.ok(corpo.includes('data-settings-tab="whatsapp"'), 'sem navegação para a aba WhatsApp');
  });
});

describe('Migration whatsapp multi-instância', () => {
  it('tem diagnóstico, vínculo da crm gisele, RLS e backfill', () => {
    assert.ok(migration.includes('crm gisele'), 'sem menção à instância crm gisele');
    assert.ok(migration.includes('Blue PRO'), 'sem menção à empresa Blue PRO');
    assert.ok(migration.includes('conversations_select'), 'não recria a policy de SELECT');
    assert.ok(migration.includes('membro_centros_custo'), 'SELECT não permite acesso por empresa');
    assert.ok(migration.includes('messages_select'), 'não recria messages_select');
    assert.ok(migration.includes('is_admin()'), 'policy sem caminho de admin');
    assert.ok(migration.includes('centros_custo_id IS NULL'), 'backfill não mira conversas órfãs');
    assert.ok(migration.includes('NOT EXISTS'), 'backfill sem guarda de contatos já vinculados');
  });

  it('diagnóstico lista configs por empresa e policies', () => {
    assert.ok(migration.includes('FROM whatsapp_config'), 'sem SELECT de diagnóstico das configs');
    assert.ok(migration.includes('pg_policies'), 'sem verificação das policies');
  });

  it('remove a instância órfã "gisele" sem empresa', () => {
    assert.ok(migration.includes("instanceName' = 'gisele'"), 'sem DELETE da instância gisele órfã');
    assert.ok(migration.includes('centros_custo_id IS NULL'), 'DELETE da gisele sem guarda de CC nulo');
  });
});

describe('Fila da empresa: conversas sem dono visíveis', () => {
  it('query lista direto de conversations, sem depender de leads', () => {
    const corpo = extractFn(appJs, 'async function loadConversasChats()');
    assert.ok(corpo, 'loadConversasChats ausente');
    assert.ok(corpo.includes("from('conversations')"), 'query principal não é em conversations');
    // A query de conversas roda ANTES e independentemente do fetch de leads.
    const iConv = corpo.indexOf('doConvQuery(');
    const iLeads = corpo.indexOf('lead_ids brutos');
    assert.ok(iConv > -1 && iLeads > -1, 'marcadores ausentes');
    assert.ok(iConv < iLeads, 'fetch de leads acontece antes da query de conversas');
  });

  it('query de conversas: Admin/Marketing veem tudo; demais veem as suas + NULL', () => {
    const corpo = extractFn(appJs, 'async function loadConversasChats()');
    assert.ok(corpo, 'loadConversasChats ausente');
    assert.ok(corpo.includes("'Marketing'"), 'não considera perfil Marketing com visão total');
    assert.ok(corpo.includes("'Administrador'"), 'não considera perfil Administrador');
    assert.ok(corpo.includes('hasFullView'), 'sem variável de visão total');
    assert.ok(corpo.includes('membro_id.is.null'), 'query não inclui conversas sem dono');
    assert.ok(corpo.includes('membro_id.eq.${membroId}'), 'query não inclui conversas do usuário');
    assert.ok(corpo.includes('if (!hasFullView)'), 'filtro de membro não é condicional à visão total');
    assert.ok(corpo.includes('.or(`membro_id.eq.${membroId},membro_id.is.null`)'),
      'filtro OR membro_id não aplicado na query');
  });

  it('filtro "Minhas" inclui conversas sem atribuição', () => {
    const apply = extractFn(appJs, 'function _convApplyFilter()');
    assert.ok(apply, '_convApplyFilter ausente');
    assert.ok(apply.includes("f === 'mine'"), 'filtro mine ausente');
    assert.ok(apply.includes('|| !c.assigned_to'), 'filtro mine esconde conversas sem dono');
  });
});

describe('Conversas novas não nascem arquivadas', () => {
  const webhook = readFileSync(join(root, 'supabase/functions/evolution-webhook/index.ts'), 'utf8');
  const syncHistory = readFileSync(join(root, 'supabase/functions/wa-sync-history/index.ts'), 'utf8');
  const syncContacts = readFileSync(join(root, 'supabase/functions/wa-sync-contacts/index.ts'), 'utf8');

  it('findOrCreateConversation grava is_archived: false no insert', () => {
    const fn = webhook.slice(webhook.indexOf('async function findOrCreateConversation'));
    assert.ok(fn.includes('is_archived: false'), 'insert de conversa sem is_archived: false');
  });

  it('wa-sync-history grava is_archived: false no insert de conversa', () => {
    assert.ok(syncHistory.includes('is_archived: false'), 'sync-history insert sem is_archived: false');
  });

  it('wa-sync-contacts grava is_archived: false no insert de grupo', () => {
    assert.ok(syncContacts.includes('is_archived: false'), 'sync-contacts insert sem is_archived: false');
  });
});

describe('Webhook CHATS_UPSERT + nomes com espaço', () => {
  it('CHATS_UPSERT inscrito em evolution-connect e wa-instance-link', () => {
    assert.ok(connectFn.includes("'CHATS_UPSERT'"), 'CHATS_UPSERT ausente no evolution-connect');
    assert.ok(linkFn.includes("'CHATS_UPSERT'"), 'CHATS_UPSERT ausente no wa-instance-link');
  });

  it('evolution-webhook trata chats.upsert (cria conversa + nome/foto)', () => {
    assert.ok(webhookFn.includes("'chats.upsert' || event === 'CHATS_UPSERT'") ||
      webhookFn.includes("'CHATS_UPSERT'"), 'webhook sem handler de CHATS_UPSERT');
    assert.ok(webhookFn.includes('findOrCreateConversation'), 'chats.upsert não garante a conversa');
    assert.ok(webhookFn.includes('findOrCreateContact') || webhookFn.includes('findOrCreateGroupContact'),
      'chats.upsert não resolve o contato');
  });

  it('setWebhook no wa-instance-link envia instanceName e URL da webhook', () => {
    assert.ok(linkFn.includes('instanceName,'), 'setWebhook sem instanceName no body');
    assert.ok(linkFn.includes('/functions/v1/evolution-webhook'), 'webhook URL ausente');
  });

  it('nomes com espaço são encodeURIComponent nas rotas da Evolution', () => {
    assert.ok(linkFn.includes('encodeURIComponent(instanceName)'), 'wa-instance-link sem encoding');
    assert.ok(connectFn.includes('encodeURIComponent(instanceName)'), 'evolution-connect sem encoding no QR');
    assert.ok(mediaProxyFn.includes('encodeURIComponent(instanceName)'), 'media-proxy sem encoding no fallback');
  });
});

describe('Normalização de instanceName no webhook (crm gisele)', () => {
  it('evolution-webhook tem normInstance e usa nos 3 pontos de resolução', () => {
    assert.ok(webhookFn.includes('function normInstance('), 'webhook sem normInstance');
    // normInstance deve ser chamado em todos os finds de config por instanceName
    const finds = webhookFn.match(/normInstance\(pcfg\.instanceName\)/g) || [];
    assert.ok(finds.length >= 3, `normInstance aplicado em apenas ${finds.length} finds (esperado >= 3)`);
  });

  it('normInstance decodifica, trimma e lowercase', () => {
    const corpo = webhookFn.slice(webhookFn.indexOf('function normInstance('));
    assert.ok(corpo.includes('decodeURIComponent'), 'normInstance sem decodeURIComponent');
    assert.ok(corpo.includes('.trim()'), 'normInstance sem trim');
    assert.ok(corpo.includes('.toLowerCase()'), 'normInstance sem toLowerCase');
  });

  it('instanceName é normalizado logo após o parse do body', () => {
    assert.ok(webhookFn.includes('const instanceName = normInstance('), 'instanceName não normalizado no parse');
  });

  it('wa-instance-link tem normInstance e aplica nos finds de conflito', () => {
    assert.ok(linkFn.includes('function normInstance('), 'link sem normInstance');
    assert.ok(linkFn.includes('normInstance(c.provider_config?.instanceName)'), 'link sem normalizar no find');
  });

  it('evolution-connect tem normInstance e aplica no check de instância existente', () => {
    assert.ok(connectFn.includes('function normInstance('), 'connect sem normInstance');
    assert.ok(connectFn.includes('normInstance(pcfg.instanceName)'), 'connect sem normalizar no check');
  });
});

describe('Migration Blue PRO webhook fix', () => {
  it('reverte conversa da Elizabeth para Blue Eventos', () => {
    assert.ok(migrationBlueproFix.includes("150f140a-4868-4782-999e-9f78f3df84fa"),
      'sem referência ao id da conversa');
    assert.ok(migrationBlueproFix.includes('1918169e-d620-45f8-ba42-79a942e2ace0'),
      'sem referência ao CC da Blue Eventos');
  });

  it('normaliza instanceName e garante config da Blue PRO', () => {
    assert.ok(migrationBlueproFix.includes("'%20'"), 'sem decode de %20');
    assert.ok(migrationBlueproFix.includes("'crm gisele'"), 'sem menção a crm gisele');
    assert.ok(migrationBlueproFix.includes('f6b86575-6f66-4786-a220-451fcf10db36'),
      'sem referência ao CC da Blue PRO');
    assert.ok(migrationBlueproFix.includes('INSERT INTO whatsapp_config'), 'sem insert de config');
  });

  it('tem backfill e diagnóstico', () => {
    assert.ok(migrationBlueproFix.includes('UPDATE conversations'), 'sem backfill de conversas');
    assert.ok(migrationBlueproFix.includes('NOT EXISTS'), 'backfill sem guarda de contatos de outra empresa');
    assert.ok(migrationBlueproFix.includes('DIAGNÓSTICO'), 'sem seção de diagnóstico');
  });
});

describe('wa-sync-history e wa-sync-contacts injetam centros_custo_id', () => {
  it('wa-sync-history grava ccId nas conversas importadas', () => {
    assert.ok(syncHistoryFn.includes('centros_custo_id'), 'sync-history sem centros_custo_id');
    assert.ok(syncHistoryFn.includes('ccId'), 'sync-history sem variável ccId');
    assert.ok(syncHistoryFn.includes('is_archived: false'), 'sync-history sem is_archived: false');
  });

  it('wa-sync-contacts grava ccId nas conversas de grupo', () => {
    assert.ok(syncContactsFn.includes('centros_custo_id'), 'sync-contacts sem centros_custo_id');
    assert.ok(syncContactsFn.includes('ccId'), 'sync-contacts sem variável ccId');
  });

  it('ambos buscam config por centros_custo_id (não por instanceName)', () => {
    assert.ok(syncHistoryFn.includes(".eq('centros_custo_id', centrosCustoId)"),
      'sync-history não busca config por CC');
    assert.ok(syncContactsFn.includes(".eq('centros_custo_id', centrosCustoId)") ||
      syncContactsFn.includes('centrosCustoId'), 'sync-contacts não usa CC');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Multi-tenancy de conversas (remote_jid × centros_custo_id):
   - Mesmo número pode existir em empresas diferentes
   - UNIQUE composto (remote_jid, centros_custo_id, membro_id)
   - Lookup do webhook/sync sempre tenant-scoped
   - Realtime do frontend filtra por CC ativo
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(join(root, 'app.js'), 'utf8');
const serviceJs = readFileSync(join(root, 'src/lib/whatsapp/whatsapp-service.js'), 'utf8');
const webhookFn = readFileSync(join(root, 'supabase/functions/evolution-webhook/index.ts'), 'utf8');
const syncHistoryFn = readFileSync(join(root, 'supabase/functions/wa-sync-history/index.ts'), 'utf8');
const migration = readFileSync(join(root, 'Colunas:Tabelas/migration_conv_remote_jid_multitenant.sql'), 'utf8');

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

// Para funções com assinatura ": Promise<...> {" (sem ") {"), extrai por
// brace-matching a partir do "{" FINAL da assinatura (após "> {" do Promise).
function extractFnPromise(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  // Fim da assinatura: "> {" (Promise) ou ") {" (sem retorno tipado)
  let braceStart = source.indexOf('> {', start + header.length);
  const parenBrace = source.indexOf(') {', start + header.length);
  if (parenBrace !== -1 && (braceStart === -1 || parenBrace < braceStart)) {
    braceStart = parenBrace + 1; // posição do "{"
  } else if (braceStart !== -1) {
    braceStart += 2; // posição do "{"
  }
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

describe('Migration: UNIQUE composto remote_jid × CC × membro', () => {
  it('cria o índice único com as 3 colunas e guarda NULL', () => {
    assert.ok(migration.includes('conversations_rjid_cc_membro_unique'), 'sem nome do índice');
    assert.ok(migration.includes('ON conversations(remote_jid, centros_custo_id, membro_id)'),
      'índice não é composto pelas 3 colunas');
    assert.ok(migration.includes('WHERE remote_jid IS NOT NULL'), 'sem guarda de remote_jid NOT NULL');
  });

  it('dedupe arquiva duplicatas em vez de apagar', () => {
    assert.ok(migration.includes('ROW_NUMBER()'), 'sem CTE de ranking');
    assert.ok(migration.includes('is_archived = true'), 'dedupe não arquiva');
    assert.ok(migration.includes("status = 'closed'"), 'dedupe não fecha conversas');
    assert.ok(!/DELETE\s+FROM\s+conversations/i.test(migration), 'dedupe apaga linhas');
  });

  it('tem diagnóstico antes e depois', () => {
    assert.ok(migration.includes('HAVING COUNT(*) > 1'), 'sem diagnóstico de duplicatas');
    assert.ok(migration.includes('pg_indexes'), 'sem verificação do índice criado');
  });
});

describe('evolution-webhook: lookup tenant-scoped', () => {
  const fn = extractFnPromise(webhookFn, 'async function findOrCreateConversation(');
  it('findOrCreateConversation existe e filtra centros_custo_id incondicionalmente', () => {
    assert.ok(fn, 'findOrCreateConversation ausente');
    assert.ok(fn.includes("q = q.eq('centros_custo_id', centrosCustoId)"),
      'centros_custo_id não é filtrado');
    // Não pode haver o padrão antigo: membro_id em else-if que OMITE o CC
    assert.ok(!fn.includes('} else if (centrosCustoId)'), 'CC ainda em else-if (omitido quando há membro)');
  });

  it('lookup prefere remote_jid + CC, com fallback contact_id', () => {
    assert.ok(fn.includes(".eq('remote_jid', groupJid)"), 'sem lookup por remote_jid');
    assert.ok(fn.includes(".eq('contact_id', contactId)"), 'sem fallback por contact_id');
    // remote_jid lookup deve vir ANTES do fallback de contact_id
    const iRj = fn.indexOf(".eq('remote_jid', groupJid)");
    const iCt = fn.indexOf(".eq('contact_id', contactId)");
    assert.ok(iRj > -1 && iCt > -1 && iRj < iCt, 'ordem dos lookups invertida');
  });

  it('preserva split por corretor (membro_id na query)', () => {
    assert.ok(fn.includes(".eq('membro_id', membroId)"), 'membro_id ausente no lookup');
  });

  it('trata corrida 23505 com re-lookup', () => {
    assert.ok(fn.includes("convError.code === '23505'"), 'sem captura de unique violation');
    assert.ok(fn.includes('raced'), 'sem re-lookup pós-corrida');
  });

  it('insert grava centros_custo_id + remote_jid', () => {
    assert.ok(fn.includes('if (centrosCustoId) insertPayload.centros_custo_id = centrosCustoId'),
      'insert sem CC');
    assert.ok(fn.includes('insertPayload.remote_jid'), 'insert sem remote_jid');
  });
});

describe('wa-sync-history: lookup tenant-scoped', () => {
  const fn = extractFnPromise(syncHistoryFn, 'async function findOrCreateConversation(');
  it('findOrCreateConversation filtra centros_custo_id incondicionalmente', () => {
    assert.ok(fn, 'findOrCreateConversation ausente');
    assert.ok(fn.includes("q = q.eq('centros_custo_id', centrosCustoId)"),
      'centros_custo_id não é filtrado');
    assert.ok(!fn.includes('} else if (centrosCustoId)'), 'CC ainda em else-if');
  });

  it('lookup prefere remote_jid efetivo, com fallback contact_id', () => {
    assert.ok(fn.includes('effectiveRjid'), 'sem variável de rjid efetivo');
    assert.ok(fn.includes(".eq('remote_jid', effectiveRjid)"), 'sem lookup por remote_jid');
    assert.ok(fn.includes(".eq('contact_id', contactId)"), 'sem fallback contact_id');
  });

  it('trata corrida 23505 com re-lookup', () => {
    assert.ok(fn.includes("convError.code === '23505'"), 'sem captura de 23505');
  });
});

describe('Frontend: realtime estrito por CC', () => {
  it('app.js filtra canal de conversations por centros_custo_id', () => {
    const corpo = extractFn(appJs, 'function _convSubscribeRealtime()');
    assert.ok(corpo, '_convSubscribeRealtime ausente');
    assert.ok(corpo.includes('centros_custo_id=eq.'), 'sem filtro de canal por CC');
    assert.ok(corpo.includes('convFilter'), 'sem variável de filtro');
    // As 2 ocorrências de table: conversations devem usar convFilter
    const convTableCount = (corpo.match(/table: 'conversations'/g) || []).length;
    assert.ok(convTableCount === 2, `esperado 2 listeners de conversations, achou ${convTableCount}`);
    assert.ok((corpo.match(/convFilter/g) || []).length >= 3, 'convFilter não aplicado nos listeners');
  });

  it('check client-side de CC permanece como dupla proteção', () => {
    const corpo = extractFn(appJs, 'function _convSubscribeRealtime()');
    assert.ok(corpo.includes('updated.centros_custo_id !== ccId'), 'guard de UPDATE sem check de CC');
    assert.ok(corpo.includes('conv.centros_custo_id !== ccId'), 'guard de INSERT sem check de CC');
  });

  it('whatsapp-service prioriza filtro por CC em conversas', () => {
    const corpo = extractFn(serviceJs, 'function waSubscribeToConversations(');
    assert.ok(corpo, 'waSubscribeToConversations ausente');
    assert.ok(corpo.includes('centrosCustoId'), 'sem uso do parâmetro de CC');
    assert.ok(corpo.includes('centros_custo_id=eq.'), 'sem filtro por CC');
    // CC deve vir ANTES do fallback membro_id
    const iCc = corpo.indexOf('centrosCustoId');
    const iFilter = corpo.indexOf('centros_custo_id=eq.');
    assert.ok(iCc > -1 && iFilter > -1, 'marcadores ausentes');
  });
});

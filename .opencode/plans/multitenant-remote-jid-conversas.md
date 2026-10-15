# Plano: Multi-tenancy de conversas — mesmo número em empresas diferentes

## Contexto (pesquisa atual)

- **Não existe UNIQUE em `conversations.remote_jid`** — só índice parcial não-único (`20260930200000_conversations_group_fields.sql:16`). Logo, o item "substituir constraint" vira **criar** o índice único composto.
- **Bug real no webhook** (`evolution-webhook/index.ts:1011-1022`): o lookup de conversa é `contact_id + status + (membro_id SE existir, SENÃO centros_custo_id)`. Quando a config tem `membro_id` (caso `crm gisele` → Gisele), **o filtro por `centros_custo_id` é omitido** → risco de reaproveitar conversa de outra empresa se o mesmo membro atua em mais de um CC. Mesmo padrão em `wa-sync-history/index.ts:429-439`.
- `findOrCreateContact` no webhook já filtra por `centros_custo_id` (`index.ts:870-871`) e `contacts` já tem `UNIQUE(centros_custo_id, phone)` parcial (`migration_fix_contacts_unique_constraint.sql`) — contatos já são multi-tenant-safe.
- **Frontend** (`app.js:16654+`): canal `conversas-realtime` não usa filtro de canal no servidor; o filtro por CC é só client-side (linhas 16725, 16748, 16803 — já corretos). `whatsapp-service.js:560,600` filtra Realtime só por `membro_id`, ignorando `centrosCustoId` recebido como parâmetro.
- **Decisão do usuário**: `UNIQUE(remote_jid, centros_custo_id, membro_id)` — preserva "Meu WhatsApp, meu lead" (1 conversa por corretor na mesma empresa) e isleta empresas.

## Alterações

### 1. Migration nova: `Colunas:Tabelas/migration_conv_remote_jid_multitenant.sql`

1. Diagnóstico: contar duplicatas atuais de `(remote_jid, centros_custo_id, membro_id)` com `remote_jid IS NOT NULL`.
2. Dedupe guardado (CTE `ranked`): para cada grupo duplicado com `status='open'`, manter a conversa mais recente (`last_message_at DESC NULLS LAST, created_at DESC`) e arquivar as demais (`is_archived=true, status='closed'`) — não apaga dados.
3. `CREATE UNIQUE INDEX IF NOT EXISTS conversations_rjid_cc_membro_unique ON conversations(remote_jid, centros_custo_id, membro_id) WHERE remote_jid IS NOT NULL;`
   - Postgres trata NULLs como distintos em UNIQUE → linhas legadas com `centros_custo_id`/`membro_id` NULL não bloqueiam a criação.
4. Diagnóstico final: listar índice criado + amostra de conversas por CC.

### 2. `supabase/functions/evolution-webhook/index.ts` — `findOrCreateConversation` (linha ~999)

Trocar o lookup por chave **sempre tenant-scoped**:

```
// Chave primária: remote_jid + centros_custo_id (+ membro_id p/ split por corretor)
query = conversations.select('id, lead_id, remote_jid')
  .eq('status', 'open')
if (centrosCustoId) query = query.eq('centros_custo_id', centrosCustoId)   // SEMPRE quando presente
if (groupJid)       query = query.eq('remote_jid', groupJid)
if (membroId)       query = query.eq('membro_id', membroId)
```

- **Fallback de legado** (quando `maybeSingle` não acha e existe `contact_id`): segunda query por `contact_id + centros_custo_id + membro_id + status=open` (para conversas antigas sem `remote_jid` gravado).
- Remover o `else if` que omitia `centros_custo_id` quando havia `membro_id`.
- No **insert**: manter gravação de `centros_custo_id`/`membro_id`/`remote_jid` como já faz (linhas 1079-1088) — já isolado.
- **Resiliência 23505** (unique violation na corrida): capturar erro do insert, re-executar o lookup e devolver o id existente em vez de falhar.
- `findOrCreateGroupContact` (linha ~936): aplicar o mesmo — `group_jid + centros_custo_id` sempre que o CC existir (hoje o CC é opcional no filtro).

### 3. `supabase/functions/wa-sync-history/index.ts` — `findOrCreateConversation` (linha ~418)

Mesma semântica do webhook: `centrosCustoId` sempre ANDado (nunca em `else`), lookup preferindo `remote_jid` quando a função já recebe `remoteJid`/`groupJid`, fallback por `contact_id`, e captura de 23505 com re-lookup.

### 4. Frontend

**`app.js` — `_convSubscribeRealtime` (linha 16654):**
- Quando `ccId` definido, adicionar filtro de canal no servidor nos listeners de `conversations` (INSERT e UPDATE): `filter: \`centros_custo_id=eq.${ccId}\`` — reforço do check client-side existente (16725/16748), reduz tráfego entre empresas.
- `messages` não tem coluna `centros_custo_id` → mantém check client-side + RLS (já tratado por `_convShouldReloadForConversation`, linha 16803).

**`src/lib/whatsapp/whatsapp-service.js`:**
- `waSubscribeToConversations` (linha 600): priorizar filtro `centros_custo_id=eq.${centrosCustoId}` quando informado; fallback `membro_id` (hoje inverte a prioridade).
- `waSubscribeToMessages` (linha 560): `messages` não tem coluna de CC → manter filtro por `membro_id` (sem mudança).

### 5. Testes (`tests/whatsapp-multiinstancia.test.js` ou novo `tests/multitenant-rjid.test.js`)

- Webhook: `findOrCreateConversation` contém `.eq('centros_custo_id'` incondicional + lookup por `remote_jid` + sem `else if` que omite CC.
- Sync-history: mesmo pattern.
- Migration: cria `conversations_rjid_cc_membro_unique` com as 3 colunas + `WHERE remote_jid IS NOT NULL`.
- App.js: canal de `conversations` usa `filter: centros_custo_id=` quando há `ccId`.
- WhatsApp-service: `waSubscribeToConversations` prioriza filtro por CC.

### 6. Verificação e deploy

1. `npm test` (esperado: todos verdes + novos testes).
2. `npm run build`.
3. Deploy das functions alteradas: `supabase functions deploy evolution-webhook` e `supabase functions deploy wa-sync-history` (requer CLI logado — se falhar, entregar instrução manual).
4. Migration: usuário roda `migration_conv_remote_jid_multitenant.sql` no SQL Editor (convenção do repo — arquivos em `Colunas:Tabelas/` são manuais).

## Arquivos

| Arquivo | Mudança |
|---|---|
| `Colunas:Tabelas/migration_conv_remote_jid_multitenant.sql` | novo |
| `supabase/functions/evolution-webhook/index.ts` | lookup + 23505 |
| `supabase/functions/wa-sync-history/index.ts` | lookup + 23505 |
| `app.js` | filtro de canal realtime por CC |
| `src/lib/whatsapp/whatsapp-service.js` | prioridade do filtro CC |
| `tests/multitenant-rjid.test.js` (ou existente) | novos testes |

## Fora de escopo

- Trocar `contacts` (já seguro com `contacts_ccid_phone_unique`).
- Mudar RLS (já permite CC+admin+NULL).
- Reescrever o fluxo "Meu WhatsApp, meu lead" (mantido via `membro_id` na composta).

# Plano · Reduzir egress do Supabase (conversas/mensagens WhatsApp)

Escopo aprovado: itens 1–5. Arquivo principal: `app.js`. Nenhuma alteração em dados, RLS ou migrations.

## Achados (resumo)

- `_convQueryMsgPage` (app.js:14027) já pagina corretamente: 80 linhas da conversa selecionada,
  ORDER BY `created_at DESC`, corte `lt('created_at', before)` no scroll — indexado por
  `idx_messages_conversation (conversation_id, created_at DESC)`.
- **Problema 1** — `loadConversasChats` (app.js:13127) roda a cada 15 s pelo polling
  (app.js:16401) e faz: lista completa de `conversations` (sem limit, com `metadata`),
  todos os `contacts` em chunks, e **`.from('leads').select(...)` sem filtro/limit
  (app.js:13247) → tabela `leads` inteira a cada 15 s**.
- **Problema 2** — handlers Realtime "conversa desconhecida" (app.js:16314 e 16390)
  chamam `loadConversasChats()` a cada evento de conversa fora do filtro → cascata de
  reloads completos.
- **Problema 3** — após cada envio (app.js:15077 e 15671) chama `_convLoadMessages`
  (80 linhas, reseta o histórico já carregado), embora o Realtime já injete a mensagem.
  `media_url` pode conter base64 de áudio (até 7 M chars) → payload caro.
- Menor: `_convSearchMessagesContent` (app.js:13389) não cancela a busca anterior.

## Alterações

1. **Leads filtrados** (`loadConversasChats`, app.js:13245-13256)
   - Substituir o select completo por `.in('id', chunk)` em chunks de 50 (mesmas colunas),
     com `if (signal.aborted) return;` entre chunks.
   - Mantém invariantes do teste: sem `.eq('membro_id', membroId)`.

2. **Polling 15 s inteligente** (`_convSubscribeRealtime`, app.js:16399-16406)
   - `.subscribe(status => conversasState.realtimeStatus = status)`.
   - No intervalo: sempre `_convReloadOpenChat(false)` (sonda de 1 linha);
     `loadConversasChats()` só quando `realtimeStatus !== 'SUBSCRIBED'`
     (fallback real) ou a cada 8 ticks (~2 min, rede de segurança).
   - Teste exige `_convReloadOpenChat(false)` no corpo da função — mantido.

3. **Realtime sem reload em cascata** (app.js:16314-16320 e 16390-16396)
   - Novo helper `_convMaybeReloadForUnknown(convId, origem)`:
     consulta 1 linha (`conversations.select('id, centros_custo_id').eq('id',…).maybeSingle()`
     — a RLS decide visibilidade), recarrega a lista só se visível e dentro do
     `selectedCentroCustoId`; coalescing de 2 s (máx. 1 reload por janela).

4. **Pós-envio incremental** (app.js:15077, 15671)
   - Novas `_convQueryRecent(convId, limit)` + `_convRefreshRecentMessages()`:
     busca as últimas 15 linhas com `CONV_MSG_COLS`, faz merge por `id`,
     reordena por `created_at`, atualiza `_msgOldestAt`, re-renderiza
     (scroll continua caindo para o fim — `app.js:14635`).
   - Fallback: em erro de coluna, cai para `_convLoadMessages` (comportamento atual).
   - Dedupe por `id` no handler de INSERT do Realtime (app.js:16324).

5. **Busca cancelável** (`_convSearchMessagesContent`, app.js:13389)
   - `AbortController` + `.abortSignal()` para cancelar a busca anterior;
     `ilike`, `limit(1000)` e demais comportamentos preservados.

## Verificação

- `npm test` (baseline: 293 passando).
- Manual: Network filtrado em `rest/v1/` na tela Conversas — sem mais
  `leads?select=` sem filtro a cada 15 s; `messages?limit=80` só ao abrir a
  conversa; envio gera 1 request de ~15 linhas; rolar para cima pagina.
- Dashboard Supabase → Usage → Egress para confirmar a queda.

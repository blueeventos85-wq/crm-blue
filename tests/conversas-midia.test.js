import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ===========================================================
   Testes de regressão: lentidão ao carregar fotos nas conversas
   -----------------------------------------------------------
   O problema: cada re-render reconstruía o HTML inteiro e resolvia
   TODAS as mídias da conversa em sequência (for...await), uma a uma
   pela Edge Function + Evolution API (0,3–0,5s por imagem), sem
   cache, sem limite de paralelismo e sem estado de erro — a foto
   ficava em "Carregando..." por vários segundos e ficava presa
   quando falhava.

   Estes testes garantem as invariantes estruturais:
      - lazy com IntersectionObserver (nada resolve fora da viewport);
      - paralelismo limitado + dedupe + cache em memória;
      - estado de erro com retry (nunca preso em Carregando);
      - miniatura (media_preview) para pintar a conversa na hora;
      - proxy com cache em Storage e sem expor URL/token em log;
      - imagens enviadas vão para Storage (sem base64 gigante na tabela).
   =========================================================== */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const appJs = read('app.js');
const proxyTs = read('supabase/functions/evolution-media-proxy/index.ts');
const webhookTs = read('supabase/functions/evolution-webhook/index.ts');
const sendTs = read('supabase/functions/evolution-send/index.ts');
const waService = read('src/lib/whatsapp/whatsapp-service.js');
const migration = read('supabase/migrations/20261005140000_messages_media_preview.sql');

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

/* ===========================================================
   app.js · lazy loading + cache + pool
   =========================================================== */
describe('app.js · resolução de mídia (lazy, cache, pool)', () => {
  const resolveAll = extractFn(appJs, 'function _resolveAllMedia(container)');

  it('_resolveAllMedia existe', () => {
    assert.ok(resolveAll, '_resolveAllMedia não encontrada');
  });

  it('não resolve em sequência (sem for...await por mídia)', () => {
    assert.ok(!/for\s*\(.*\bawait\b/.test(resolveAll),
      'a versão antiga percorria as mídias com for...await — uma por vez');
    assert.ok(!resolveAll.includes('await _convFetchMediaAsDataUrl'),
      'fetch da mídia não pode acontecer dentro do loop de render');
  });

  it('usa IntersectionObserver com a própria conversa como root', () => {
    assert.ok(resolveAll.includes('IntersectionObserver'),
      'sem observer a conversa só resolveria tudo de uma vez, como antes');
    assert.ok(resolveAll.includes('rootMargin'),
      'rootMargin pré-carrega o que está prestes a entrar na tela');
  });

  it('só observa elementos com data-src (nada de data-href solto)', () => {
    assert.ok(resolveAll.includes("querySelectorAll('[data-src]')"),
      'documentos migram para data-src; data-href não é mais observado');
    assert.ok(!resolveAll.includes('data-href'),
      'data-href ficou órfão e nunca seria resolvido');
  });

  it('marca o elemento como já observado (evita re-observe a cada render)', () => {
    assert.ok(resolveAll.includes('_convObserved'),
      'sem a marca o observer recebia os mesmos elementos em cada render');
  });

  it('cache, dedupe e pool existem', () => {
    assert.ok(appJs.includes('const CONV_MEDIA_POOL'), 'pool de paralelismo ausente');
    assert.ok(appJs.includes('_convMediaCache'), 'cache em memória ausente');
    assert.ok(appJs.includes('_convMediaPending'), 'dedupe de requisições em voo ausente');
    assert.ok(/_convMediaActive\s*>=\s*CONV_MEDIA_POOL/.test(appJs),
      'sem limite de slot o navegador abriria dezenas de conexões');
  });

  it('o cache é LRU com teto (não pode crescer sem fim com blob URL)', () => {
    const set = extractFn(appJs, 'function _convMediaCacheSet(key, src, opts = {})');
    assert.ok(set, '_convMediaCacheSet não encontrada');
    assert.ok(set.includes('CONV_MEDIA_CACHE_MAX'), 'sem teto o cache vaza memória');
    assert.ok(set.includes('revokeObjectURL') || appJs.includes('revokeObjectURL'),
      'blob URL fora do cache precisa ser revogada');
  });

  it('falha vira estado explícito e permite retry (nunca preso em Carregando)', () => {
    const fail = extractFn(appJs, 'function _convMediaFail(el)');
    const retry = extractFn(appJs, 'function _convMediaRetry(el)');
    assert.ok(fail && retry, 'estado de erro/retry ausente');
    assert.ok(fail.includes("dataset.state = 'error'"), 'erro não é anunciado no elemento');
    assert.ok(retry.includes('_convMediaCache.delete'), 'retry não limpa a falha do cache');
    assert.ok(retry.includes('_convMediaRequest'), 'retry não recarrega a mídia');
  });

  it('a falha expira sozinha (backoff automático sem clicar)', () => {
    const get = extractFn(appJs, 'function _convMediaCacheGet(key)');
    assert.ok(get.includes('errorUntil'), 'sem expiração a mídia ficaria quebrada até F5');
    assert.ok(appJs.includes('CONV_MEDIA_ERROR_RETRY_MS'), 'backoff configurável ausente');
  });

  it('render usa o cache de forma síncrona (re-render não rebaixa nada)', () => {
    const renderState = extractFn(appJs, 'function _convMediaRenderState(msg, resolvedUrl, kind)');
    assert.ok(renderState, '_convMediaRenderState não encontrada');
    assert.ok(renderState.includes('_convMediaCacheGet'), 'render não lê o cache');
    assert.ok(renderState.includes('state'), 'render não expõe estado');
  });

  it('miniatura (media_preview) entra no render de imagem e sticker', () => {
    const renderState = extractFn(appJs, 'function _convMediaRenderState(msg, resolvedUrl, kind)');
    assert.ok(renderState.includes('_convPreviewDataUri'), 'prévia ignorada no render');
    const previewFn = extractFn(appJs, 'function _convPreviewDataUri(msg)');
    assert.ok(previewFn.includes('media_preview'), 'coluna media_preview não é lida');
    assert.ok(previewFn.includes('data:image/jpeg;base64,'), 'prévia sem prefixo MIME');
  });

  it('nenhum branch de mídia usa onclick inline (clique é delegado)', () => {
    assert.ok(!/onclick="window\.open\(this\.src/.test(appJs),
      'onclick inline quebrava a cada re-render e abria placeholder');
    const render = extractFn(appJs, 'function _renderConvMessages()');
    for (const kind of ['conv-media-img', 'conv-media-audio', 'conv-media-video', 'conv-media-doc', 'conv-media-sticker']) {
      assert.ok(render.includes(kind), `branch ${kind} sumiu do render`);
    }
    assert.ok(render.includes('_convMediaRenderState'),
      'todos os branches precisam passar pelo estado/cache');
  });

  it('clique delegado: aberto quando pronto, recarrega quando falhou', () => {
    const delegation = extractFn(appJs, 'function _convInitMsgMenuDelegation()');
    assert.ok(delegation, '_convInitMsgMenuDelegation não encontrada');
    assert.ok(delegation.includes("e.target.closest('[data-mid]')"),
      'sem delegação o clique na foto não faz nada');
    assert.ok(delegation.includes('_convMediaRetry'), 'erro sem retry = foto morta');
    assert.ok(delegation.includes('_convMediaRequest'), 'pendente sem força-carregar');
    assert.ok(delegation.includes('window.open'), 'foto pronta deve abrir em nova aba');
  });

  it('mensagem exibida registra as métricas de mídia (para medir o ganho)', () => {
    const load = extractFn(appJs, 'async function _convLoadMessages(chatId)');
    assert.ok(load.includes('media_preview'), 'media_preview não é selecionada');
    assert.ok(load.includes('_convMediaPerf.queryMs'), 'sem instrumentação não dá para medir');
    assert.ok(/media_preview/.test(load) && /quoted_/.test(load),
      'resiliência para colunas ainda não migradas');
    assert.ok(appJs.includes('window.__convMediaPerf'), 'hook de medição ausente');
  });
});

/* ===========================================================
   app.js · envio de imagem
   =========================================================== */
describe('app.js · imagens enviadas', () => {
  const send = extractFn(appJs, 'async function _convSendPendingMedia(captionOverride)');

  it('imagem sempre vai para o Storage (mesmo pequena)', () => {
    assert.ok(send, '_convSendPendingMedia não encontrada');
    assert.ok(/media\.type === 'image'/.test(send),
      'sem Storage a tabela guarda megabytes de base64 e o re-render rebaixa tudo');
    assert.ok(send.includes('CONV_INLINE_MAX_BYTES'), 'tipos não-imagem seguem o limite de 4MB');
  });

  it('bucket indisponível cai para inline sem travar o envio', () => {
    assert.ok(/uploaded\.ok/.test(send), 'fluxo de upload ausente');
    assert.ok(/else if \(file\.size <= CONV_INLINE_MAX_BYTES && media\.dataUrl\)/.test(send),
      'sem fallback o envio de foto quebraria quando a migração do bucket faltar');
    const uploadBlock = send.slice(send.indexOf('if (useStorage)'), send.indexOf('if (!mediaRef)'));
    assert.ok(!/fail\(uploaded\.message\);\s*return;[\s\S]*else/.test(uploadBlock),
      'abortar cedo demais impediria o fallback inline');
  });

  it('gera miniatura local e envia junto (preview → media_preview)', () => {
    assert.ok(send.includes('_convMakeMediaPreview'), 'miniatura não é gerada no envio');
    assert.ok(/mediaPath,\s*preview\b/.test(send), 'preview não vai para a Edge Function');
    const make = extractFn(appJs, 'async function _convMakeMediaPreview(file)');
    assert.ok(make, '_convMakeMediaPreview não encontrada');
    assert.ok(make.includes('createImageBitmap'), 'sem createImageBitmap o canvas custa demais');
    assert.ok(make.includes('80000'), 'sem teto a miniatura infla a linha da mensagem');
    assert.ok(make.includes('return \'\''), 'falha de miniatura precisa ser opcional');
  });

  it('whatsapp-service repassa o preview no body', () => {
    assert.ok(waService.includes('body.preview'), 'preview não chega na Edge Function');
    assert.ok(!/\[WA\][^\n]*preview/.test(waService), 'preview não deve aparecer em log');
  });
});

/* ===========================================================
   Proxy · cache em Storage + headers
   =========================================================== */
describe('evolution-media-proxy · cache e headers', () => {
  it('resposta binária é cacheável (re-render não baixa de novo)', () => {
    assert.ok(/'Cache-Control':\s*'public, max-age=31536000, immutable'/.test(proxyTs),
      'imagem sem cache público refaz a transferência a cada render');
  });

  it('resposta de erro é no-store (não pode ser lembrada pelo navegador)', () => {
    const json = extractFn(proxyTs, 'function jsonResponse(body: Record<string, unknown>, status: number)');
    assert.ok(json, 'jsonResponse não encontrada');
    assert.ok(json.includes("'Cache-Control': 'no-store'"),
      'erro cacheado faz a mídia continuar quebrada depois de voltar');
  });

  it('cacheia em chat-media/received (evita getBase64FromMediaMessage sempre)', () => {
    assert.ok(proxyTs.includes('received/'), 'caminho do cache ausente');
    assert.ok(proxyTs.includes('upsert: true'), 'cache precisa sobrescrever');
    assert.ok(proxyTs.includes('cacheKeyFor'), 'chave determinística do cache ausente');
    assert.ok(proxyTs.includes('.download('), 'hit do cache não lê o objeto');
  });

  it('falha de cache é best-effort (nunca derruba a resposta)', () => {
    assert.ok(proxyTs.includes('cache write'), 'escrita do cache não é protegida');
    assert.ok(proxyTs.includes('cache read'), 'leitura do cache não é protegida');
    assert.ok(proxyTs.includes('return binaryResponse(buffer, mime)'),
      'resposta não pode depender do cache ter funcionado');
    assert.ok(!/if \(!supabase\) return jsonResponse/.test(proxyTs),
      'sem Storage o proxy ainda precisa servir a mídia');
  });

  it('não loga URL assinada nem URL de mídia completa', () => {
    assert.ok(!/mediaUrl:\s*mediaUrl/.test(proxyTs), 'log com a URL completa pode vazar token');
    assert.ok(!/signedUrl/.test(proxyTs), 'signed URL jamais aparece em log');
    assert.ok(!/substring\(0,\s*150\)/.test(proxyTs), 'recortar a URL ainda deixa prefixo sensível');
  });
});

/* ===========================================================
   Webhook · jpegThumbnail → media_preview
   =========================================================== */
describe('evolution-webhook · miniatura recebida', () => {
  it('extractMessageContent devolve mediaPreview', () => {
    const fn = extractFn(webhookTs, 'function extractMessageContent(message: Record<string, any>): {');
    assert.ok(fn, 'extractMessageContent não encontrada');
    assert.ok(fn.includes('jpegThumbnail'), 'jpegThumbnail é descartado (bug original)');
    assert.ok(fn.includes('mediaPreview'), 'prévia não é devolvida');
    assert.ok(fn.includes('normalizeThumb'), 'thumbnail serializado de formas diferentes');
  });

  it('mensagem salva grava media_preview com resiliência de coluna', () => {
    assert.ok(webhookTs.includes('media_preview: mediaPreview || null'), 'coluna não é preenchida');
    assert.ok(/media_preview/.test(webhookTs.split('let guard = 0')[1] || ''),
      'migração pendente perderia a mensagem inteira');
  });

  it('REVOKE também limpa a miniatura', () => {
    assert.ok(webhookTs.includes('media_preview: null'),
      'mensagem apagada deixaria thumbnail na tela');
    const guard = webhookTs.slice(webhookTs.indexOf('const revokePayload'), webhookTs.indexOf('const revokePayload') + 800);
    assert.ok(/\/media_preview\//.test(guard),
      'revoke sem resiliência falha antes da migração');
  });

  it('normalizeThumb só aceita base64 plausível (sem token/lixo)', () => {
    const fn = extractFn(webhookTs, 'function normalizeThumb(raw: any): string');
    assert.ok(fn, 'normalizeThumb não encontrada');
    assert.ok(fn.includes('THUMB_MAX_CHARS'), 'sem teto a miniatura infla a linha');
    assert.ok(fn.includes('return \'\''), 'formato desconhecido deve virar vazio, não exceção');
  });
});

/* ===========================================================
   evolution-send · preview do envio
   =========================================================== */
describe('evolution-send · preview do envio', () => {
  it('aceita preview do body e valida como base64 curto', () => {
    assert.ok(sendTs.includes('preview = null'), 'preview não é lido do body');
    assert.ok(sendTs.includes('mediaPreview'), 'preview não é normalizado');
    assert.ok(sendTs.includes('80000'), 'sem teto aceitariam payload gigante');
    assert.ok(sendTs.includes('/^[A-Za-z0-9+/]+={0,2}$/'), 'validação base64 ausente');
  });

  it('grava media_preview e tolera coluna ainda não migrada', () => {
    assert.ok(sendTs.includes('msgRow.media_preview = mediaPreview'), 'linha sem miniatura');
    assert.ok(sendTs.includes('media_preview'), 'retry sem a coluna não está previsto');
  });

  it('log não imprime prefixo de URL assinada', () => {
    assert.ok(!sendTs.includes('mediaUrlPrefix'), 'prefixo da signed URL vaza para o log');
    assert.ok(sendTs.includes('mediaUrlKind'), 'log deve dizer só o tipo da mídia');
  });
});

/* ===========================================================
   Migração
   =========================================================== */
describe('migração · messages.media_preview', () => {
  it('cria a coluna idempotente', () => {
    assert.ok(migration.includes('ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_preview TEXT'));
  });

  it('não cria policy nova (mesma policy da linha da mensagem)', () => {
    assert.ok(!/CREATE POLICY/i.test(migration), 'não deve expor coluna nova com policy própria');
  });
});

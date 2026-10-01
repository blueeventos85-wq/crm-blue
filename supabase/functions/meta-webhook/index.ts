import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const received = signatureHeader.slice('sha256='.length);

  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < received.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type WebhookEvent = {
  eventId: string;
  eventType: string;
  phoneNumberId: string | null;
  payload: unknown;
};

async function extractEvents(body: any): Promise<WebhookEvent[]> {
  const events: WebhookEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id ?? null;
      const field = change?.field ?? 'unknown';

      if (Array.isArray(value?.messages)) {
        for (const msg of value.messages) {
          events.push({
            eventId: msg.id,
            eventType: `messages:${field}`,
            phoneNumberId,
            payload: { ...value, messages: [msg] },
          });
        }
      }
      if (Array.isArray(value?.statuses)) {
        for (const st of value.statuses) {
          events.push({
            eventId: st.id,
            eventType: `statuses:${field}`,
            phoneNumberId,
            payload: { ...value, statuses: [st] },
          });
        }
      }
      if (!Array.isArray(value?.messages) && !Array.isArray(value?.statuses)) {
        events.push({
          eventId: `${field}:${entry?.id ?? 'entry'}:${await sha256Hex(JSON.stringify(value))}`,
          eventType: field,
          phoneNumberId,
          payload: value,
        });
      }
    }
  }
  return events;
}

serve(async (req: Request) => {
  // ---------- GET: handshake de validação da Meta ----------
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expectedToken = Deno.env.get('META_VERIFY_TOKEN');

    if (!expectedToken) {
      console.error('META_VERIFY_TOKEN não configurado');
      return json({ error: 'server_not_configured' }, 500);
    }

    if (mode === 'subscribe' && token === expectedToken && challenge) {
      console.log('meta-webhook: handshake validado');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return json({ error: 'forbidden' }, 403);
  }

  // ---------- POST: eventos ----------
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const appSecret = Deno.env.get('META_APP_SECRET');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!appSecret || !serviceRoleKey || !supabaseUrl) {
    console.error('meta-webhook: secrets ausentes (META_APP_SECRET/SERVICE_ROLE_KEY/SUPABASE_URL)');
    return json({ error: 'server_not_configured' }, 500);
  }

  const rawBody = await req.text();

  const signatureOk = await verifySignature(
    rawBody,
    req.headers.get('x-hub-signature-256'),
    appSecret,
  );
  if (!signatureOk) {
    console.warn('meta-webhook: assinatura inválida');
    return json({ error: 'invalid_signature' }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let events: WebhookEvent[] = [];
  try {
    events = await extractEvents(body);
  } catch (e) {
    console.error('meta-webhook: falha ao extrair eventos', e);
    events = [{
      eventId: await sha256Hex(rawBody),
      eventType: 'unparsed',
      phoneNumberId: null,
      payload: body,
    }];
  }

  let inserted = 0;
  let duplicates = 0;

  for (const ev of events) {
    const { data, error } = await supabase
      .from('webhook_events')
      .upsert(
        {
          provider: 'meta_cloud_api',
          event_id: ev.eventId,
          event_type: ev.eventType,
          phone_number_id: ev.phoneNumberId,
          payload: ev.payload,
          processed_at: new Date().toISOString(),
        },
        { onConflict: 'provider,event_id', ignoreDuplicates: true },
      )
      .select('id');

    if (error) {
      console.error('meta-webhook: erro ao gravar webhook_events', error);
      return json({ error: 'db_error' }, 500);
    }
    if (data && data.length > 0) inserted++;
    else duplicates++;
  }

  // FASE 2: roteamento para persistência de mensagens/status
  // (findOrCreateContact/Conversation + messages), processando apenas eventos novos.

  console.log(`meta-webhook: ${inserted} novos, ${duplicates} duplicados`);
  return json({ ok: true, received: events.length, inserted, duplicates });
});

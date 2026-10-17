import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTelegramAdapter, createSiteServer, createRateLimiter, createLeadHandler } from '../server/index.mjs';
import { botReply, createBotWebhook } from '../server/telegram-bot.mjs';

const lead = { name: 'Анна', contact: '@anna_school', program: 'adults', goal: 'Китайский для поездок', consent: true };
const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '-123' };

test('missing server configuration yields an explicit unavailable state', async () => {
  const submit = createTelegramAdapter({ env: {}, transport: () => { throw new Error('No network should occur'); } });
  const result = await submit(lead);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not_configured');
  assert.equal(result.body.ok, false);
});

test('invalid input is rejected before contacting Telegram', async () => {
  const submit = createTelegramAdapter({ env, transport: () => { throw new Error('No network should occur'); } });
  const result = await submit({ ...lead, contact: 'invalid' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'validation_error');
  assert.ok(result.body.errors.contact);
});

test('an unknown learning format is rejected before contacting Telegram', async () => {
  const submit = createTelegramAdapter({ env, transport: () => { throw new Error('No network should occur'); } });
  const result = await submit({ ...lead, format: 'unknown' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'validation_error');
  assert.ok(result.body.errors.format);
});

test('HTTP success with Telegram rejection does not claim delivery', async () => {
  const submit = createTelegramAdapter({ env, transport: async () => ({ ok: true, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }) }) });
  const result = await submit(lead);
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'telegram_error');
});

test('upstream HTTP failure does not claim delivery', async () => {
  const submit = createTelegramAdapter({ env, transport: async () => ({ ok: false, json: async () => ({ ok: true }) }) });
  const result = await submit(lead);
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
});

test('an uncertain network failure is returned without automatically retrying', async () => {
  let calls = 0;
  const submit = createTelegramAdapter({ env, transport: async () => { calls += 1; throw new Error('Network lost'); } });
  const result = await submit(lead);
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'delivery_unknown');
  assert.equal(calls, 1);
});

test('confirmed upstream delivery transmits a plain-text message with server-only credentials', async () => {
  let request;
  const submit = createTelegramAdapter({ env, transport: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 9 } }) };
  } });
  const result = await submit({ ...lead, goal: '*HSK* <test>', format: 'group' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, code: 'sent' });
  assert.ok(request, 'a confirmed result requires an upstream request');
  assert.equal(request.url, 'https://api.telegram.org/bottest-token/sendMessage');
  assert.equal(request.options.method, 'POST');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.chat_id, '-123');
  assert.equal(payload.text, '📩 Новая заявка с сайта\n\nИмя: Анна\nКонтакт: @anna_school\nНаправление: Китайский для взрослых\nФормат: Мини-группа — 3–5 учеников\nЦель: *HSK* <test>');
  assert.equal('parse_mode' in payload, false);
  assert.equal(JSON.stringify(result.body).includes('test-token'), false);
});

async function request(server, { method = 'POST', origin, host = '127.0.0.1:4173', body = lead } = {}) {
  const incoming = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []);
  incoming.url = '/api/leads';
  incoming.method = method;
  incoming.headers = { host, origin, 'content-type': 'application/json' };
  let result;
  const response = {
    setHeader() {},
    writeHead(status) { result = { status }; },
    end(text) { result.body = JSON.parse(text); },
  };
  await server.listeners('request')[0](incoming, response);
  return result;
}

const noTelegram = () => { throw new Error('No Telegram network should occur'); };
const postWithOrigin = (origin, environment = {}) => request(createSiteServer({ env: environment, transport: noTelegram }), { origin });

test('configured public HTTPS origin reaches the adapter behind a TLS proxy', async () => {
  const result = await postWithOrigin('https://school.example', { SITE_ORIGIN: 'https://school.example' });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not_configured');
});

test('configured public origin overrides the local HTTP origin allowlist', async () => {
  const result = await postWithOrigin('http://127.0.0.1:4173', { SITE_ORIGIN: 'https://school.example' });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'origin_not_allowed');
});

test('foreign origin cannot reach the configured Telegram adapter', async () => {
  const result = await postWithOrigin('https://foreign.example', { SITE_ORIGIN: 'https://school.example' });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'origin_not_allowed');
});

test('invalid public origin configuration is rejected before serving requests', () => {
  for (const origin of ['https://school.example/path', 'https://user:password@school.example', 'https://school.example?key=1', 'not a URL']) {
    assert.throws(() => createSiteServer({ env: { SITE_ORIGIN: origin } }), /SITE_ORIGIN/);
  }
});

test('the status endpoint tells the page whether direct submission is available', async () => {
  const off = await request(createSiteServer({ env: {}, transport: noTelegram }), { method: 'GET' });
  assert.deepEqual(off, { status: 200, body: { ok: true, configured: false } });
  const on = await request(createSiteServer({ env, transport: noTelegram }), { method: 'GET' });
  assert.deepEqual(on, { status: 200, body: { ok: true, configured: true } });
});

test('without SITE_ORIGIN a page served from the same host is accepted over http and https', async () => {
  for (const origin of ['http://127.0.0.1:4173', 'https://127.0.0.1:4173']) {
    const result = await postWithOrigin(origin);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'not_configured');
  }
});

test('without SITE_ORIGIN a page from another host is rejected', async () => {
  for (const origin of ['https://foreign.example', 'http://127.0.0.1:9999', 'null']) {
    const result = await postWithOrigin(origin);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'origin_not_allowed');
  }
});

test('the rate limit stops a flood of leads before it reaches Telegram', async () => {
  let calls = 0;
  const server = createSiteServer({
    env,
    rateLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }),
    transport: async () => { calls += 1; return { ok: true, json: async () => ({ ok: true }) }; },
  });
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push(await request(server, { origin: 'http://127.0.0.1:4173' }));
  assert.deepEqual(results.map((result) => result.status), [200, 200, 429]);
  assert.equal(results[2].body.code, 'rate_limited');
  assert.equal(calls, 2);
});

test('the rate limit window slides', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
  assert.equal(allow(), true);
  assert.equal(allow(), false);
  now = 1000;
  assert.equal(allow(), true);
});

test('a group upgraded to a supergroup still gets the lead at its new id', async () => {
  const targets = [];
  const submit = createTelegramAdapter({ env, transport: async (url, options) => {
    const { chat_id: target } = JSON.parse(options.body);
    targets.push(target);
    return target === '-123'
      ? { ok: false, json: async () => ({ ok: false, error_code: 400, parameters: { migrate_to_chat_id: -100777 } }) }
      : { ok: true, json: async () => ({ ok: true }) };
  } });
  const result = await submit(lead);
  assert.equal(result.status, 200);
  assert.deepEqual(targets, ['-123', -100777]);
});

function capture() {
  const result = {};
  return { result, response: {
    setHeader() {},
    writeHead(status) { result.status = status; },
    end(text) { result.body = JSON.parse(text); },
  } };
}

test('a body already parsed by the Vercel runtime is accepted', async () => {
  let sent;
  const handle = createLeadHandler({ env, transport: async (url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true }) }; } });
  const { result, response } = capture();
  await handle({ method: 'POST', headers: { host: 'school.example', origin: 'https://school.example', 'content-type': 'application/json' }, body: lead }, response);
  assert.equal(result.status, 200);
  assert.match(sent.text, /Имя: Анна/);
});

test('the bot tells a chat its id and whether leads arrive there', () => {
  const here = botReply({ message: { text: '/chatid@minmin_school_leads_bot', chat: { id: -123, type: 'group' } } }, env);
  assert.equal(here.chat_id, -123);
  assert.match(here.text, /Сюда приходят заявки/);
  const other = botReply({ message: { text: '/chatid', chat: { id: -999, type: 'supergroup' } } }, env);
  assert.match(other.text, /ID этого чата: -999/);
  assert.match(other.text, /TELEGRAM_CHAT_ID/);
  assert.equal(botReply({ message: { text: 'привет', chat: { id: -123, type: 'group' } } }, env), null);
  const added = botReply({ my_chat_member: { chat: { id: -555, type: 'group' }, new_chat_member: { status: 'member' } } }, env);
  assert.match(added.text, /-555/);
});

test('the webhook ignores requests without the Telegram secret', async () => {
  const webhook = createBotWebhook({ env: { ...env, TELEGRAM_WEBHOOK_SECRET: 'top-secret' } });
  const update = { message: { text: '/chatid', chat: { id: -123, type: 'group' } } };
  const denied = capture();
  await webhook({ method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' }, body: update }, denied.response);
  assert.equal(denied.result.status, 401);
  const allowed = capture();
  await webhook({ method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'top-secret' }, body: update }, allowed.response);
  assert.equal(allowed.result.status, 200);
  assert.equal(allowed.result.body.method, 'sendMessage');
});

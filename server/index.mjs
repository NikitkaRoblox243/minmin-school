import http from 'node:http';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLead, buildLeadMessage } from '../src/lead.js';

const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const jsonResult = (status, code, extra = {}) => ({ status, body: { ok: status === 200, code, ...extra } });
const telegramConfigured = (env) => Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim());

export function createTelegramAdapter({ env = process.env, transport = fetch } = {}) {
  return async (lead) => {
    const validation = validateLead(lead);
    if (!validation.valid) return jsonResult(400, 'validation_error', { errors: validation.errors });
    const token = env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) return jsonResult(503, 'not_configured');
    const send = (target) => transport(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No link preview: a wa.me link would otherwise add a large WhatsApp card under every lead.
      body: JSON.stringify({ chat_id: target, text: buildLeadMessage(lead), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10000),
    }).then(async (response) => ({ response, payload: await response.json() }));
    try {
      let { response, payload } = await send(chatId);
      // A group upgraded to a supergroup gets a new id; Telegram rejects the old one without delivering,
      // so resending to the new id cannot duplicate the lead.
      const migrated = payload?.parameters?.migrate_to_chat_id;
      if (payload?.ok !== true && migrated) {
        console.warn(`TELEGRAM_CHAT_ID moved to ${migrated}; update the variable.`);
        ({ response, payload } = await send(migrated));
      }
      if (!response.ok || payload?.ok !== true) return jsonResult(502, 'telegram_error');
      return jsonResult(200, 'sent');
    } catch {
      // A request may have reached Telegram before the connection failed. Never retry automatically.
      return jsonResult(502, 'delivery_unknown');
    }
  };
}

// Caps how many leads reach the school chat per time window, so a spam script cannot flood it.
// Behind the hosting proxy every request shares one address, so the limit is global.
export function createRateLimiter({ limit = 20, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  let hits = [];
  return () => {
    const current = now();
    hits = hits.filter((time) => current - time < windowMs);
    if (hits.length >= limit) return false;
    hits.push(current);
    return true;
  };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function cacheControl(extension, versioned) {
  if (versioned) return 'public, max-age=31536000, immutable'; // URLs carry a content hash from the build
  if (extension === '.html') return 'no-cache';
  return 'public, max-age=86400';
}

export function respondJSON(response, result) {
  response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(result.body));
}

export async function readJSONBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error(), { status: 415, code: 'json_required' });
  }
  // Vercel's Node runtime reads the stream itself and exposes the parsed body (a getter that throws on bad JSON).
  if ('body' in request) {
    let value;
    try { value = request.body; } catch { throw Object.assign(new Error(), { status: 400, code: 'invalid_json' }); }
    if (JSON.stringify(value ?? null).length > 8192) throw Object.assign(new Error(), { status: 413, code: 'body_too_large' });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(), { status: 400, code: 'invalid_json' });
    return value;
  }
  let bytes = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw Object.assign(new Error(), { status: 413, code: 'body_too_large' });
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error(), { status: 400, code: 'invalid_json' });
  }
}

function parsePublicOrigin(value) {
  if (!value?.trim()) return undefined;
  try {
    const configured = new URL(value.trim());
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) throw new Error();
    return configured.origin;
  } catch {
    throw new TypeError('SITE_ORIGIN must be an HTTP or HTTPS origin without a path, credentials, query or fragment.');
  }
}

// With SITE_ORIGIN only that origin may submit. Without it, the page must come from the same host
// the request was sent to (http locally, https behind the hosting proxy).
function originAllowed(origin, host, publicOrigin) {
  if (!origin) return true; // server-side clients send no Origin header
  if (publicOrigin) return origin === publicOrigin;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}

// POST /api/leads (and GET for the "is the bot configured" probe). Used by the local server and by
// the Vercel function in api/leads.js.
export function createLeadHandler({ env = process.env, transport = fetch, rateLimiter = createRateLimiter() } = {}) {
  const submit = createTelegramAdapter({ env, transport });
  const publicOrigin = parsePublicOrigin(env.SITE_ORIGIN);
  return async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' || request.method === 'HEAD') {
      respondJSON(response, { status: 200, body: { ok: true, configured: telegramConfigured(env) } });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      respondJSON(response, jsonResult(405, 'method_not_allowed'));
      return;
    }
    if (!originAllowed(request.headers.origin, request.headers.host, publicOrigin)) {
      respondJSON(response, jsonResult(403, 'origin_not_allowed'));
      return;
    }
    let lead;
    try { lead = await readJSONBody(request); }
    catch (error) { respondJSON(response, jsonResult(error.status || 400, error.code || 'invalid_request')); return; }
    if (validateLead(lead).valid && telegramConfigured(env) && !rateLimiter()) {
      respondJSON(response, jsonResult(429, 'rate_limited'));
      return;
    }
    respondJSON(response, await submit(lead));
  };
}

export function createSiteServer({ env = process.env, transport = fetch, distRoot = defaultRoot, rateLimiter = createRateLimiter() } = {}) {
  const handleLead = createLeadHandler({ env, transport, rateLimiter });
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    let pathname;
    const [rawPath, query = ''] = (request.url || '/').split('?');
    try { pathname = decodeURIComponent(rawPath); }
    catch { response.writeHead(400); response.end('Bad request'); return; }

    if (pathname === '/api/leads') { await handleLead(request, response); return; }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    if (pathname.includes('\\') || pathname.split('/').includes('..') || pathname.includes('\0')) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    try {
      const root = await realpath(distRoot);
      const candidate = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const target = await realpath(candidate);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(target)).isFile()) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const body = await readFile(target);
      const extension = path.extname(target).toLowerCase();
      response.writeHead(200, {
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': cacheControl(extension, /(^|&)v=/.test(query)),
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

async function startServer() {
  try { await access(path.join(defaultRoot, 'index.html')); }
  catch { throw new Error('dist/ is missing. Run "npm run build" first.'); }
  const server = createSiteServer();
  const host = process.env.HOST || '127.0.0.1';
  const explicitPort = process.env.PORT !== undefined && process.env.PORT !== '';
  const requested = Number(explicitPort ? process.env.PORT : 4173);
  const listen = (port) => new Promise((resolve, reject) => {
    const error = (reason) => { server.off('listening', ready); reject(reason); };
    const ready = () => { server.off('error', error); resolve(); };
    server.once('error', error);
    server.once('listening', ready);
    server.listen(port, host);
  });
  try { await listen(Number.isInteger(requested) && requested >= 0 && requested <= 65535 ? requested : 4173); }
  catch (error) { if (error.code !== 'EADDRINUSE' || explicitPort) throw error; await listen(0); }
  const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`MinMin School: http://${shownHost}:${server.address().port}`);
  console.log(telegramConfigured(process.env)
    ? 'Telegram bot configured: the form sends leads directly.'
    : 'Telegram bot is not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). The form prepares a Telegram draft.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => { console.error(error.message || 'Could not start the server.'); process.exitCode = 1; });
}

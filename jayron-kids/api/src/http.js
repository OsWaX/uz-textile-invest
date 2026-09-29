'use strict';
/**
 * Небольшой слой поверх node:http — маршрутизация, разбор тела запроса,
 * ответы JSON. Без внешних зависимостей.
 */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'unauthorized') => new HttpError(401, msg);
const notFound = (msg = 'not_found') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);
const tooManyRequests = (msg, details) => new HttpError(429, msg, details);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendBuffer(res, status, buffer, headers = {}) {
  res.writeHead(status, { 'Content-Length': buffer.length, ...headers });
  res.end(buffer);
}

function sendHtml(res, status, html) {
  sendBuffer(res, status, Buffer.from(html, 'utf8'), {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

/** Считывает тело запроса с ограничением по размеру. */
function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limitBytes) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw badRequest('invalid_json');
  }
}

/** application/x-www-form-urlencoded или JSON — Click присылает первое. */
async function readForm(req) {
  const buf = await readBody(req);
  const text = buf.toString('utf8');
  if (/json/i.test(req.headers['content-type'] || '')) {
    try { return JSON.parse(text) || {}; } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** Простой маршрутизатор с путями вида '/api/orders/:id'. */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regexSource = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, regex: new RegExp(`^${regexSource}$`), keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    let pathExists = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (route.method !== method) continue;
      const params = Object.create(null);
      route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    if (pathExists) throw new HttpError(405, 'method_not_allowed');
    return null;
  }
}

module.exports = {
  HttpError, Router,
  badRequest, unauthorized, notFound, conflict, tooManyRequests,
  sendJson, sendBuffer, sendHtml,
  readBody, readJson, readForm,
};

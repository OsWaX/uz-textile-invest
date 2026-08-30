'use strict';
/**
 * Небольшой слой поверх node:http — маршрутизация, разбор тела запроса,
 * multipart/form-data, ответы JSON. Без внешних зависимостей.
 */
const { StringDecoder } = require('node:string_decoder');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Требуется вход в систему') => new HttpError(401, msg);
const forbidden = (msg = 'Недостаточно прав для этого действия') => new HttpError(403, msg);
const notFound = (msg = 'Запись не найдена') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);

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

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  sendBuffer(res, status, Buffer.from(text, 'utf8'), { 'Content-Type': contentType });
}

/** Считывает тело запроса с ограничением по размеру. */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, `Размер запроса превышает допустимый (${Math.round(limitBytes / 1048576)} МБ)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limitBytes = 2 * 1024 * 1024) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch {
    throw badRequest('Тело запроса не является корректным JSON');
  }
}

/**
 * Разбор multipart/form-data. Возвращает { fields, files }.
 * files: [{ name, filename, mime, data }]
 */
async function readMultipart(req, limitBytes) {
  const contentType = req.headers['content-type'] || '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw badRequest('Ожидался multipart/form-data');
  const boundary = `--${(match[1] || match[2]).trim()}`;
  const body = await readBody(req, limitBytes);

  const fields = Object.create(null);
  const files = [];
  const boundaryBuf = Buffer.from(boundary, 'utf8');

  let position = body.indexOf(boundaryBuf);
  if (position < 0) throw badRequest('Некорректное тело multipart-запроса');
  position += boundaryBuf.length;

  while (position < body.length) {
    if (body[position] === 0x2d && body[position + 1] === 0x2d) break; // "--" -> конец
    if (body[position] === 0x0d && body[position + 1] === 0x0a) position += 2;

    const headerEnd = body.indexOf('\r\n\r\n', position, 'utf8');
    if (headerEnd < 0) break;
    const headerText = body.slice(position, headerEnd).toString('utf8');
    const partStart = headerEnd + 4;

    let partEnd = body.indexOf(boundaryBuf, partStart);
    if (partEnd < 0) partEnd = body.length;
    let contentEnd = partEnd;
    if (body[contentEnd - 2] === 0x0d && body[contentEnd - 1] === 0x0a) contentEnd -= 2;
    const content = body.slice(partStart, contentEnd);

    const disposition = /content-disposition:[^\n]*/i.exec(headerText)?.[0] || '';
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    const mime = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream';

    if (name !== undefined) {
      if (filename !== undefined) {
        if (filename !== '') files.push({ name, filename: decodeFilename(filename), mime, data: content });
      } else {
        fields[name] = content.toString('utf8');
      }
    }
    position = partEnd + boundaryBuf.length;
  }
  return { fields, files };
}

/** Браузеры присылают имя файла в UTF-8; восстанавливаем при необходимости. */
function decodeFilename(name) {
  try {
    const decoder = new StringDecoder('utf8');
    return decoder.write(Buffer.from(name, 'binary')) || name;
  } catch {
    return name;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  const previous = res.getHeader('Set-Cookie');
  const list = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

/**
 * Простой маршрутизатор с путями вида '/api/projects/:id'.
 */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
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
    this.routes.push({ method, regex: new RegExp(`^${regexSource}$`), keys, handler, options });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }

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
    if (pathExists) throw new HttpError(405, 'Метод не поддерживается для этого адреса');
    return null;
  }
}

module.exports = {
  HttpError, Router,
  badRequest, unauthorized, forbidden, notFound, conflict,
  sendJson, sendText, sendBuffer,
  readBody, readJson, readMultipart,
  parseCookies, setCookie,
};

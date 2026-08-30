'use strict';
/** Общие средства для тестов: временная база, запуск сервера, клиент с cookie. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(workDir, 'test.db');
process.env.UPLOAD_DIR = path.join(workDir, 'uploads');
process.env.SESSION_SECRET = 'test-secret-key-for-acceptance-tests-0123456789';
process.env.ADMIN_EMAIL = 'admin@textile.gov.uz';
process.env.ADMIN_PASSWORD = 'Parol2026!';
process.env.PORT = '0';

const app = require('../server/index');

let baseUrl = '';

async function startServer() {
  app.bootstrap();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return baseUrl;
}

const stopServer = () => new Promise((resolve) => app.server.close(resolve));

/** Клиент с собственным набором cookie — по одному на пользователя. */
function createClient() {
  const cookies = new Map();

  const request = async (method, path, body = null, headers = {}) => {
    const init = { method, headers: { ...headers } };
    if (cookies.size) {
      init.headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (body instanceof Buffer) {
      init.body = body;
    } else if (body !== null) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(baseUrl + path, init);
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload, headers: response.headers };
  };

  return {
    request,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    delete: (p) => request('DELETE', p),
    async login(email, password, code = '') {
      const result = await request('POST', '/api/auth/login', { email, password, code });
      if (result.status !== 200) throw new Error(`Вход не выполнен: ${JSON.stringify(result.body)}`);
      return result.body;
    },
    /** Загрузка файла через multipart/form-data. */
    async upload(entityType, entityId, filename, content, mime = 'image/png') {
      const boundary = '----poTestBoundary1234567890';
      const part = (name, value) =>
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8');
      const filePart = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'),
        Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
        Buffer.from('\r\n', 'utf8'),
      ]);
      const payload = Buffer.concat([
        part('entity_type', entityType),
        part('entity_id', String(entityId)),
        filePart,
        Buffer.from(`--${boundary}--\r\n`, 'utf8'),
      ]);
      return request('POST', '/api/attachments', payload, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
    },
  };
}

const cleanup = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* каталог уже удалён */ } };

module.exports = { startServer, stopServer, createClient, cleanup, workDir, app };

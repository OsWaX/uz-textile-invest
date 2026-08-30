'use strict';
/**
 * Портал управления проектами Проектного офиса
 * заместителя министра по текстильной промышленности Республики Узбекистан.
 *
 * Точка входа: HTTP-сервер, маршрутизация API, отдача статических файлов,
 * заголовки безопасности и обработка ошибок.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config');
const { get, run } = require('./db');
const reference = require('./reference');
const auth = require('./auth');
const notify = require('./notify');
const {
  HttpError, Router, sendJson, sendBuffer, readJson, readMultipart, unauthorized,
} = require('./lib/http');

// --------------------------------------------------------------------------
// Сборка маршрутов
// --------------------------------------------------------------------------
const router = new Router();
for (const module of [
  require('./routes/auth'),
  require('./routes/reference'),
  require('./routes/projects'),
  require('./routes/companies'),
  require('./routes/visits'),
  require('./routes/dashboard'),
  require('./routes/notifications'),
  require('./routes/reports'),
  require('./routes/files'),
  require('./routes/search'),
  require('./routes/admin'),
]) {
  router.routes.push(...module.routes);
}

// --------------------------------------------------------------------------
// Статические файлы
// --------------------------------------------------------------------------
const PUBLIC_DIR = path.join(config.root, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // Одностраничное приложение: неизвестные пути отдаём как index.html
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(index)) { sendJson(res, 404, { error: 'Не найдено' }); return; }
    const html = fs.readFileSync(index);
    sendBuffer(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  const etag = `W/"${crypto.createHash('sha1').update(data).digest('base64url')}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
  sendBuffer(res, 200, data, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    ETag: etag,
  });
}

// --------------------------------------------------------------------------
// Ограничение частоты попыток входа (защита от подбора пароля)
// --------------------------------------------------------------------------
const loginAttempts = new Map();
function checkLoginRate(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  if (loginAttempts.size > 5000) loginAttempts.clear();
  return entry.count <= 20;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '),
};

/**
 * Источник считается своим, если он совпадает с внешним адресом системы либо
 * с именем узла из заголовков запроса. Учитываются заголовки обратного прокси,
 * поэтому проверка работает и за прокси (nginx, GitHub Codespaces).
 */
function isTrustedOrigin(origin, req) {
  const normalized = origin.replace(/\/+$/, '');
  if (config.trustedOrigins.includes(normalized)) return true;

  const hosts = [req.headers.host, req.headers['x-forwarded-host']]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((part) => part.trim()));

  return hosts.some((host) => normalized === `http://${host}` || normalized === `https://${host}`);
}

// --------------------------------------------------------------------------
// Обработчик запросов
// --------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  req.clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (!pathname.startsWith('/api/')) { serveStatic(req, res, pathname); return; }

  // Защита от CSRF: небезопасные методы принимаются только со своего источника.
  // Основной барьер — cookie с атрибутом SameSite=Lax; проверка ниже дополняет его.
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && !isTrustedOrigin(origin, req)) {
      sendJson(res, 403, { error: 'Запрос отклонён: несовпадение источника (защита от CSRF)' });
      return;
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST' && !checkLoginRate(req.clientIp)) {
    sendJson(res, 429, { error: 'Слишком много попыток входа. Повторите через минуту.' });
    return;
  }

  const matched = router.match(req.method, pathname);
  if (!matched) { sendJson(res, 404, { error: 'Метод API не найден' }); return; }

  const query = Object.fromEntries(url.searchParams.entries());
  const contentType = req.headers['content-type'] || '';
  const isMultipart = contentType.includes('multipart/form-data');

  const ctx = {
    req, res, params: matched.params, query,
    body: ['POST', 'PUT', 'PATCH'].includes(req.method) && !isMultipart ? await readJson(req) : {},
    user: auth.currentUser(req),
    requireUser() {
      if (!this.user) throw unauthorized('Сессия истекла или отсутствует. Войдите в систему заново.');
      return this.user;
    },
    readMultipart: () => readMultipart(req, config.maxUploadBytes + 1024 * 1024),
  };

  const result = await matched.route.handler(ctx);
  if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (res.writableEnded) return;
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message, details: error.details });
      return;
    }
    console.error('[ошибка сервера]', req.method, req.url, error);
    sendJson(res, 500, {
      error: config.isProduction ? 'Внутренняя ошибка сервера' : `Внутренняя ошибка: ${error.message}`,
    });
  });
});

// --------------------------------------------------------------------------
// Первичная инициализация
// --------------------------------------------------------------------------
function bootstrap() {
  reference.ensureReference();

  const hasAdmin = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!hasAdmin) {
    const password = config.bootstrapAdmin.password || crypto.randomBytes(9).toString('base64url');
    const { salt, hash } = auth.hashPassword(password);
    run(
      `INSERT INTO users (email, full_name, position, role, password_hash, password_salt, must_change_pwd)
       VALUES (?, ?, ?, 'admin', ?, ?, 1)`,
      config.bootstrapAdmin.email, 'Администратор системы',
      'Руководитель Проектного офиса', hash, salt
    );
    console.log('\n  Создана учётная запись администратора:');
    console.log(`     Логин:  ${config.bootstrapAdmin.email}`);
    console.log(`     Пароль: ${password}`);
    console.log('     Смените пароль при первом входе.\n');
  }

  // Очистка корзины по истечении срока хранения.
  const retention = Number(require('./db').getSetting('recycle_bin.retention_days', 30));
  for (const table of ['projects', 'companies', 'visits', 'meetings', 'roadmap_steps']) {
    run(`DELETE FROM ${table} WHERE is_deleted = 1 AND deleted_at < datetime('now', '-${retention} day')`);
  }
  run("DELETE FROM sessions WHERE last_seen_at < datetime('now', '-30 day')");
}

function start() {
  bootstrap();
  notify.startScheduler();
  server.listen(config.port, config.host, () => {
    console.log(`  Портал Проектного офиса запущен: http://${config.host}:${config.port}`);
    console.log(`  Режим: ${config.isProduction ? 'продакшен' : 'разработка'} | БД: ${config.dbPath}`);
    console.log(`  Почта: ${config.smtp.enabled ? config.smtp.host : 'не настроена'} | Telegram: ${config.telegram.enabled ? 'подключён' : 'не настроен'}`);
  });
}

if (require.main === module) start();

module.exports = { server, start, bootstrap, handle };

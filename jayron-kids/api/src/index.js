'use strict';
/**
 * Сервер интернет-магазина Jayron Kids.
 * API для мобильного приложения, приём платежей Payme и Click,
 * панель управления магазином (/admin) и фотографии товаров (/uploads).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const db = require('./db');
const orders = require('./orders');
const { ensureRegions } = require('./seed');
const { HttpError, sendJson, sendBuffer } = require('./http');

const routers = [require('./routes/shop'), require('./routes/admin'), require('./routes/payments')];

const ADMIN_DIR = path.join(config.root, 'public', 'admin');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const ADMIN_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveFile(res, file, headers) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  sendBuffer(res, 200, fs.readFileSync(file), {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    ...headers,
  });
  return true;
}

function serveStatic(res, pathname) {
  if (pathname === '/admin') {
    res.writeHead(301, { Location: '/admin/' });
    res.end();
    return true;
  }
  if (pathname.startsWith('/admin/')) {
    const relative = pathname === '/admin/' ? 'index.html' : pathname.slice('/admin/'.length);
    const file = path.resolve(ADMIN_DIR, relative);
    if (!file.startsWith(ADMIN_DIR + path.sep)) return false;
    return serveFile(res, file, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': ADMIN_CSP });
  }
  if (pathname.startsWith('/uploads/')) {
    const name = path.basename(pathname);
    if (!/^[\w-]+\.(jpg|png|webp)$/.test(name)) return false;
    return serveFile(res, path.join(config.uploadDir, name), { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowAll = config.corsOrigins.includes('*');
  if (!allowAll && !config.corsOrigins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || '';
}

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/{2,}/g, '/');

  if (pathname === '/health') {
    await db.query('SELECT 1');
    sendJson(res, 200, { ok: true });
    return;
  }

  for (const router of routers) {
    const match = router.match(req.method, pathname);
    if (match) {
      const query = Object.fromEntries(url.searchParams);
      await match.route.handler(req, res, { params: match.params, query, ip: clientIp(req) });
      return;
    }
  }

  if (req.method === 'GET' && serveStatic(res, pathname)) return;
  if (pathname === '/') {
    res.writeHead(302, { Location: '/admin/' });
    res.end();
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message, ...(error.details ? { details: error.details } : {}) });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: 'server_error' });
  });
});

async function bootstrap() {
  await db.init();
  await ensureRegions();
}

let sweepTimer = null;

async function start() {
  await bootstrap();
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  console.log(`Jayron Kids API: ${config.publicUrl} (панель управления: ${config.publicUrl}/admin/)`);
  if (config.sms.provider === 'console') console.log('SMS не подключены: коды входа выводятся в этот журнал.');
  if (config.demoPayments) console.log('Учебная оплата включена: Payme и Click открывают тестовую страницу.');

  const sweep = () => orders.cancelUnpaidOrders()
    .then((count) => { if (count) console.log(`Отменено неоплаченных заказов: ${count}`); })
    .catch((error) => console.error('Отмена неоплаченных заказов:', error.message));
  sweepTimer = setInterval(sweep, 5 * 60 * 1000);
  sweepTimer.unref();
}

async function shutdown() {
  clearInterval(sweepTimer);
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Не удалось запустить сервер:', error.message);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown().finally(() => process.exit(0)));
  }
}

module.exports = { server, bootstrap, start, shutdown };

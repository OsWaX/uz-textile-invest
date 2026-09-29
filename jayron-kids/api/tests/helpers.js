'use strict';
/** Общие средства для тестов: отдельная база, запуск сервера, HTTP-клиент. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgres://jayron:jayron@127.0.0.1:5432/jayron_kids_test';
if (!/test/i.test(new URL(testDatabaseUrl).pathname)) {
  throw new Error('TEST_DATABASE_URL должен указывать на отдельную тестовую базу PostgreSQL');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-test-'));
process.env.ADMIN_PASSWORD = 'admin-test-password';
process.env.SMS_PROVIDER = 'console';
process.env.OTP_MAX_PER_IP_HOUR = '1000';
process.env.PUBLIC_URL = 'https://shop.example.uz';
process.env.PAYME_MERCHANT_ID = 'test-merchant';
process.env.PAYME_KEY = 'test-payme-key';
process.env.CLICK_SERVICE_ID = '1001';
process.env.CLICK_MERCHANT_ID = '2002';
process.env.CLICK_SECRET_KEY = 'test-click-secret';
process.env.TELEGRAM_BOT_TOKEN = '';

const app = require('../src/index');
const db = require('../src/db');
const { seed } = require('../src/seed');

let baseUrl = '';

async function startServer() {
  await seed({ reset: true });
  await app.bootstrap();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return baseUrl;
}

async function stopServer() {
  await new Promise((resolve) => app.server.close(resolve));
  await db.close();
}

async function request(method, url, { body, token, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const response = await fetch(baseUrl + url, init);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data, headers: response.headers };
}

let phoneCounter = 0;
/** Входит покупателем по SMS-коду и возвращает токен. */
async function loginCustomer(phone) {
  const number = phone || `99890${String(1000000 + (phoneCounter += 1)).slice(-7)}`;
  const sent = await request('POST', '/api/auth/request-code', { body: { phone: number } });
  if (sent.status !== 200) throw new Error(`request-code: ${JSON.stringify(sent.data)}`);
  const verified = await request('POST', '/api/auth/verify', { body: { phone: number, code: sent.data.debugCode } });
  if (verified.status !== 200) throw new Error(`verify: ${JSON.stringify(verified.data)}`);
  return { token: verified.data.token, customer: verified.data.customer, phone: number };
}

async function loginAdmin() {
  const { data } = await request('POST', '/api/admin/login', { body: { password: 'admin-test-password' } });
  return data.token;
}

/** Вариант товара с остатком не меньше minStock. */
async function variantWithStock(minStock = 1) {
  return db.get(
    `SELECT v.*, p.price FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.stock >= $1 ORDER BY v.id LIMIT 1`,
    [minStock],
  );
}

const checkout = (items, extra = {}) => ({
  items,
  recipientName: 'Dilnoza Karimova',
  recipientPhone: '+998 90 123 45 67',
  deliveryMethod: 'courier',
  regionCode: 'tashkent_city',
  city: 'Toshkent',
  address: 'Chilonzor 9-kvartal, 12-uy, 34-xonadon',
  paymentMethod: 'cash',
  ...extra,
});

module.exports = {
  db, startServer, stopServer, request, loginCustomer, loginAdmin, variantWithStock, checkout,
  get baseUrl() { return baseUrl; },
};

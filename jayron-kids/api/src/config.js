'use strict';
/** Настройки сервера магазина. Значения берутся из переменных окружения и файла .env. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** Минимальный разбор .env без внешних зависимостей. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const isProduction = env.NODE_ENV === 'production';
const port = num(env.PORT, 4000);

const adminPassword = env.ADMIN_PASSWORD || (isProduction ? '' : 'jayron2026');
if (isProduction && adminPassword.length < 10) {
  throw new Error('ADMIN_PASSWORD не задан или короче 10 символов. Задайте его перед запуском в продакшене.');
}

const payme = {
  merchantId: env.PAYME_MERCHANT_ID || '',
  key: env.PAYME_KEY || '',
  test: bool(env.PAYME_TEST, !isProduction),
  get enabled() { return Boolean(this.merchantId && this.key); },
  get checkoutUrl() { return this.test ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz'; },
};

const click = {
  serviceId: env.CLICK_SERVICE_ID || '',
  merchantId: env.CLICK_MERCHANT_ID || '',
  secretKey: env.CLICK_SECRET_KEY || '',
  get enabled() { return Boolean(this.serviceId && this.merchantId && this.secretKey); },
};

const sms = {
  // eskiz — рассылка через notify.eskiz.uz; console — код выводится в журнал сервера (только разработка)
  provider: env.SMS_PROVIDER || (env.ESKIZ_EMAIL ? 'eskiz' : 'console'),
  eskizEmail: env.ESKIZ_EMAIL || '',
  eskizPassword: env.ESKIZ_PASSWORD || '',
  eskizFrom: env.ESKIZ_FROM || '4546',
};
if (isProduction && sms.provider === 'console') {
  throw new Error('В продакшене нужна отправка SMS: задайте ESKIZ_EMAIL и ESKIZ_PASSWORD.');
}

const config = {
  root: ROOT,
  isProduction,
  port,
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  // Адреса веб-версии приложения, которым разрешены запросы из браузера (CORS).
  // Мобильным приложениям CORS не нужен.
  corsOrigins: list(env.CORS_ORIGINS || (isProduction ? '' : '*')),
  // За обратным прокси (nginx, Render, Fly.io) адрес клиента берётся из X-Forwarded-For
  trustProxy: bool(env.TRUST_PROXY, false),

  databaseUrl: env.DATABASE_URL || 'postgres://jayron:jayron@127.0.0.1:5432/jayron_kids',
  dbPoolSize: num(env.DB_POOL_SIZE, 10),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || './data/uploads'),
  maxImageBytes: num(env.MAX_IMAGE_MB, 5) * 1024 * 1024,

  adminPassword,
  sessionDays: num(env.SESSION_DAYS, 90),
  adminSessionHours: num(env.ADMIN_SESSION_HOURS, 12),

  otp: {
    length: 5,
    ttlMinutes: 5,
    maxAttempts: 5,
    resendSeconds: 60,
    maxPerHour: 5,
    // Защита от массовой рассылки SMS с одного адреса
    maxPerIpHour: num(env.OTP_MAX_PER_IP_HOUR, 10),
  },

  shop: {
    name: 'Jayron Kids',
    supportPhone: env.SUPPORT_PHONE || '+998 71 200 00 00',
    telegram: env.SUPPORT_TELEGRAM || 'jayronkids',
    instagram: env.SUPPORT_INSTAGRAM || 'jayronkids',
    pickupAddress: {
      uz: env.PICKUP_ADDRESS_UZ || 'Toshkent sh., Chilonzor tumani, Bunyodkor ko‘chasi, 1',
      ru: env.PICKUP_ADDRESS_RU || 'г. Ташкент, Чиланзарский район, улица Бунёдкор, 1',
    },
    freeDeliveryFrom: num(env.FREE_DELIVERY_FROM, 500000),
    minOrderTotal: num(env.MIN_ORDER_TOTAL, 50000),
    // Неоплаченный онлайн-заказ отменяется, и товар возвращается на склад
    unpaidOrderTtlMinutes: num(env.UNPAID_ORDER_TTL_MINUTES, 60),
    // Ставка НДС в фискальном чеке Payme (0 — для плательщиков налога с оборота без НДС)
    vatPercent: num(env.VAT_PERCENT, 12),
  },

  payme,
  click,
  // Учебная оплата: без договоров с Payme и Click онлайн-оплату можно пройти
  // на тестовой странице сервера. В продакшене отключена.
  demoPayments: !isProduction && bool(env.DEMO_PAYMENTS, true),

  sms,

  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    chatId: env.TELEGRAM_CHAT_ID || '',
    get enabled() { return Boolean(this.token && this.chatId); },
  },
};

module.exports = config;

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

const isProduction = env.NODE_ENV === 'production';

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    throw new Error(
      'SESSION_SECRET не задан или короче 32 символов. Задайте его в .env перед запуском в продакшене.'
    );
  }
  // Для разработки ключ сохраняется на диск, чтобы сессии переживали перезапуск.
  const devKeyFile = path.join(ROOT, 'data', '.session-secret');
  if (fs.existsSync(devKeyFile)) {
    sessionSecret = fs.readFileSync(devKeyFile, 'utf8').trim();
  } else {
    sessionSecret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(devKeyFile), { recursive: true });
    fs.writeFileSync(devKeyFile, sessionSecret, { mode: 0o600 });
  }
}

const config = {
  root: ROOT,
  isProduction,
  port: num(env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${num(env.PORT, 3000)}`).replace(/\/+$/, ''),

  sessionSecret,
  secureCookies: bool(env.SECURE_COOKIES, isProduction),
  sessionTimeoutMinutes: num(env.SESSION_TIMEOUT_MINUTES, 30),
  loginMaxAttempts: num(env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockMinutes: num(env.LOGIN_LOCK_MINUTES, 15),

  dbPath: path.resolve(ROOT, env.DB_PATH || './data/portal.db'),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || './data/uploads'),
  maxUploadBytes: num(env.MAX_UPLOAD_MB, 25) * 1024 * 1024,

  smtp: {
    host: env.SMTP_HOST || '',
    port: num(env.SMTP_PORT, 587),
    secure: (env.SMTP_SECURE || 'starttls').toLowerCase(), // tls | starttls | none
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    from: env.SMTP_FROM || 'portal@textile.gov.uz',
    get enabled() { return Boolean(env.SMTP_HOST); },
  },

  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    get enabled() { return Boolean(env.TELEGRAM_BOT_TOKEN); },
  },

  bootstrapAdmin: {
    email: env.ADMIN_EMAIL || 'admin@textile.gov.uz',
    password: env.ADMIN_PASSWORD || '',
  },

  // Время Ташкента (UTC+5) — всё хранится в UTC, отображается в TZ офиса.
  displayTimezone: 'Asia/Tashkent',
  displayOffsetMinutes: 300,
};

module.exports = config;

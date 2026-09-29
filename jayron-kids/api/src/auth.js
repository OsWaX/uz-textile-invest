'use strict';
/**
 * Вход покупателей по номеру телефона и SMS-коду, вход администратора по паролю,
 * сессии по токену в заголовке Authorization: Bearer <token>.
 */
const crypto = require('node:crypto');

const config = require('./config');
const db = require('./db');
const { sendSms } = require('./sms');
const { RateLimiter } = require('./ratelimit');
const { HttpError, badRequest, unauthorized, tooManyRequests } = require('./http');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function safeEqual(a, b) {
  const left = Buffer.from(sha256(String(a)), 'hex');
  const right = Buffer.from(sha256(String(b)), 'hex');
  return crypto.timingSafeEqual(left, right);
}

/** Приводит номер к виду 998XXXXXXXXX. Возвращает null для неузбекских номеров. */
function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 9) digits = `998${digits}`;
  return /^998\d{9}$/.test(digits) ? digits : null;
}

const formatPhone = (p) => (/^998\d{9}$/.test(p)
  ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10, 12)}`
  : p);

// --------------------------------------------------------------------------
// Сессии
// --------------------------------------------------------------------------
async function createSession(role, customerId, hours) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run(
    `INSERT INTO sessions (token_hash, role, customer_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [sha256(token), role, customerId, hours],
  );
  return token;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const session = await db.get(
    'SELECT role, customer_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [sha256(token)],
  );
  return session ? { role: session.role, customerId: session.customer_id } : null;
}

async function requireCustomer(req) {
  const session = await authenticate(req);
  if (!session || session.role !== 'customer') throw unauthorized();
  return session.customerId;
}

async function requireAdmin(req) {
  const session = await authenticate(req);
  if (!session || session.role !== 'admin') throw unauthorized();
}

async function logout(req) {
  const token = bearerToken(req);
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

// --------------------------------------------------------------------------
// SMS-коды
// --------------------------------------------------------------------------
const otpIpLimiter = new RateLimiter(config.otp.maxPerIpHour, 60 * 60 * 1000);

function smsText(code, language) {
  return language === 'ru'
    ? `Jayron Kids: код для входа ${code}. Никому не сообщайте его.`
    : `Jayron Kids: kirish kodi ${code}. Uni hech kimga aytmang.`;
}

async function requestCode(rawPhone, language, ip) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('invalid_phone');
  const { otp } = config;

  const row = await db.get(
    `SELECT EXTRACT(EPOCH FROM (now() - sent_at))::int AS since_sent,
            EXTRACT(EPOCH FROM (now() - window_start))::int AS since_window, window_count
       FROM otp_codes WHERE phone = $1`,
    [phone],
  );
  if (row && row.since_sent < otp.resendSeconds) {
    throw tooManyRequests('otp_too_soon', { retryIn: otp.resendSeconds - row.since_sent });
  }
  const sameWindow = row && row.since_window < 3600;
  if (sameWindow && row.window_count >= otp.maxPerHour) {
    throw tooManyRequests('otp_limit', { retryIn: 3600 - row.since_window });
  }
  if (!otpIpLimiter.take(ip || 'unknown')) throw tooManyRequests('otp_limit', { retryIn: 3600 });

  const code = String(crypto.randomInt(0, 10 ** otp.length)).padStart(otp.length, '0');
  // Условие в ON CONFLICT защищает от двух одновременных запросов на один номер
  const saved = await db.run(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, sent_at, window_start, window_count)
     VALUES ($1, $2, now() + make_interval(mins => $3), 0, now(), now(), 1)
     ON CONFLICT (phone) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now(),
       window_start = CASE WHEN $4 THEN otp_codes.window_start ELSE now() END,
       window_count = CASE WHEN $4 THEN otp_codes.window_count + 1 ELSE 1 END
     WHERE otp_codes.sent_at <= now() - make_interval(secs => $5)`,
    [phone, sha256(`${phone}:${code}`), otp.ttlMinutes, Boolean(sameWindow), otp.resendSeconds],
  );
  if (!saved.changes) throw tooManyRequests('otp_too_soon', { retryIn: otp.resendSeconds });

  try {
    await sendSms(phone, smsText(code, language));
  } catch (error) {
    console.error('Не удалось отправить SMS:', error.message);
    await db.run('DELETE FROM otp_codes WHERE phone = $1', [phone]);
    throw new HttpError(502, 'sms_failed');
  }

  const result = { phone, resendIn: otp.resendSeconds, length: otp.length };
  // Без SMS-шлюза код показывается в приложении, чтобы можно было войти при разработке
  if (config.sms.provider === 'console' && !config.isProduction) result.debugCode = code;
  return result;
}

async function verifyCode(rawPhone, code, language) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('invalid_phone');
  if (!/^\d{4,8}$/.test(String(code ?? ''))) throw badRequest('otp_invalid');

  // Попытка засчитывается атомарно до сравнения — перебор кода невозможен
  const row = await db.get(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE phone = $1 AND expires_at > now()
      RETURNING code_hash, attempts`,
    [phone],
  );
  if (!row) throw badRequest('otp_expired');
  if (row.attempts > config.otp.maxAttempts) throw tooManyRequests('otp_attempts');
  if (!safeEqual(row.code_hash, sha256(`${phone}:${code}`))) {
    throw badRequest('otp_invalid', { attemptsLeft: Math.max(0, config.otp.maxAttempts - row.attempts) });
  }

  return db.transaction(async () => {
    const deleted = await db.run('DELETE FROM otp_codes WHERE phone = $1', [phone]);
    if (!deleted.changes) throw badRequest('otp_expired'); // код уже использован параллельным запросом
    const lang = language === 'ru' ? 'ru' : 'uz';
    const { row: customer } = await db.run(
      `INSERT INTO customers (phone, language) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING *`,
      [phone, lang],
    );
    const token = await createSession('customer', customer.id, config.sessionDays * 24);
    return { token, customer: formatCustomer(customer) };
  });
}

function formatCustomer(c) {
  return {
    id: c.id,
    phone: c.phone,
    phoneFormatted: formatPhone(c.phone),
    name: c.name,
    language: c.language,
    lastAddress: c.last_address || null,
  };
}

// --------------------------------------------------------------------------
// Администратор
// --------------------------------------------------------------------------
const adminLimiter = new RateLimiter(10, 15 * 60 * 1000);

async function adminLogin(password, ip) {
  const key = ip || 'unknown';
  if (!adminLimiter.take(key)) throw tooManyRequests('too_many_attempts');
  if (!config.adminPassword || !safeEqual(String(password ?? ''), config.adminPassword)) {
    throw unauthorized('invalid_password');
  }
  adminLimiter.reset(key);
  return createSession('admin', null, config.adminSessionHours);
}

module.exports = {
  normalizePhone, formatPhone, formatCustomer,
  authenticate, requireCustomer, requireAdmin, logout,
  requestCode, verifyCode, adminLogin,
};

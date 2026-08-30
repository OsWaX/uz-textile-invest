'use strict';
/**
 * Аутентификация (п. 2.4 ТЗ): пароли — только в виде соли и хеша scrypt,
 * сессии — подписанные HttpOnly-cookie, двухфакторная аутентификация — TOTP,
 * блокировка учётной записи после серии неудачных попыток, тайм-аут неактивности.
 */
const crypto = require('node:crypto');
const config = require('./config');
const { run, get, getSetting } = require('./db');
const { setCookie, parseCookies, unauthorized, badRequest } = require('./lib/http');
const totp = require('./lib/totp');

const COOKIE_NAME = 'po_session';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  const expected = Buffer.from(expectedHash, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

/** Требования к паролю (минимальная сложность). */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Пароль должен содержать не менее 10 символов';
  }
  if (!/[a-zа-яё]/i.test(password) || !/\d/.test(password)) {
    return 'Пароль должен содержать буквы и цифры';
  }
  return null;
}

const sign = (value) =>
  crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

function signToken(sessionId) {
  return `${sessionId}.${sign(sessionId)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const sessionId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(sessionId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

function createSession(user, req, res) {
  const sessionId = crypto.randomUUID();
  run(
    'INSERT INTO sessions (id, user_id, ip, user_agent) VALUES (?, ?, ?, ?)',
    sessionId, user.id, req.clientIp || '', (req.headers['user-agent'] || '').slice(0, 250)
  );
  setCookie(res, COOKIE_NAME, signToken(sessionId), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    maxAge: 12 * 3600,
  });
  return sessionId;
}

function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  const sessionId = verifyToken(token);
  if (sessionId) run('UPDATE sessions SET revoked = 1 WHERE id = ?', sessionId);
  setCookie(res, COOKIE_NAME, '', { maxAge: 0, httpOnly: true, secure: config.secureCookies });
}

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  full_name: user.full_name,
  position: user.position,
  role: user.role,
  region_id: user.region_id,
  language: user.language,
  phone: user.phone,
  telegram_chat_id: user.telegram_chat_id,
  totp_enabled: Boolean(user.totp_enabled),
  notify_inapp: Boolean(user.notify_inapp),
  notify_email: Boolean(user.notify_email),
  notify_telegram: Boolean(user.notify_telegram),
  must_change_pwd: Boolean(user.must_change_pwd),
  last_login_at: user.last_login_at,
});

/**
 * Возвращает пользователя текущей сессии либо null.
 * Сессия завершается по тайм-ауту неактивности (настройка администратора).
 */
function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  const sessionId = verifyToken(token);
  if (!sessionId) return null;

  const session = get('SELECT * FROM sessions WHERE id = ? AND revoked = 0', sessionId);
  if (!session) return null;

  const timeoutMinutes = Number(getSetting('security.session_timeout_minutes', config.sessionTimeoutMinutes));
  const lastSeen = new Date(`${session.last_seen_at.replace(' ', 'T')}Z`).getTime();
  if (Number.isFinite(lastSeen) && Date.now() - lastSeen > timeoutMinutes * 60000) {
    run('UPDATE sessions SET revoked = 1 WHERE id = ?', sessionId);
    return null;
  }

  const user = get('SELECT * FROM users WHERE id = ? AND is_active = 1', session.user_id);
  if (!user) return null;

  run("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?", sessionId);
  user.sessionId = sessionId;
  return user;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw unauthorized('Сессия истекла или отсутствует. Войдите в систему заново.');
  return user;
}

/** Учёт неудачных попыток входа и временная блокировка учётной записи. */
function registerFailedAttempt(user) {
  const attempts = (user.failed_attempts || 0) + 1;
  const maxAttempts = config.loginMaxAttempts;
  if (attempts >= maxAttempts) {
    const until = new Date(Date.now() + config.loginLockMinutes * 60000)
      .toISOString().slice(0, 19).replace('T', ' ');
    run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', attempts, until, user.id);
    return { locked: true, until };
  }
  run('UPDATE users SET failed_attempts = ? WHERE id = ?', attempts, user.id);
  return { locked: false, remaining: maxAttempts - attempts };
}

function isLocked(user) {
  if (!user.locked_until) return false;
  const until = new Date(`${user.locked_until.replace(' ', 'T')}Z`).getTime();
  if (Date.now() >= until) {
    run('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?', user.id);
    return false;
  }
  return true;
}

function resetAttempts(user) {
  run(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?",
    user.id
  );
}

/** Подготовка секрета TOTP для подключения двухфакторной аутентификации. */
function beginTotpSetup(user) {
  const secret = totp.generateSecret();
  run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', secret, user.id);
  return { secret, uri: totp.otpauthUri(secret, user.email) };
}

function confirmTotp(user, code) {
  const fresh = get('SELECT totp_secret FROM users WHERE id = ?', user.id);
  if (!fresh?.totp_secret) throw badRequest('Сначала запросите секретный ключ для приложения-аутентификатора');
  if (!totp.verifyCode(fresh.totp_secret, code)) throw badRequest('Неверный одноразовый код');
  run('UPDATE users SET totp_enabled = 1 WHERE id = ?', user.id);
  return true;
}

module.exports = {
  COOKIE_NAME,
  hashPassword, verifyPassword, validatePassword,
  createSession, destroySession, currentUser, requireUser,
  registerFailedAttempt, isLocked, resetAttempts,
  beginTotpSetup, confirmTotp, publicUser,
  verifyTotpCode: totp.verifyCode,
};

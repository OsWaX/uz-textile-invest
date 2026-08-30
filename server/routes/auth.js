'use strict';
/** Вход, двухфакторная аутентификация, профиль пользователя. */
const { Router, badRequest, unauthorized, forbidden } = require('../lib/http');
const { get, run, getSetting } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const rbac = require('../rbac');
const v = require('../lib/validate');

const router = new Router();

router.post('/api/auth/login', async (ctx) => {
  const email = v.email(ctx.body.email, 'Электронная почта', { required: true });
  const password = String(ctx.body.password || '');
  const code = String(ctx.body.code || '').trim();

  const user = get('SELECT * FROM users WHERE email = ?', email);
  const genericError = unauthorized('Неверный адрес электронной почты или пароль');

  if (!user || !user.is_active) {
    audit.record({ user: null, action: 'login_failed', summary: `Неизвестный или отключённый пользователь: ${email}`, req: ctx.req });
    throw genericError;
  }
  if (auth.isLocked(user)) {
    throw forbidden(`Учётная запись временно заблокирована из-за неудачных попыток входа. Повторите попытку позже или обратитесь к администратору.`);
  }
  if (!auth.verifyPassword(password, user.password_salt, user.password_hash)) {
    const state = auth.registerFailedAttempt(user);
    audit.record({ user: null, action: 'login_failed', entityType: 'user', entityId: user.id, summary: `Неверный пароль: ${email}`, req: ctx.req });
    if (state.locked) throw forbidden('Учётная запись заблокирована после нескольких неудачных попыток входа. Обратитесь к администратору.');
    throw genericError;
  }

  const require2fa = Boolean(user.totp_enabled) || getSetting('security.require_2fa', false);
  if (user.totp_enabled) {
    if (!code) return { step: '2fa', message: 'Введите одноразовый код из приложения-аутентификатора' };
    if (!auth.verifyTotpCode(user.totp_secret, code)) {
      auth.registerFailedAttempt(user);
      audit.record({ user: null, action: 'login_failed', entityType: 'user', entityId: user.id, summary: 'Неверный одноразовый код', req: ctx.req });
      throw unauthorized('Неверный одноразовый код');
    }
  } else if (require2fa) {
    // Политика требует 2FA — пользователь обязан подключить её при первом входе.
    auth.resetAttempts(user);
    auth.createSession(user, ctx.req, ctx.res);
    audit.record({ user, action: 'login', entityType: 'user', entityId: user.id, summary: 'Вход без 2FA — требуется подключение', req: ctx.req });
    return { step: 'setup_2fa', user: auth.publicUser(user), permissions: rbac.permissionsFor(user) };
  }

  auth.resetAttempts(user);
  auth.createSession(user, ctx.req, ctx.res);
  audit.record({ user, action: 'login', entityType: 'user', entityId: user.id, summary: 'Успешный вход в систему', req: ctx.req });

  const fresh = get('SELECT * FROM users WHERE id = ?', user.id);
  return { step: 'ok', user: auth.publicUser(fresh), permissions: rbac.permissionsFor(fresh) };
});

router.post('/api/auth/logout', async (ctx) => {
  if (ctx.user) audit.record({ user: ctx.user, action: 'logout', entityType: 'user', entityId: ctx.user.id, summary: 'Выход из системы', req: ctx.req });
  auth.destroySession(ctx.req, ctx.res);
  return { ok: true };
});

router.get('/api/auth/me', async (ctx) => {
  if (!ctx.user) throw unauthorized();
  return {
    user: auth.publicUser(ctx.user),
    permissions: rbac.permissionsFor(ctx.user),
    require_2fa: Boolean(getSetting('security.require_2fa', false)),
  };
});

router.patch('/api/auth/profile', async (ctx) => {
  const user = ctx.requireUser();
  const before = auth.publicUser(user);
  const fullName = v.str(ctx.body.full_name ?? user.full_name, 'ФИО', { required: true, max: 200 });
  const phone = v.str(ctx.body.phone ?? user.phone, 'Телефон', { max: 40 });
  const telegram = v.str(ctx.body.telegram_chat_id ?? user.telegram_chat_id, 'Telegram chat ID', { max: 40 });
  const language = v.oneOf(ctx.body.language ?? user.language, 'Язык интерфейса', ['ru', 'uz', 'en']);

  run(
    `UPDATE users SET full_name = ?, phone = ?, telegram_chat_id = ?, language = ?,
       notify_inapp = ?, notify_email = ?, notify_telegram = ?, updated_at = datetime('now')
     WHERE id = ?`,
    fullName, phone, telegram, language,
    v.bool(ctx.body.notify_inapp, Boolean(user.notify_inapp)) ? 1 : 0,
    v.bool(ctx.body.notify_email, Boolean(user.notify_email)) ? 1 : 0,
    v.bool(ctx.body.notify_telegram, Boolean(user.notify_telegram)) ? 1 : 0,
    user.id
  );

  const after = auth.publicUser(get('SELECT * FROM users WHERE id = ?', user.id));
  audit.record({
    user, action: 'update', entityType: 'user', entityId: user.id,
    summary: 'Изменение собственного профиля', changes: audit.diff(before, after), req: ctx.req,
  });
  return after;
});

router.post('/api/auth/password', async (ctx) => {
  const user = ctx.requireUser();
  const current = String(ctx.body.current_password || '');
  const next = String(ctx.body.new_password || '');
  if (!auth.verifyPassword(current, user.password_salt, user.password_hash)) {
    throw badRequest('Текущий пароль указан неверно');
  }
  const problem = auth.validatePassword(next);
  if (problem) throw badRequest(problem);

  const { salt, hash } = auth.hashPassword(next);
  run(
    "UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 0, updated_at = datetime('now') WHERE id = ?",
    hash, salt, user.id
  );
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id <> ?', user.id, user.sessionId);
  audit.record({ user, action: 'update', entityType: 'user', entityId: user.id, summary: 'Смена собственного пароля', req: ctx.req });
  return { ok: true };
});

router.post('/api/auth/2fa/setup', async (ctx) => {
  const user = ctx.requireUser();
  return auth.beginTotpSetup(user);
});

router.post('/api/auth/2fa/confirm', async (ctx) => {
  const user = ctx.requireUser();
  auth.confirmTotp(user, ctx.body.code);
  audit.record({ user, action: 'update', entityType: 'user', entityId: user.id, summary: 'Подключена двухфакторная аутентификация', req: ctx.req });
  return { ok: true };
});

router.post('/api/auth/2fa/disable', async (ctx) => {
  const user = ctx.requireUser();
  if (getSetting('security.require_2fa', false) && user.role !== 'admin') {
    throw forbidden('Политика безопасности требует обязательной двухфакторной аутентификации');
  }
  if (!auth.verifyPassword(String(ctx.body.password || ''), user.password_salt, user.password_hash)) {
    throw badRequest('Для отключения 2FA укажите текущий пароль');
  }
  run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', user.id);
  audit.record({ user, action: 'update', entityType: 'user', entityId: user.id, summary: 'Отключена двухфакторная аутентификация', req: ctx.req });
  return { ok: true };
});

module.exports = router;

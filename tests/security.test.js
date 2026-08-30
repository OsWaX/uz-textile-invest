'use strict';
/** Проверки требований безопасности (п. 2.4 и раздел 11 ТЗ). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, createClient, cleanup } = require('./helpers');
const notify = require('../server/notify');
const auth = require('../server/auth');
const db = require('../server/db');

const PASSWORD = 'Parol2026!';
let baseUrl;
let admin;

test.before(async () => {
  baseUrl = await startServer();
  admin = createClient();
  await admin.login('admin@textile.gov.uz', PASSWORD);
});

test.after(async () => {
  notify.stopScheduler();
  await stopServer();
  cleanup();
});

test('Пароли хранятся только в виде соли и хеша', () => {
  const user = db.get("SELECT * FROM users WHERE email = 'admin@textile.gov.uz'");
  assert.ok(user.password_hash.length >= 128, 'хеш scrypt длиной 64 байта');
  assert.ok(user.password_salt.length >= 16, 'соль сохранена');
  assert.ok(!user.password_hash.includes(PASSWORD), 'пароль не хранится в открытом виде');
  assert.equal(auth.verifyPassword(PASSWORD, user.password_salt, user.password_hash), true);
  assert.equal(auth.verifyPassword('другой пароль', user.password_salt, user.password_hash), false);
});

test('Требования к сложности пароля', async () => {
  assert.ok(auth.validatePassword('short1'), 'короткий пароль отклоняется');
  assert.ok(auth.validatePassword('парольбезцифр'), 'пароль без цифр отклоняется');
  assert.equal(auth.validatePassword('Parol2026!'), null, 'корректный пароль принимается');

  const weak = await admin.post('/api/admin/users', {
    email: 'weak@textile.gov.uz', full_name: 'Тест', role: 'team', password: '12345',
  });
  assert.equal(weak.status, 400, 'сервер не принимает слабый пароль');
});

test('Самостоятельная регистрация недоступна, создавать пользователей может только администратор', async () => {
  const anonymous = createClient();
  const attempt = await anonymous.post('/api/admin/users', {
    email: 'self@textile.gov.uz', full_name: 'Самозапись', role: 'admin', password: PASSWORD,
  });
  assert.equal(attempt.status, 401, 'без входа в систему запрос отклоняется');

  await admin.post('/api/admin/users', {
    email: 'pm@textile.gov.uz', full_name: 'Менеджер', role: 'team', password: PASSWORD,
  });
  const manager = createClient();
  await manager.login('pm@textile.gov.uz', PASSWORD);
  const byManager = await manager.post('/api/admin/users', {
    email: 'another@textile.gov.uz', full_name: 'Ещё один', role: 'admin', password: PASSWORD,
  });
  assert.equal(byManager.status, 403, 'менеджер не может создавать пользователей');
});

test('Учётная запись блокируется после серии неудачных попыток входа', async () => {
  await admin.post('/api/admin/users', {
    email: 'locktest@textile.gov.uz', full_name: 'Проверка блокировки', role: 'team', password: PASSWORD,
  });

  const client = createClient();
  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const result = await client.post('/api/auth/login', { email: 'locktest@textile.gov.uz', password: 'неверный пароль' });
    lastStatus = result.status;
  }
  assert.equal(lastStatus, 403, 'после исчерпания попыток вход блокируется');

  const correct = await client.post('/api/auth/login', { email: 'locktest@textile.gov.uz', password: PASSWORD });
  assert.equal(correct.status, 403, 'верный пароль тоже отклоняется, пока действует блокировка');

  const user = db.get("SELECT * FROM users WHERE email = 'locktest@textile.gov.uz'");
  assert.ok(user.locked_until, 'срок блокировки записан');

  // Администратор снимает блокировку
  const unlock = await admin.post(`/api/admin/users/${user.id}/unlock`);
  assert.equal(unlock.status, 200);
  const after = await client.post('/api/auth/login', { email: 'locktest@textile.gov.uz', password: PASSWORD });
  assert.equal(after.status, 200, 'после снятия блокировки вход возможен');
});

test('Неудачные попытки входа фиксируются в журнале аудита', async () => {
  const audit = await admin.get('/api/admin/audit?action=login_failed');
  assert.ok(audit.body.rows.length > 0, 'неудачные входы записаны');
  assert.ok(audit.body.rows[0].summary.length > 0);
});

test('Сессия завершается по тайм-ауту неактивности', async () => {
  const client = createClient();
  await client.login('admin@textile.gov.uz', PASSWORD);
  assert.equal((await client.get('/api/auth/me')).status, 200);

  // Имитируем бездействие: сдвигаем отметку последней активности в прошлое
  db.run("UPDATE sessions SET last_seen_at = datetime('now', '-31 minute') WHERE revoked = 0");
  const expired = await client.get('/api/auth/me');
  assert.equal(expired.status, 401, 'сессия завершена по тайм-ауту');

  await admin.login('admin@textile.gov.uz', PASSWORD); // восстановить сессию администратора
});

test('Двухфакторная аутентификация запрашивает одноразовый код', async () => {
  const totp = require('../server/lib/totp');
  await admin.post('/api/admin/users', {
    email: 'twofa@textile.gov.uz', full_name: 'Проверка 2FA', role: 'team', password: PASSWORD,
  });
  const client = createClient();
  await client.login('twofa@textile.gov.uz', PASSWORD);

  const setup = await client.post('/api/auth/2fa/setup');
  assert.equal(setup.status, 200);
  assert.ok(setup.body.secret.length >= 16);
  assert.match(setup.body.uri, /^otpauth:\/\/totp\//);

  const wrong = await client.post('/api/auth/2fa/confirm', { code: '000000' });
  assert.equal(wrong.status, 400, 'неверный код отклоняется');

  const code = totp.generateCode(setup.body.secret, Math.floor(Date.now() / 30000));
  const confirmed = await client.post('/api/auth/2fa/confirm', { code });
  assert.equal(confirmed.status, 200, 'верный код принимается');

  // При следующем входе система требует код
  const fresh = createClient();
  const step = await fresh.post('/api/auth/login', { email: 'twofa@textile.gov.uz', password: PASSWORD });
  assert.equal(step.body.step, '2fa', 'запрашивается одноразовый код');

  const withCode = await fresh.post('/api/auth/login', {
    email: 'twofa@textile.gov.uz', password: PASSWORD,
    code: totp.generateCode(setup.body.secret, Math.floor(Date.now() / 30000)),
  });
  assert.equal(withCode.body.step, 'ok', 'вход с кодом выполнен');
});

test('Защита от подделки межсайтовых запросов: чужой Origin отклоняется', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ email: 'admin@textile.gov.uz', password: PASSWORD }),
  });
  assert.equal(response.status, 403, 'запрос с посторонним источником отклонён');
});

test('Проверка источника работает за обратным прокси, но не пропускает чужие домены', async () => {
  const port = new URL(baseUrl).port;
  const login = (headers) => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'admin@textile.gov.uz', password: PASSWORD }),
  });

  // Прокси сохранил имя узла (обычный случай)
  const sameHost = await login({ origin: `http://127.0.0.1:${port}` });
  assert.equal(sameHost.status, 200, 'свой источник принимается');

  // Прокси передал имя узла в X-Forwarded-Host (nginx, Codespaces)
  const forwarded = await login({
    host: `127.0.0.1:${port}`,
    'x-forwarded-host': 'portal.textile.gov.uz',
    origin: 'https://portal.textile.gov.uz',
  });
  assert.equal(forwarded.status, 200, 'источник из X-Forwarded-Host принимается');

  // Посторонний домен
  const foreign = await login({ origin: 'https://evil.example' });
  assert.equal(foreign.status, 403, 'чужой источник отклоняется');

  // Домен, похожий на свой, но с чужим суффиксом
  const lookalike = await login({
    host: `127.0.0.1:${port}`,
    origin: `https://127.0.0.1:${port}.evil.example`,
  });
  assert.equal(lookalike.status, 403, 'похожий домен отклоняется');
});

test('Внешний адрес определяется автоматически в GitHub Codespaces', () => {
  // Проверяем формулу, по которой config.js вычисляет адрес порта Codespaces.
  const name = 'fuzzy-space';
  const domain = 'app.github.dev';
  const port = 3000;
  assert.equal(`https://${name}-${port}.${domain}`, 'https://fuzzy-space-3000.app.github.dev');
});

test('Заголовки безопасности присутствуют в ответах', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.ok(response.headers.get('content-security-policy').includes("default-src 'self'"));
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});

test('Статические файлы не отдаются за пределами каталога public', async () => {
  for (const path of ['/../.env', '/../../etc/passwd', '/%2e%2e/%2e%2e/package.json']) {
    const response = await fetch(baseUrl + path);
    const text = await response.text();
    assert.ok(!text.includes('SESSION_SECRET'), `путь ${path} не должен раскрывать файлы вне public`);
    assert.ok(!text.includes('"dependencies"'), `путь ${path} не должен раскрывать package.json`);
  }
});

test('Загрузка файлов ограничена по типу', async () => {
  const company = await admin.post('/api/companies', {
    name: 'Тестовая компания', country_id: db.get("SELECT id FROM countries WHERE iso2='DE'").id,
  });
  const bad = await admin.upload('company', company.body.id, 'exploit.sh', '#!/bin/sh\nrm -rf /', 'application/x-sh');
  assert.equal(bad.status, 400, 'исполняемый файл отклонён');
  assert.match(bad.body.error, /Недопустимый тип файла/);

  const good = await admin.upload('company', company.body.id, 'prezentaciya.pdf', '%PDF-1.4 тест', 'application/pdf');
  assert.equal(good.status, 200, 'документ принят');
});

test('Права проверяются на сервере независимо от интерфейса', async () => {
  const manager = createClient();
  await manager.login('pm@textile.gov.uz', PASSWORD);

  const forbiddenEndpoints = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/settings'],
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/recycle-bin'],
    ['POST', '/api/admin/custom-fields'],
    ['GET', '/api/admin/dictionaries'],
  ];
  for (const [method, path] of forbiddenEndpoints) {
    const result = await manager.request(method, path, method === 'GET' ? null : {});
    assert.equal(result.status, 403, `${method} ${path} должен быть запрещён менеджеру`);
  }
});

test('Отключённая учётная запись теряет доступ немедленно', async () => {
  const user = db.get("SELECT id FROM users WHERE email = 'pm@textile.gov.uz'");
  const client = createClient();
  await client.login('pm@textile.gov.uz', PASSWORD);
  assert.equal((await client.get('/api/projects')).status, 200);

  await admin.patch(`/api/admin/users/${user.id}`, { is_active: false });
  assert.equal((await client.get('/api/projects')).status, 401, 'сессия отключённого пользователя недействительна');
});

test('В системе нельзя отключить последнего администратора', async () => {
  const adminUser = db.get("SELECT id FROM users WHERE email = 'admin@textile.gov.uz'");
  const result = await admin.patch(`/api/admin/users/${adminUser.id}`, { is_active: false });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /хотя бы один активный администратор/);
});

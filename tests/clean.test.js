'use strict';
/** Очистка рабочих данных: scripts/clean.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-clean-'));
const uploadDir = path.join(workDir, 'uploads');
const backupDir = path.join(workDir, 'backups');
const testDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgres://portal:portal@127.0.0.1:5432/uz_textile_portal_clean_test';

if (!/test/i.test(new URL(testDatabaseUrl).pathname)) {
  throw new Error('TEST_DATABASE_URL должен указывать на отдельную тестовую базу PostgreSQL');
}

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  UPLOAD_DIR: uploadDir,
  BACKUP_DIR: backupDir,
  SESSION_SECRET: 'test-secret-key-for-clean-tests-0123456789',
  ADMIN_EMAIL: 'admin@textile.gov.uz',
  ADMIN_PASSWORD: 'Parol2026!',
};

const script = (name, args = [], extraEnv = {}) =>
  execFileSync(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(ROOT, 'scripts', name), ...args],
    { cwd: ROOT, env: { ...env, ...extraEnv }, encoding: 'utf8' });

async function counts(tables) {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    const result = {};
    for (const table of tables) {
      result[table] = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
    }
    return result;
  } finally {
    await pool.end();
  }
}

const seedFresh = () => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  script('seed.js', ['--reset']);
};

test('clean.js удаляет рабочие данные и сохраняет справочники', async () => {
  seedFresh();
  fs.writeFileSync(path.join(uploadDir, 'demo-file.bin'), 'demo');

  const before = await counts(['projects', 'companies', 'visits', 'users']);
  assert.ok(before.projects > 0 && before.companies > 0 && before.visits > 0);

  const output = script('clean.js', ['--all', '--yes', '--no-backup']);
  assert.match(output, /Рабочие данные удалены/);

  const after = await counts([
    'projects', 'companies', 'visits', 'meetings', 'contacts', 'roadmap_steps',
    'project_partners', 'project_locations', 'comments', 'attachments', 'audit_log',
    'sessions', 'custom_fields', 'users', 'regions', 'countries', 'uz_regions',
    'dictionaries', 'settings',
  ]);

  for (const table of ['projects', 'companies', 'visits', 'meetings', 'contacts', 'roadmap_steps',
    'project_partners', 'project_locations', 'comments', 'attachments', 'audit_log', 'sessions', 'custom_fields']) {
    assert.equal(after[table], 0, `таблица ${table} должна быть пустой`);
  }

  // Справочники и настройки остаются нетронутыми.
  assert.equal(after.regions, 9);
  assert.equal(after.uz_regions, 14);
  assert.ok(after.countries > 50);
  assert.ok(after.dictionaries > 0);
  assert.ok(after.settings > 0);

  // Остаётся ровно одна учётная запись администратора.
  assert.equal(after.users, 1);
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    const admin = (await pool.query('SELECT email, role, must_change_pwd FROM users')).rows[0];
    assert.equal(admin.role, 'admin');
    assert.equal(admin.must_change_pwd, 1, 'демонстрационный пароль должен быть сброшен');
  } finally {
    await pool.end();
  }

  // Загруженные файлы удалены.
  assert.deepEqual(fs.readdirSync(uploadDir), []);
});

test('clean.js без --users сохраняет пользователей и поля форм', async () => {
  seedFresh();
  const before = await counts(['users', 'custom_fields']);

  script('clean.js', ['--yes', '--no-backup']);

  const after = await counts(['projects', 'companies', 'users', 'custom_fields']);
  assert.equal(after.projects, 0);
  assert.equal(after.companies, 0);
  assert.equal(after.users, before.users);
  assert.equal(after.custom_fields, before.custom_fields);
});

test('clean.js создаёт резервную копию базы', async () => {
  seedFresh();
  const before = fs.readdirSync(backupDir).filter((f) => f.startsWith('portal-backup-'));
  script('clean.js', ['--yes']);
  const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith('portal-backup-'));
  assert.equal(backups.length, before.length + 1);
  assert.ok(fs.statSync(path.join(backupDir, backups.at(-1))).size > 0, 'дамп базы не пустой');
});

test('clean.js без подтверждения ничего не удаляет', async () => {
  seedFresh();
  const before = await counts(['projects']);

  assert.throws(() => script('clean.js'), (error) => {
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /Добавьте --yes/);
    return true;
  });

  assert.equal((await counts(['projects'])).projects, before.projects);
});

test('clean.js отклоняет неизвестные параметры', () => {
  assert.throws(() => script('clean.js', ['--drop-everything']), (error) => {
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /Неизвестный параметр/);
    return true;
  });
});

test.after(() => fs.rmSync(workDir, { recursive: true, force: true }));

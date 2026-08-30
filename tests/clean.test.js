'use strict';
/** Очистка рабочих данных: scripts/clean.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-clean-'));
const dbPath = path.join(workDir, 'portal.db');
const uploadDir = path.join(workDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DB_PATH: dbPath,
  UPLOAD_DIR: uploadDir,
  SESSION_SECRET: 'test-secret-key-for-clean-tests-0123456789',
};

const script = (name, args = [], extraEnv = {}) =>
  execFileSync(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(ROOT, 'scripts', name), ...args],
    { cwd: ROOT, env: { ...env, ...extraEnv }, encoding: 'utf8' });

function counts(tables) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const result = {};
  for (const table of tables) {
    result[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  db.close();
  return result;
}

const seedFresh = () => {
  fs.rmSync(dbPath, { force: true });
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  script('seed.js');
};

test('clean.js удаляет рабочие данные и сохраняет справочники', () => {
  seedFresh();
  fs.writeFileSync(path.join(uploadDir, 'demo-file.bin'), 'demo');

  const before = counts(['projects', 'companies', 'visits', 'users']);
  assert.ok(before.projects > 0 && before.companies > 0 && before.visits > 0);

  const output = script('clean.js', ['--all', '--yes', '--no-backup']);
  assert.match(output, /Рабочие данные удалены/);

  const after = counts([
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
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const admin = db.prepare('SELECT email, role, must_change_pwd FROM users').get();
  db.close();
  assert.equal(admin.role, 'admin');
  assert.equal(admin.must_change_pwd, 1, 'демонстрационный пароль должен быть сброшен');

  // Загруженные файлы удалены.
  assert.deepEqual(fs.readdirSync(uploadDir), []);
});

test('clean.js без --users сохраняет пользователей и поля форм', () => {
  seedFresh();
  const before = counts(['users', 'custom_fields']);

  script('clean.js', ['--yes', '--no-backup']);

  const after = counts(['projects', 'companies', 'users', 'custom_fields']);
  assert.equal(after.projects, 0);
  assert.equal(after.companies, 0);
  assert.equal(after.users, before.users);
  assert.equal(after.custom_fields, before.custom_fields);
});

test('clean.js создаёт резервную копию базы', () => {
  seedFresh();
  const before = fs.readdirSync(workDir).filter((f) => f.startsWith('portal-backup-'));
  script('clean.js', ['--yes']);
  const backups = fs.readdirSync(workDir).filter((f) => f.startsWith('portal-backup-'));
  assert.equal(backups.length, before.length + 1);

  // Копия сделана до удаления — демонстрационные проекты в ней сохранились.
  const copy = new DatabaseSync(path.join(workDir, backups.at(-1)), { readOnly: true });
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM projects').get().n > 0);
  copy.close();
});

test('clean.js без подтверждения ничего не удаляет', () => {
  seedFresh();
  const before = counts(['projects']);

  assert.throws(() => script('clean.js'), (error) => {
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /Добавьте --yes/);
    return true;
  });

  assert.equal(counts(['projects']).projects, before.projects);
});

test('clean.js отклоняет неизвестные параметры', () => {
  assert.throws(() => script('clean.js', ['--drop-everything']), (error) => {
    assert.equal(error.status, 1);
    assert.match(String(error.stderr), /Неизвестный параметр/);
    return true;
  });
});

test.after(() => fs.rmSync(workDir, { recursive: true, force: true }));

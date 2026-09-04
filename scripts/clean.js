'use strict';
/**
 * Полная очистка рабочих данных портала — удаление демонстрационных
 * (или любых накопленных) записей перед началом реальной эксплуатации.
 *
 *   node scripts/clean.js                 очистить проекты, компании, визиты,
 *                                         встречи, файлы, комментарии, уведомления
 *                                         и журнал аудита
 *   node scripts/clean.js --users         дополнительно удалить всех пользователей,
 *                                         кроме одной учётной записи администратора
 *   node scripts/clean.js --fields        дополнительно удалить поля конструктора форм
 *   node scripts/clean.js --all           всё перечисленное выше
 *   node scripts/clean.js --yes           не запрашивать подтверждение
 *   node scripts/clean.js --no-backup     не создавать резервную копию базы
 *
 * Сохраняются в любом случае: структура базы данных, справочники (регионы мира,
 * страны, области Узбекистана, статусы, отрасли) и настройки системы.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');

const config = require('../server/config');
const { db, get, run, pluck, transaction } = require('../server/db');
const reference = require('../server/reference');
const auth = require('../server/auth');

const DEMO_PASSWORD = 'Parol2026!';
const CONFIRM_WORD = 'УДАЛИТЬ';

const KNOWN = new Set(['--users', '--fields', '--all', '--yes', '-y', '--no-backup', '--help', '-h']);
const args = process.argv.slice(2);

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
}

if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }

const unknown = args.filter((arg) => !KNOWN.has(arg));
if (unknown.length) {
  console.error(`Неизвестный параметр: ${unknown.join(', ')}\n`);
  usage();
  process.exit(1);
}

const wipeAll = args.includes('--all');
const wipeUsers = wipeAll || args.includes('--users');
const wipeFields = wipeAll || args.includes('--fields');
const assumeYes = args.includes('--yes') || args.includes('-y');
const makeBackup = !args.includes('--no-backup');

// Таблицы с рабочими данными. Порядок — от зависимых к основным.
const DATA_TABLES = [
  'poll_votes', 'custom_values', 'correction_requests',
  'notification_deliveries', 'notifications', 'audit_log', 'saved_filters',
  'comments', 'attachments', 'contacts', 'meetings', 'visit_members', 'visits',
  'project_locations', 'project_partners', 'roadmap_steps', 'project_status_history',
  'projects', 'companies', 'sessions',
];

main().catch((error) => {
  console.error(`\n  Ошибка очистки: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => db.close());

async function main() {
  await reference.ensureReference();

  const summary = await buildSummary();
  const total = summary.reduce((sum, [, value]) => sum + value, 0);

  console.log('\n  Будут безвозвратно удалены:');
  for (const [label, value] of summary) {
    console.log(`     ${String(value).padStart(6)}  ${label}`);
  }
  console.log('\n  Сохраняются: структура базы, справочники и настройки системы.');
  if (!wipeUsers) console.log('  Сохраняются: учётные записи пользователей (используйте --users, чтобы удалить и их).');
  if (!wipeFields) console.log('  Сохраняются: поля конструктора форм (используйте --fields, чтобы удалить и их).');
  console.log(`  База данных: ${databaseLabel()}\n`);

  if (total === 0 && !wipeUsers && !wipeFields) {
    console.log('  Удалять нечего — рабочих данных в системе нет.\n');
    return;
  }

  if (!assumeYes) {
    if (!process.stdin.isTTY) {
      throw new Error('Запуск без интерактивного терминала. Добавьте --yes для подтверждения.');
    }
    const answer = await ask(`  Введите ${CONFIRM_WORD} для подтверждения: `);
    if (answer.trim().toUpperCase() !== CONFIRM_WORD) {
      console.log('\n  Отменено. Ничего не удалено.\n');
      return;
    }
  }

  if (makeBackup) {
    const backup = backupDatabase();
    console.log(`\n  Резервная копия базы: ${backup}`);
  }

  const files = removeUploads();
  const keptAdmin = wipeUsers ? await chooseAdminToKeep() : null;

  await transaction(async () => {
    for (const table of DATA_TABLES) await run(`DELETE FROM ${table}`);
    if (wipeFields) await run('DELETE FROM custom_fields');
    if (wipeUsers) {
      if (!wipeFields) await run('UPDATE custom_fields SET created_by = NULL');
      if (keptAdmin) {
        await run('DELETE FROM users WHERE id <> ?', keptAdmin.id);
        await run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', keptAdmin.id);
      } else {
        await run('DELETE FROM users');
      }
    }
  });

  // Справочники и настройки восстанавливаются, если чего-то не хватает.
  await reference.ensureReference();

  const newPassword = keptAdmin ? await resetDemoPassword(keptAdmin) : null;

  try {
    await db.exec('VACUUM');
  } catch (error) {
    console.warn(`  VACUUM не выполнен: ${error.message}`);
  }

  console.log('\n  Готово. Рабочие данные удалены.');
  if (files) console.log(`  Удалено загруженных файлов: ${files}`);
  if (keptAdmin) {
    console.log(`  Сохранена учётная запись администратора: ${keptAdmin.email}`);
    if (newPassword) {
      console.log('\n  Демонстрационный пароль заменён на новый:');
      console.log(`     Логин:  ${keptAdmin.email}`);
      console.log(`     Пароль: ${newPassword}`);
      console.log('     Смените пароль при первом входе.');
    }
  }
  if (!wipeUsers) console.log('  Учётные записи сохранены. Удалить демонстрационные: npm run clean -- --users');
  console.log('\n  Все активные сессии завершены — потребуется повторный вход.');
  console.log('  Нумерация проектов и визитов начнётся заново с 0001.\n');
}

async function buildSummary() {
  const count = async (table, where = '') => Number(await pluck(`SELECT COUNT(*) FROM ${table} ${where}`)) || 0;
  const rows = [
    ['Проекты и соглашения', await count('projects')],
    ['Этапы дорожных карт', await count('roadmap_steps')],
    ['Компании и организации', await count('companies')],
    ['Контактные лица', await count('contacts')],
    ['Визиты', await count('visits')],
    ['Встречи', await count('meetings')],
    ['Комментарии', await count('comments')],
    ['Вложенные файлы', await count('attachments')],
    ['Уведомления', await count('notifications')],
    ['Записи журнала аудита', await count('audit_log')],
    ['Активные сессии', await count('sessions')],
  ];
  if (wipeFields) rows.push(['Поля конструктора форм', await count('custom_fields')]);
  if (wipeUsers) rows.push(['Учётные записи (кроме одной)', Math.max(0, (await count('users')) - 1)]);
  return rows;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

function backupDatabase() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(config.root, 'backups'));
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `portal-backup-${stamp}.dump`);

  try {
    execFileSync('pg_dump', ['--dbname', config.databaseUrl, '--format=custom', '--file', target], { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Не удалось создать backup через pg_dump: ${error.message}. Установите postgresql-client или запустите с --no-backup.`);
  }
  return target;
}

function removeUploads() {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(config.uploadDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      fs.unlinkSync(path.join(config.uploadDir, entry.name));
      removed += 1;
    } catch (error) {
      console.warn(`  Не удалось удалить файл ${entry.name}: ${error.message}`);
    }
  }
  return removed;
}

async function chooseAdminToKeep() {
  return await get("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 AND lower(email) = lower(?)", config.bootstrapAdmin.email)
    || await get("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1")
    || await get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
}

// Учётная запись из демонстрационного набора не должна остаться в рабочей системе
// с паролем, опубликованным в репозитории.
async function resetDemoPassword(admin) {
  if (!auth.verifyPassword(DEMO_PASSWORD, admin.password_salt, admin.password_hash)) return null;
  const password = config.bootstrapAdmin.password || crypto.randomBytes(9).toString('base64url');
  const { salt, hash } = auth.hashPassword(password);
  await run('UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 1 WHERE id = ?', hash, salt, admin.id);
  return password;
}

function databaseLabel() {
  try {
    const url = new URL(config.databaseUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'PostgreSQL DATABASE_URL';
  }
}

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

const count = (table, where = '') => pluck(`SELECT COUNT(*) FROM ${table} ${where}`) || 0;

const summary = [
  ['Проекты и соглашения', count('projects')],
  ['Этапы дорожных карт', count('roadmap_steps')],
  ['Компании и организации', count('companies')],
  ['Контактные лица', count('contacts')],
  ['Визиты', count('visits')],
  ['Встречи', count('meetings')],
  ['Комментарии', count('comments')],
  ['Вложенные файлы', count('attachments')],
  ['Уведомления', count('notifications')],
  ['Записи журнала аудита', count('audit_log')],
  ['Активные сессии', count('sessions')],
];
if (wipeFields) summary.push(['Поля конструктора форм', count('custom_fields')]);
if (wipeUsers) summary.push(['Учётные записи (кроме одной)', Math.max(0, count('users') - 1)]);

const total = summary.reduce((sum, [, value]) => sum + value, 0);

console.log('\n  Будут безвозвратно удалены:');
for (const [label, value] of summary) {
  console.log(`     ${String(value).padStart(6)}  ${label}`);
}
console.log('\n  Сохраняются: структура базы, справочники и настройки системы.');
if (!wipeUsers) console.log('  Сохраняются: учётные записи пользователей (используйте --users, чтобы удалить и их).');
if (!wipeFields) console.log('  Сохраняются: поля конструктора форм (используйте --fields, чтобы удалить и их).');
console.log(`  База данных: ${config.dbPath}\n`);

if (total === 0 && !wipeUsers && !wipeFields) {
  console.log('  Удалять нечего — рабочих данных в системе нет.\n');
  process.exit(0);
}

main().catch((error) => {
  console.error(`\n  Ошибка очистки: ${error.message}\n`);
  process.exit(1);
});

async function main() {
  if (!assumeYes) {
    if (!process.stdin.isTTY) {
      console.error('  Запуск без интерактивного терминала. Добавьте --yes для подтверждения.\n');
      process.exit(1);
    }
    const answer = await ask(`  Введите ${CONFIRM_WORD} для подтверждения: `);
    if (answer.trim().toUpperCase() !== CONFIRM_WORD) {
      console.log('\n  Отменено. Ничего не удалено.\n');
      process.exit(0);
    }
  }

  if (makeBackup) {
    const backup = backupDatabase();
    console.log(`\n  Резервная копия базы: ${backup}`);
  }

  const files = removeUploads();
  const keptAdmin = wipeUsers ? chooseAdminToKeep() : null;

  db.exec('PRAGMA foreign_keys = OFF');
  transaction(() => {
    for (const table of DATA_TABLES) run(`DELETE FROM ${table}`);
    if (wipeFields) run('DELETE FROM custom_fields');
    if (keptAdmin) {
      run('DELETE FROM users WHERE id <> ?', keptAdmin.id);
      run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', keptAdmin.id);
    }
  });
  db.exec('PRAGMA foreign_keys = ON');

  // Справочники и настройки восстанавливаются, если чего-то не хватает.
  reference.ensureReference();

  const newPassword = keptAdmin ? resetDemoPassword(keptAdmin) : null;

  db.exec('VACUUM');

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

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

function backupDatabase() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const target = path.join(path.dirname(config.dbPath), `portal-backup-${stamp}.db`);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(config.dbPath, target);
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

function chooseAdminToKeep() {
  const admin =
    get("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 AND email = ?", config.bootstrapAdmin.email)
    || get("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1")
    || get("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!admin) {
    // Администраторов нет — учётная запись будет создана заново при запуске сервера.
    run('DELETE FROM users');
    return null;
  }
  return admin;
}

// Учётная запись из демонстрационного набора не должна остаться в рабочей системе
// с паролем, опубликованным в репозитории.
function resetDemoPassword(admin) {
  if (!auth.verifyPassword(DEMO_PASSWORD, admin.password_salt, admin.password_hash)) return null;
  const password = config.bootstrapAdmin.password || crypto.randomBytes(9).toString('base64url');
  const { salt, hash } = auth.hashPassword(password);
  run('UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 1 WHERE id = ?', hash, salt, admin.id);
  return password;
}

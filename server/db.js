'use strict';
/**
 * Слой доступа к данным. СУБД — SQLite (встроенный модуль node:sqlite),
 * схема описана обычным SQL и переносима на PostgreSQL (см. docs/data-model.md).
 */
const fs = require('node:fs');
const path = require('node:path');

// Встроенный модуль node:sqlite доступен начиная с Node.js 22.5.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `\n  Требуется Node.js версии 22.5 или новее — установлена ${process.versions.node}.\n` +
    '  Обновите Node.js (https://nodejs.org) либо запустите систему через Docker:\n' +
    '     docker compose up -d\n'
  );
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
-- ==========================================================================
-- Справочники
-- ==========================================================================
CREATE TABLE IF NOT EXISTS regions (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name_ru   TEXT NOT NULL,
  name_uz   TEXT NOT NULL DEFAULT '',
  name_en   TEXT NOT NULL DEFAULT '',
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS countries (
  id        INTEGER PRIMARY KEY,
  iso2      TEXT NOT NULL UNIQUE,
  name_ru   TEXT NOT NULL,
  name_uz   TEXT NOT NULL DEFAULT '',
  name_en   TEXT NOT NULL DEFAULT '',
  region_id INTEGER NOT NULL REFERENCES regions(id),
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_countries_region ON countries(region_id);

-- Универсальный справочник: kind = sector | project_status | visit_status |
-- meeting_status | record_type | currency | step_state
CREATE TABLE IF NOT EXISTS dictionaries (
  id        INTEGER PRIMARY KEY,
  kind      TEXT NOT NULL,
  code      TEXT NOT NULL,
  name_ru   TEXT NOT NULL,
  name_uz   TEXT NOT NULL DEFAULT '',
  name_en   TEXT NOT NULL DEFAULT '',
  color     TEXT NOT NULL DEFAULT '',
  sort      INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, code)
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);

-- ==========================================================================
-- Пользователи и доступ
-- ==========================================================================
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name       TEXT NOT NULL,
  position        TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL CHECK (role IN ('admin','team','viewer')),
  region_id       INTEGER REFERENCES regions(id),
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  totp_secret     TEXT,
  totp_enabled    INTEGER NOT NULL DEFAULT 0,
  phone           TEXT NOT NULL DEFAULT '',
  telegram_chat_id TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT 'ru',
  notify_inapp    INTEGER NOT NULL DEFAULT 1,
  notify_email    INTEGER NOT NULL DEFAULT 1,
  notify_telegram INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_region ON users(region_id);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ==========================================================================
-- Компании и партнёры (раздел 4 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS companies (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  country_id   INTEGER REFERENCES countries(id),
  city         TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT '',
  industry     TEXT NOT NULL DEFAULT '',
  profile      TEXT NOT NULL DEFAULT '',
  responsible_user_id INTEGER REFERENCES users(id),
  merged_into_id INTEGER REFERENCES companies(id),
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  deleted_by   INTEGER REFERENCES users(id),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country_id);
CREATE INDEX IF NOT EXISTS idx_companies_deleted ON companies(is_deleted);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company','project')),
  entity_id   INTEGER NOT NULL,
  full_name   TEXT NOT NULL,
  position    TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_entity ON contacts(entity_type, entity_id);

-- ==========================================================================
-- Проекты и соглашения (раздел 3 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  record_type  TEXT NOT NULL,                         -- P-01
  sector_code  TEXT NOT NULL,                         -- P-02
  area         TEXT NOT NULL CHECK (area IN ('export','investment')), -- P-03
  country_id   INTEGER NOT NULL REFERENCES countries(id),             -- P-04
  company_id   INTEGER NOT NULL REFERENCES companies(id),             -- P-05
  title        TEXT NOT NULL,                         -- P-06
  description  TEXT NOT NULL DEFAULT '',
  amount       REAL,                                  -- P-07
  currency     TEXT NOT NULL DEFAULT 'USD',
  responsible_user_id INTEGER NOT NULL REFERENCES users(id),          -- P-08
  status_code  TEXT NOT NULL,                         -- P-09
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  deleted_by   INTEGER REFERENCES users(id),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status_code);
CREATE INDEX IF NOT EXISTS idx_projects_country ON projects(country_id);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_resp ON projects(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(is_deleted);

-- Местные партнёры проекта: узбекская сторона (P-16, дополнение № 1 к ТЗ).
-- Партнёров может быть несколько; хранятся в общем справочнике компаний.
CREATE TABLE IF NOT EXISTS project_partners (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  role_note  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_partners_project ON project_partners(project_id);
CREATE INDEX IF NOT EXISTS idx_partners_company ON project_partners(company_id);

-- Справочник 14 регионов Республики Узбекистан (дополнение № 1 к ТЗ).
CREATE TABLE IF NOT EXISTS uz_regions (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name_ru   TEXT NOT NULL,
  name_uz   TEXT NOT NULL DEFAULT '',
  name_en   TEXT NOT NULL DEFAULT '',
  sort      INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Регионы реализации проекта (P-17): регион + населённый пункт + объём.
CREATE TABLE IF NOT EXISTS project_locations (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uz_region_id INTEGER NOT NULL REFERENCES uz_regions(id),
  locality     TEXT NOT NULL,
  amount       REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, uz_region_id)
);
CREATE INDEX IF NOT EXISTS idx_locations_project ON project_locations(project_id);
CREATE INDEX IF NOT EXISTS idx_locations_region ON project_locations(uz_region_id);

CREATE TABLE IF NOT EXISTS project_status_history (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_hist_project ON project_status_history(project_id);

-- Дорожная карта (п. 3.2 ТЗ)
CREATE TABLE IF NOT EXISTS roadmap_steps (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date    TEXT,
  responsible_user_id INTEGER REFERENCES users(id),
  state       TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','in_progress','done')),
  done_at     TEXT,
  done_by     INTEGER REFERENCES users(id),
  done_comment TEXT NOT NULL DEFAULT '',
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_steps_project ON roadmap_steps(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_due ON roadmap_steps(due_date, state);

-- ==========================================================================
-- Визиты и встречи (раздел 5 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  direction   TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),  -- V-01
  country_id  INTEGER NOT NULL REFERENCES countries(id),                 -- V-02
  cities      TEXT NOT NULL DEFAULT '',                                  -- V-03
  date_from   TEXT NOT NULL,                                             -- V-04
  date_to     TEXT NOT NULL,
  status_code TEXT NOT NULL,                                             -- V-05
  goal        TEXT NOT NULL DEFAULT '',                                  -- V-06
  outcome     TEXT NOT NULL DEFAULT '',                                  -- V-10
  responsible_user_id INTEGER NOT NULL REFERENCES users(id),
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  deleted_by  INTEGER REFERENCES users(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_dates ON visits(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_visits_country ON visits(country_id);

CREATE TABLE IF NOT EXISTS visit_members (              -- V-07
  id         INTEGER PRIMARY KEY,
  visit_id   INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  full_name  TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  position   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_members_visit ON visit_members(visit_id);

CREATE TABLE IF NOT EXISTS meetings (                   -- п. 5.2
  id           INTEGER PRIMARY KEY,
  visit_id     INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  company_id   INTEGER REFERENCES companies(id),
  company_name TEXT NOT NULL DEFAULT '',
  project_id   INTEGER REFERENCES projects(id),
  meet_date    TEXT NOT NULL,
  meet_time    TEXT NOT NULL DEFAULT '',
  venue        TEXT NOT NULL DEFAULT '',
  status_code  TEXT NOT NULL DEFAULT 'tbc',
  participants TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meetings_visit ON meetings(visit_id);
CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meet_date);

-- ==========================================================================
-- Комментарии, вложения, произвольные поля
-- ==========================================================================
CREATE TABLE IF NOT EXISTS comments (                   -- P-13, только добавление
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  mentions    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS attachments (                -- P-12, версионность документов
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  orig_name   TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  is_current  INTEGER NOT NULL DEFAULT 1,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS custom_fields (              -- раздел 9 ТЗ, конструктор форм
  id            INTEGER PRIMARY KEY,
  form          TEXT NOT NULL CHECK (form IN ('project','visit','company')),
  field_key     TEXT NOT NULL,
  label_ru      TEXT NOT NULL,
  label_uz      TEXT NOT NULL DEFAULT '',
  label_en      TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL,
  required      INTEGER NOT NULL DEFAULT 0,
  help_text     TEXT NOT NULL DEFAULT '',
  options_json  TEXT NOT NULL DEFAULT '[]',
  position      INTEGER NOT NULL DEFAULT 0,
  team_can_fill INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (form, field_key)
);

CREATE TABLE IF NOT EXISTS custom_values (
  id          INTEGER PRIMARY KEY,
  field_id    INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  value_json  TEXT NOT NULL DEFAULT 'null',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (field_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_values_entity ON custom_values(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS poll_votes (                 -- тип поля «голосование»
  id          INTEGER PRIMARY KEY,
  field_id    INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  option      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (field_id, entity_type, entity_id, user_id)
);

-- ==========================================================================
-- Заявки на исправление (п. 2.3 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS correction_requests (
  id            INTEGER PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  entity_label  TEXT NOT NULL DEFAULT '',
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,
  proposed_json TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON correction_requests(status);

-- ==========================================================================
-- Уведомления (раздел 7 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  severity   TEXT NOT NULL DEFAULT 'info',
  dedupe_key TEXT NOT NULL DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key <> '';

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              INTEGER PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL,
  error           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ==========================================================================
-- Журнал аудита (раздел 10 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  user_label  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   INTEGER,
  summary     TEXT NOT NULL DEFAULT '',
  changes_json TEXT NOT NULL DEFAULT '[]',
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

-- ==========================================================================
-- Сохранённые фильтры (п. 3.3 ТЗ)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS saved_filters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL,
  name       TEXT NOT NULL,
  query_json TEXT NOT NULL DEFAULT '{}',
  is_shared  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_filters_user ON saved_filters(user_id, entity);
`;

db.exec(SCHEMA);

// --------------------------------------------------------------------------
// Вспомогательные функции
// --------------------------------------------------------------------------

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params) ?? null;
const run = (sql, ...params) => db.prepare(sql).run(...params);
const pluck = (sql, ...params) => {
  const row = get(sql, ...params);
  return row ? Object.values(row)[0] : null;
};

/** Выполняет функцию в транзакции. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* транзакция уже откатилась */ }
    throw error;
  }
}

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function getSetting(key, fallback = null) {
  const value = pluck('SELECT value FROM settings WHERE key = ?', key);
  if (value === null) return fallback;
  try { return JSON.parse(value); } catch { return value; }
}

function setSetting(key, value, userId = null) {
  run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key,
    JSON.stringify(value),
    userId
  );
}

/** Генерация человекочитаемого кода записи: PRJ-2026-0007, VIS-2026-0003. */
function nextCode(prefix, table) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const last = pluck(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`, like);
  const seq = last ? Number(last.split('-')[2]) + 1 : 1;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

module.exports = { db, all, get, run, pluck, transaction, nowIso, getSetting, setSetting, nextCode, SCHEMA };

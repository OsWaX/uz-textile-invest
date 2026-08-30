'use strict';
/** Общие операции над записями: вложения, комментарии, ссылки на пользователей. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { all, get, run } = require('./db');
const { badRequest, notFound } = require('./lib/http');
const audit = require('./audit');
const notify = require('./notify');

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'zip', 'rar', '7z',
]);

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};

const ENTITY_TABLES = {
  project: 'projects',
  company: 'companies',
  visit: 'visits',
  step: 'roadmap_steps',
  meeting: 'meetings',
};

function assertEntityExists(entityType, entityId) {
  const table = ENTITY_TABLES[entityType];
  if (!table) throw badRequest('Неизвестный тип записи');
  const row = get(`SELECT id FROM ${table} WHERE id = ? AND is_deleted = 0`, entityId);
  if (!row) throw notFound('Запись не найдена');
}

/**
 * Сохраняет файл. Версионность: повторная загрузка файла с тем же именем
 * создаёт новую версию, прежняя остаётся доступной (раздел 10 ТЗ).
 */
function saveAttachment({ entityType, entityId, file, user, req }) {
  assertEntityExists(entityType, entityId);

  const ext = path.extname(file.filename).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw badRequest(`Недопустимый тип файла: .${ext}. Разрешены документы, таблицы, презентации, архивы и изображения.`);
  }
  if (file.data.length > config.maxUploadBytes) {
    throw badRequest(`Файл больше допустимых ${Math.round(config.maxUploadBytes / 1048576)} МБ`);
  }

  const previous = get(
    `SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? AND orig_name = ? AND is_deleted = 0
     ORDER BY version DESC LIMIT 1`,
    entityType, entityId, file.filename
  );
  const version = previous ? previous.version + 1 : 1;
  if (previous) run('UPDATE attachments SET is_current = 0 WHERE id = ?', previous.id);

  const storedName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, storedName), file.data);

  const result = run(
    `INSERT INTO attachments (entity_type, entity_id, stored_name, orig_name, mime, size, version, is_current, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    entityType, entityId, storedName, file.filename,
    MIME_BY_EXT[ext] || file.mime || 'application/octet-stream',
    file.data.length, version, user.id
  );

  audit.record({
    user, action: 'upload', entityType, entityId,
    summary: `Загружен файл «${file.filename}»${version > 1 ? ` (версия ${version})` : ''}`, req,
  });
  touchActivity(entityType, entityId);
  return get('SELECT * FROM attachments WHERE id = ?', Number(result.lastInsertRowid));
}

const listAttachments = (entityType, entityId, { allVersions = false } = {}) =>
  all(
    `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.entity_type = ? AND a.entity_id = ? AND a.is_deleted = 0
       ${allVersions ? '' : 'AND a.is_current = 1'}
     ORDER BY a.orig_name, a.version DESC`,
    entityType, entityId
  );

function deleteAttachment(id, user, req) {
  const attachment = get('SELECT * FROM attachments WHERE id = ? AND is_deleted = 0', id);
  if (!attachment) throw notFound('Файл не найден');
  run('UPDATE attachments SET is_deleted = 1 WHERE id = ?', id);
  // Предыдущая версия снова становится актуальной.
  const prior = get(
    `SELECT id FROM attachments WHERE entity_type = ? AND entity_id = ? AND orig_name = ? AND is_deleted = 0
     ORDER BY version DESC LIMIT 1`,
    attachment.entity_type, attachment.entity_id, attachment.orig_name
  );
  if (prior) run('UPDATE attachments SET is_current = 1 WHERE id = ?', prior.id);
  audit.record({
    user, action: 'delete', entityType: attachment.entity_type, entityId: attachment.entity_id,
    summary: `Удалён файл «${attachment.orig_name}» (версия ${attachment.version})`, req,
  });
  return { ok: true };
}

/** Разбирает упоминания вида @Фамилия и возвращает id найденных пользователей. */
function parseMentions(body) {
  const names = [...String(body).matchAll(/@([\p{L}][\p{L}\-.]{1,60})/gu)].map((m) => m[1]);
  if (!names.length) return [];
  const users = all("SELECT id, full_name, email FROM users WHERE is_active = 1");
  const matched = new Set();
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const user of users) {
      const parts = user.full_name.toLowerCase().split(/\s+/);
      if (parts.some((p) => p === lower) || user.email.split('@')[0].toLowerCase() === lower) matched.add(user.id);
    }
  }
  return [...matched];
}

const ENTITY_TITLES = {
  project: (id) => get('SELECT code, title FROM projects WHERE id = ?', id),
  visit: (id) => get('SELECT code, goal AS title FROM visits WHERE id = ?', id),
  company: (id) => get("SELECT '' AS code, name AS title FROM companies WHERE id = ?", id),
};

/** Добавляет комментарий (лента только на добавление, п. P-13 ТЗ). */
function addComment({ entityType, entityId, body, user, req }) {
  assertEntityExists(entityType, entityId);
  const trimmed = String(body || '').trim();
  if (!trimmed) throw badRequest('Комментарий не может быть пустым');
  if (trimmed.length > 5000) throw badRequest('Комментарий длиннее 5000 символов');

  const mentions = parseMentions(trimmed).filter((id) => id !== user.id);
  const result = run(
    'INSERT INTO comments (entity_type, entity_id, user_id, body, mentions) VALUES (?, ?, ?, ?, ?)',
    entityType, entityId, user.id, trimmed, JSON.stringify(mentions)
  );

  const info = ENTITY_TITLES[entityType]?.(entityId);
  const label = info ? `${info.code ? `${info.code} — ` : ''}${info.title}` : '';
  notify.notifyMany(mentions, {
    type: 'mention',
    title: `${user.full_name} упомянул(а) вас в комментарии`,
    body: `${label}\n\n${trimmed.slice(0, 400)}`,
    link: `/#/${entityType}s/${entityId}`,
  });

  audit.record({ user, action: 'comment', entityType, entityId, summary: `Комментарий: ${trimmed.slice(0, 120)}`, req });
  touchActivity(entityType, entityId);
  return get(
    `SELECT c.*, u.full_name AS author_name, u.role AS author_role FROM comments c
     JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    Number(result.lastInsertRowid)
  );
}

const listComments = (entityType, entityId) =>
  all(
    `SELECT c.*, u.full_name AS author_name, u.role AS author_role FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.id DESC`,
    entityType, entityId
  );

/** Обновляет отметку последней активности проекта (для признака «замерших» проектов). */
function touchActivity(entityType, entityId) {
  if (entityType === 'project') {
    run("UPDATE projects SET last_activity_at = datetime('now') WHERE id = ?", entityId);
  } else if (entityType === 'step') {
    const step = get('SELECT project_id FROM roadmap_steps WHERE id = ?', entityId);
    if (step) run("UPDATE projects SET last_activity_at = datetime('now') WHERE id = ?", step.project_id);
  }
}

module.exports = {
  ALLOWED_EXTENSIONS, MIME_BY_EXT, ENTITY_TABLES,
  saveAttachment, listAttachments, deleteAttachment,
  addComment, listComments, parseMentions, touchActivity, assertEntityExists,
};

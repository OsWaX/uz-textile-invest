'use strict';
/**
 * Конструктор форм (раздел 9 ТЗ): произвольные поля для форм проектов,
 * визитов и компаний, включая тип «голосование».
 */
const { all, get, run } = require('./db');
const { badRequest, forbidden } = require('./lib/http');

const FIELD_TYPES = {
  text:      'Однострочный текст',
  textarea:  'Многострочный текст',
  number:    'Число',
  money:     'Денежная сумма',
  date:      'Дата',
  select:    'Один вариант из списка',
  multiselect: 'Несколько вариантов',
  poll:      'Голосование',
  checkbox:  'Да / Нет',
  file:      'Файл',
  url:       'Ссылка',
  user:      'Пользователь',
};

const FORMS = { project: 'Проект / соглашение', visit: 'Визит', company: 'Компания' };

const listFields = (form, includeInactive = false) =>
  all(
    `SELECT * FROM custom_fields WHERE form = ?${includeInactive ? '' : ' AND is_active = 1'}
     ORDER BY position, id`,
    form
  ).map((field) => ({ ...field, options: JSON.parse(field.options_json || '[]'), required: Boolean(field.required), team_can_fill: Boolean(field.team_can_fill), is_active: Boolean(field.is_active) }));

/** Значения произвольных полей одной записи + результаты голосований. */
function valuesFor(entityType, entityId, userId = null) {
  const rows = all(
    `SELECT cv.field_id, cv.value_json, cf.field_key, cf.type
     FROM custom_values cv JOIN custom_fields cf ON cf.id = cv.field_id
     WHERE cv.entity_type = ? AND cv.entity_id = ?`,
    entityType, entityId
  );
  const values = {};
  for (const row of rows) {
    try { values[row.field_key] = JSON.parse(row.value_json); } catch { values[row.field_key] = null; }
  }

  const polls = {};
  const pollFields = all(
    `SELECT cf.id, cf.field_key FROM custom_fields cf
     WHERE cf.form = (SELECT form FROM custom_fields WHERE id = cf.id) AND cf.type = 'poll' AND cf.is_active = 1`
  );
  for (const field of pollFields) {
    const votes = all(
      'SELECT option, COUNT(*) AS n FROM poll_votes WHERE field_id = ? AND entity_type = ? AND entity_id = ? GROUP BY option',
      field.id, entityType, entityId
    );
    if (!votes.length && !userId) continue;
    const myVote = userId
      ? get('SELECT option FROM poll_votes WHERE field_id = ? AND entity_type = ? AND entity_id = ? AND user_id = ?',
        field.id, entityType, entityId, userId)?.option ?? null
      : null;
    polls[field.field_key] = { field_id: field.id, tally: votes, my_vote: myVote, total: votes.reduce((s, v) => s + v.n, 0) };
  }

  return { values, polls };
}

/** Проверяет и сохраняет значения произвольных полей формы. */
function saveValues(form, entityType, entityId, payload = {}, user) {
  const fields = listFields(form);
  for (const field of fields) {
    const provided = Object.prototype.hasOwnProperty.call(payload, field.field_key);
    if (!provided) {
      if (field.required && !get('SELECT id FROM custom_values WHERE field_id = ? AND entity_type = ? AND entity_id = ?', field.id, entityType, entityId)) {
        throw badRequest(`Поле «${field.label_ru}» обязательно для заполнения`);
      }
      continue;
    }
    if (!field.team_can_fill && user.role !== 'admin') {
      throw forbidden(`Поле «${field.label_ru}» заполняется только администратором`);
    }
    const value = normalize(field, payload[field.field_key]);
    if (field.required && (value === null || value === '' || (Array.isArray(value) && !value.length))) {
      throw badRequest(`Поле «${field.label_ru}» обязательно для заполнения`);
    }
    run(
      `INSERT INTO custom_values (field_id, entity_type, entity_id, value_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(field_id, entity_type, entity_id)
       DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      field.id, entityType, entityId, JSON.stringify(value ?? null)
    );
  }
}

function normalize(field, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw badRequest(`Поле «${field.label_ru}» должно быть числом`);
      return n;
    }
    case 'checkbox':
      return Boolean(raw) && raw !== 'false' && raw !== '0';
    case 'date': {
      const value = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`Поле «${field.label_ru}»: некорректная дата`);
      return value;
    }
    case 'select': {
      const value = String(raw);
      if (field.options.length && !field.options.includes(value)) {
        throw badRequest(`Поле «${field.label_ru}»: недопустимый вариант`);
      }
      return value;
    }
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      for (const value of list) {
        if (field.options.length && !field.options.includes(value)) {
          throw badRequest(`Поле «${field.label_ru}»: недопустимый вариант «${value}»`);
        }
      }
      return list;
    }
    case 'user':
      return Number(raw) || null;
    case 'url': {
      const value = String(raw).trim();
      if (!/^https?:\/\//i.test(value)) throw badRequest(`Поле «${field.label_ru}» должно начинаться с http:// или https://`);
      return value;
    }
    case 'poll':
      return null; // голоса хранятся отдельно
    default:
      return String(raw).slice(0, 20000);
  }
}

/** Голосование по полю типа «poll». */
function vote(fieldId, entityType, entityId, userId, option) {
  const field = get("SELECT * FROM custom_fields WHERE id = ? AND type = 'poll' AND is_active = 1", fieldId);
  if (!field) throw badRequest('Голосование не найдено');
  const options = JSON.parse(field.options_json || '[]');
  if (!options.includes(option)) throw badRequest('Недопустимый вариант ответа');
  run(
    `INSERT INTO poll_votes (field_id, entity_type, entity_id, user_id, option) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(field_id, entity_type, entity_id, user_id) DO UPDATE SET option = excluded.option, created_at = datetime('now')`,
    fieldId, entityType, entityId, userId, option
  );
  return valuesFor(entityType, entityId, userId).polls[field.field_key];
}

/** Колонки произвольных полей для выгрузки в Excel. */
function exportColumns(form) {
  return listFields(form)
    .filter((f) => f.type !== 'file')
    .map((f) => ({ header: f.label_ru, key: `cf_${f.field_key}`, type: f.type === 'money' || f.type === 'number' ? 'number' : 'text', width: 22 }));
}

function exportValues(form, entityType, entityIds) {
  const fields = listFields(form);
  const byEntity = new Map(entityIds.map((id) => [id, {}]));
  if (!fields.length || !entityIds.length) return byEntity;
  const placeholders = entityIds.map(() => '?').join(',');
  const rows = all(
    `SELECT cv.entity_id, cf.field_key, cf.type, cv.value_json FROM custom_values cv
     JOIN custom_fields cf ON cf.id = cv.field_id
     WHERE cv.entity_type = ? AND cv.entity_id IN (${placeholders})`,
    entityType, ...entityIds
  );
  for (const row of rows) {
    let value;
    try { value = JSON.parse(row.value_json); } catch { value = null; }
    if (Array.isArray(value)) value = value.join(', ');
    if (typeof value === 'boolean') value = value ? 'Да' : 'Нет';
    const bucket = byEntity.get(row.entity_id);
    if (bucket) bucket[`cf_${row.field_key}`] = value;
  }
  return byEntity;
}

module.exports = { FIELD_TYPES, FORMS, listFields, valuesFor, saveValues, vote, exportColumns, exportValues };

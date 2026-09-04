'use strict';
/** Журнал аудита (раздел 10 ТЗ): кто, что, когда, старое значение -> новое. */
const { run, all, get } = require('./db');

const ACTION_LABELS = {
  login: 'Вход в систему',
  login_failed: 'Неудачная попытка входа',
  logout: 'Выход из системы',
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  restore: 'Восстановление',
  status_change: 'Смена статуса',
  complete: 'Отметка о выполнении',
  comment: 'Комментарий',
  upload: 'Загрузка файла',
  export: 'Экспорт данных',
  correction_request: 'Заявка на исправление',
  correction_decision: 'Решение по заявке',
  settings: 'Изменение настроек',
  user_manage: 'Управление пользователями',
};

const ENTITY_LABELS = {
  project: 'Проект/соглашение',
  company: 'Компания',
  visit: 'Визит',
  meeting: 'Встреча',
  step: 'Этап дорожной карты',
  user: 'Пользователь',
  custom_field: 'Произвольное поле',
  dictionary: 'Справочник',
  settings: 'Настройки',
  attachment: 'Вложение',
  correction: 'Заявка на исправление',
};

/** Сравнивает две версии записи и возвращает список изменённых полей. */
function diff(before, after, fieldLabels = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (key.endsWith('_at') || key === 'updated_by' || key === 'id') continue;
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) continue;
    changes.push({ field: key, label: fieldLabels[key] || key, from: oldValue ?? null, to: newValue ?? null });
  }
  return changes;
}

async function record({ user, action, entityType = '', entityId = null, summary = '', changes = [], req = null }) {
  await run(
    `INSERT INTO audit_log (user_id, user_label, action, entity_type, entity_id, summary, changes_json, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user?.id ?? null,
    user ? `${user.full_name} (${user.email})` : 'система',
    action,
    entityType,
    entityId,
    summary,
    JSON.stringify(changes || []),
    req?.clientIp || '',
    (req?.headers?.['user-agent'] || '').slice(0, 250)
  );
}

async function query({ userId, action, entityType, entityId, from, to, search, limit = 100, offset = 0 }) {
  const where = ['1 = 1'];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { where.push('entity_id = ?'); params.push(Number(entityId)); }
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (to) { where.push('created_at <= ?'); params.push(`${to} 23:59:59`); }
  if (search) {
    where.push('(summary LIKE ? OR user_label LIKE ? OR changes_json LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = (await all(sql, ...params, Number(limit), Number(offset))).map((row) => ({
    ...row,
    changes: JSON.parse(row.changes_json || '[]'),
    action_label: ACTION_LABELS[row.action] || row.action,
    entity_label: ENTITY_LABELS[row.entity_type] || row.entity_type,
  }));
  const total = (await get(`SELECT COUNT(*) AS n FROM audit_log WHERE ${where.join(' AND ')}`, ...params))?.n ?? 0;
  return { rows, total };
}

module.exports = { record, diff, query, ACTION_LABELS, ENTITY_LABELS };

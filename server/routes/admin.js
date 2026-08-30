'use strict';
/** Панель администратора: пользователи, справочники, конструктор форм, настройки, аудит, корзина. */
const { Router, notFound, badRequest, conflict } = require('../lib/http');
const { all, get, run, transaction, getSetting, setSetting } = require('../db');
const rbac = require('../rbac');
const auth = require('../auth');
const audit = require('../audit');
const cf = require('../customfields');
const config = require('../config');
const { DEFAULT_SETTINGS } = require('../reference');
const v = require('../lib/validate');

const router = new Router();

const requireAdmin = (ctx, permission) => {
  const user = ctx.requireUser();
  rbac.require(user, permission);
  return user;
};

// -------------------------------------------------------------------------
// Пользователи (п. 9.2 ТЗ). Самостоятельная регистрация отключена.
// -------------------------------------------------------------------------
router.get('/api/admin/users', async (ctx) => {
  requireAdmin(ctx, 'admin.users');
  return all(
    `SELECT u.id, u.email, u.full_name, u.position, u.role, u.region_id, u.phone, u.telegram_chat_id,
            u.language, u.is_active, u.totp_enabled, u.last_login_at, u.locked_until, u.failed_attempts,
            u.created_at, r.name_ru AS region_name,
            (SELECT COUNT(*) FROM projects p WHERE p.responsible_user_id = u.id AND p.is_deleted = 0) AS projects_count
     FROM users u LEFT JOIN regions r ON r.id = u.region_id ORDER BY u.role, u.full_name`
  );
});

router.post('/api/admin/users', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.users');
  const email = v.email(ctx.body.email, 'Электронная почта', { required: true });
  if (get('SELECT id FROM users WHERE email = ?', email)) throw conflict('Пользователь с таким адресом уже существует');

  const password = String(ctx.body.password || '');
  const problem = auth.validatePassword(password);
  if (problem) throw badRequest(problem);

  const role = v.oneOf(ctx.body.role, 'Роль', rbac.ROLES);
  const regionId = v.int(ctx.body.region_id, 'Регион');
  if (regionId && !get('SELECT id FROM regions WHERE id = ?', regionId)) throw badRequest('Регион не найден');

  const { salt, hash } = auth.hashPassword(password);
  const result = run(
    `INSERT INTO users (email, full_name, position, role, region_id, password_hash, password_salt,
       must_change_pwd, phone, telegram_chat_id, language, notify_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    email,
    v.str(ctx.body.full_name, 'ФИО', { required: true, max: 200 }),
    v.str(ctx.body.position, 'Должность', { max: 200 }),
    role, regionId, hash, salt,
    v.str(ctx.body.phone, 'Телефон', { max: 40 }),
    v.str(ctx.body.telegram_chat_id, 'Telegram chat ID', { max: 40 }),
    v.oneOf(ctx.body.language || 'ru', 'Язык', ['ru', 'uz', 'en'], { required: false, fallback: 'ru' }) || 'ru',
    v.bool(ctx.body.notify_email, true) ? 1 : 0
  );
  const userId = Number(result.lastInsertRowid);
  audit.record({
    user: admin, action: 'user_manage', entityType: 'user', entityId: userId,
    summary: `Создан пользователь ${email} с ролью «${role}»`, req: ctx.req,
  });
  return get('SELECT id, email, full_name, role, region_id, is_active FROM users WHERE id = ?', userId);
});

router.patch('/api/admin/users/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.users');
  const target = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw notFound('Пользователь не найден');

  const updates = {};
  if (ctx.body.full_name !== undefined) updates.full_name = v.str(ctx.body.full_name, 'ФИО', { required: true, max: 200 });
  if (ctx.body.position !== undefined) updates.position = v.str(ctx.body.position, 'Должность', { max: 200 });
  if (ctx.body.role !== undefined) updates.role = v.oneOf(ctx.body.role, 'Роль', rbac.ROLES);
  if (ctx.body.region_id !== undefined) updates.region_id = v.int(ctx.body.region_id, 'Регион');
  if (ctx.body.phone !== undefined) updates.phone = v.str(ctx.body.phone, 'Телефон', { max: 40 });
  if (ctx.body.telegram_chat_id !== undefined) updates.telegram_chat_id = v.str(ctx.body.telegram_chat_id, 'Telegram chat ID', { max: 40 });
  if (ctx.body.is_active !== undefined) updates.is_active = v.bool(ctx.body.is_active) ? 1 : 0;

  // Нельзя отключить последнего администратора.
  if ((updates.is_active === 0 || (updates.role && updates.role !== 'admin')) && target.role === 'admin') {
    const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1")?.n ?? 0;
    if (admins <= 1) throw conflict('В системе должен остаться хотя бы один активный администратор');
  }
  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');

  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(`UPDATE users SET ${assignments}, updated_at = datetime('now') WHERE id = ?`, ...Object.values(updates), target.id);
  if (updates.is_active === 0) run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', target.id);

  audit.record({
    user: admin, action: 'user_manage', entityType: 'user', entityId: target.id,
    summary: `Изменён пользователь ${target.email}`,
    changes: audit.diff(
      Object.fromEntries(Object.keys(updates).map((k) => [k, target[k]])), updates,
      { full_name: 'ФИО', role: 'Роль', region_id: 'Регион', is_active: 'Активен', position: 'Должность' }
    ),
    req: ctx.req,
  });
  return get('SELECT id, email, full_name, role, region_id, is_active FROM users WHERE id = ?', target.id);
});

router.post('/api/admin/users/:id/reset-password', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.users');
  const target = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw notFound('Пользователь не найден');
  const password = String(ctx.body.password || '');
  const problem = auth.validatePassword(password);
  if (problem) throw badRequest(problem);

  const { salt, hash } = auth.hashPassword(password);
  run(
    "UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?",
    hash, salt, target.id
  );
  run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', target.id);
  audit.record({ user: admin, action: 'user_manage', entityType: 'user', entityId: target.id, summary: `Сброшен пароль пользователя ${target.email}`, req: ctx.req });
  return { ok: true };
});

router.post('/api/admin/users/:id/reset-2fa', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.users');
  const target = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw notFound('Пользователь не найден');
  run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', target.id);
  audit.record({ user: admin, action: 'user_manage', entityType: 'user', entityId: target.id, summary: `Сброшена двухфакторная аутентификация: ${target.email}`, req: ctx.req });
  return { ok: true };
});

router.post('/api/admin/users/:id/unlock', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.users');
  const target = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!target) throw notFound('Пользователь не найден');
  run('UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?', target.id);
  audit.record({ user: admin, action: 'user_manage', entityType: 'user', entityId: target.id, summary: `Снята блокировка учётной записи ${target.email}`, req: ctx.req });
  return { ok: true };
});

// -------------------------------------------------------------------------
// Справочники (п. 9.2 ТЗ)
// -------------------------------------------------------------------------
const DICT_KINDS = ['sector', 'record_type', 'project_status', 'visit_status', 'meeting_status', 'currency'];

router.get('/api/admin/dictionaries', async (ctx) => {
  requireAdmin(ctx, 'admin.dictionaries');
  const result = {};
  for (const kind of DICT_KINDS) result[kind] = all('SELECT * FROM dictionaries WHERE kind = ? ORDER BY sort, id', kind);
  result.regions = all('SELECT * FROM regions ORDER BY sort');
  result.uz_regions = all('SELECT * FROM uz_regions ORDER BY sort, id');
  result.countries = all(
    'SELECT c.*, r.name_ru AS region_name FROM countries c JOIN regions r ON r.id = c.region_id ORDER BY c.name_ru'
  );
  return result;
});

router.post('/api/admin/dictionaries', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.dictionaries');
  const kind = v.oneOf(ctx.body.kind, 'Справочник', DICT_KINDS);
  const code = v.str(ctx.body.code, 'Код', { required: true, max: 50 }).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (get('SELECT id FROM dictionaries WHERE kind = ? AND code = ?', kind, code)) throw conflict('Такой код уже существует в справочнике');

  const maxSort = get('SELECT COALESCE(MAX(sort), 0) AS n FROM dictionaries WHERE kind = ?', kind).n;
  const result = run(
    `INSERT INTO dictionaries (kind, code, name_ru, name_uz, name_en, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    kind, code,
    v.str(ctx.body.name_ru, 'Название (рус.)', { required: true, max: 200 }),
    v.str(ctx.body.name_uz, 'Название (узб.)', { max: 200 }),
    v.str(ctx.body.name_en, 'Название (англ.)', { max: 200 }),
    v.str(ctx.body.color, 'Цвет', { max: 20 }),
    maxSort + 1
  );
  audit.record({ user: admin, action: 'settings', entityType: 'dictionary', entityId: Number(result.lastInsertRowid), summary: `Добавлено значение справочника «${kind}»: ${code}`, req: ctx.req });
  return get('SELECT * FROM dictionaries WHERE id = ?', Number(result.lastInsertRowid));
});

router.patch('/api/admin/dictionaries/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.dictionaries');
  const item = get('SELECT * FROM dictionaries WHERE id = ?', Number(ctx.params.id));
  if (!item) throw notFound('Значение справочника не найдено');

  const updates = {};
  if (ctx.body.name_ru !== undefined) updates.name_ru = v.str(ctx.body.name_ru, 'Название (рус.)', { required: true, max: 200 });
  if (ctx.body.name_uz !== undefined) updates.name_uz = v.str(ctx.body.name_uz, 'Название (узб.)', { max: 200 });
  if (ctx.body.name_en !== undefined) updates.name_en = v.str(ctx.body.name_en, 'Название (англ.)', { max: 200 });
  if (ctx.body.color !== undefined) updates.color = v.str(ctx.body.color, 'Цвет', { max: 20 });
  if (ctx.body.sort !== undefined) updates.sort = v.int(ctx.body.sort, 'Порядок', { min: 0 });
  if (ctx.body.is_active !== undefined) {
    updates.is_active = v.bool(ctx.body.is_active) ? 1 : 0;
    if (!updates.is_active && item.is_system) {
      const inUse = countUsage(item);
      if (inUse) throw conflict(`Значение используется в ${inUse} записях и не может быть отключено`);
    }
  }
  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');

  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(`UPDATE dictionaries SET ${assignments} WHERE id = ?`, ...Object.values(updates), item.id);
  audit.record({
    user: admin, action: 'settings', entityType: 'dictionary', entityId: item.id,
    summary: `Изменено значение справочника «${item.kind}»: ${item.code}`,
    changes: audit.diff(Object.fromEntries(Object.keys(updates).map((k) => [k, item[k]])), updates), req: ctx.req,
  });
  return get('SELECT * FROM dictionaries WHERE id = ?', item.id);
});

function countUsage(item) {
  const map = {
    sector: "SELECT COUNT(*) AS n FROM projects WHERE sector_code = ? AND is_deleted = 0",
    record_type: "SELECT COUNT(*) AS n FROM projects WHERE record_type = ? AND is_deleted = 0",
    project_status: "SELECT COUNT(*) AS n FROM projects WHERE status_code = ? AND is_deleted = 0",
    visit_status: "SELECT COUNT(*) AS n FROM visits WHERE status_code = ? AND is_deleted = 0",
    meeting_status: "SELECT COUNT(*) AS n FROM meetings WHERE status_code = ? AND is_deleted = 0",
    currency: "SELECT COUNT(*) AS n FROM projects WHERE currency = ? AND is_deleted = 0",
  };
  const sql = map[item.kind];
  return sql ? get(sql, item.code)?.n ?? 0 : 0;
}

/** Правка справочника регионов Узбекистана (дополнение № 1 к ТЗ). */
router.patch('/api/admin/uz-regions/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.dictionaries');
  const region = get('SELECT * FROM uz_regions WHERE id = ?', Number(ctx.params.id));
  if (!region) throw notFound('Регион не найден');

  const updates = {};
  if (ctx.body.name_ru !== undefined) updates.name_ru = v.str(ctx.body.name_ru, 'Название (рус.)', { required: true, max: 200 });
  if (ctx.body.name_uz !== undefined) updates.name_uz = v.str(ctx.body.name_uz, 'Название (узб.)', { max: 200 });
  if (ctx.body.name_en !== undefined) updates.name_en = v.str(ctx.body.name_en, 'Название (англ.)', { max: 200 });
  if (ctx.body.sort !== undefined) updates.sort = v.int(ctx.body.sort, 'Порядок', { min: 0 });
  if (ctx.body.is_active !== undefined) {
    updates.is_active = v.bool(ctx.body.is_active) ? 1 : 0;
    if (!updates.is_active) {
      const inUse = get('SELECT COUNT(*) AS n FROM project_locations WHERE uz_region_id = ?', region.id).n;
      if (inUse) throw conflict(`Регион указан в ${inUse} проектах и не может быть отключён`);
    }
  }
  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');

  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(`UPDATE uz_regions SET ${assignments} WHERE id = ?`, ...Object.values(updates), region.id);
  audit.record({
    user: admin, action: 'settings', entityType: 'dictionary', entityId: region.id,
    summary: `Изменён регион Узбекистана «${region.name_ru}»`,
    changes: audit.diff(Object.fromEntries(Object.keys(updates).map((k) => [k, region[k]])), updates), req: ctx.req,
  });
  return get('SELECT * FROM uz_regions WHERE id = ?', region.id);
});

/** Изменение привязки страны к региону (п. 9.2 ТЗ). */
router.patch('/api/admin/countries/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.dictionaries');
  const country = get('SELECT * FROM countries WHERE id = ?', Number(ctx.params.id));
  if (!country) throw notFound('Страна не найдена');
  const regionId = v.int(ctx.body.region_id, 'Регион', { required: true });
  if (!get('SELECT id FROM regions WHERE id = ?', regionId)) throw badRequest('Регион не найден');
  run('UPDATE countries SET region_id = ? WHERE id = ?', regionId, country.id);
  audit.record({ user: admin, action: 'settings', entityType: 'dictionary', entityId: country.id, summary: `Страна «${country.name_ru}» переведена в другой регион`, req: ctx.req });
  return get('SELECT * FROM countries WHERE id = ?', country.id);
});

// -------------------------------------------------------------------------
// Конструктор форм (п. 9.1 ТЗ)
// -------------------------------------------------------------------------
router.get('/api/admin/custom-fields', async (ctx) => {
  requireAdmin(ctx, 'admin.custom_fields');
  return {
    forms: cf.FORMS,
    types: cf.FIELD_TYPES,
    fields: {
      project: cf.listFields('project', true),
      visit: cf.listFields('visit', true),
      company: cf.listFields('company', true),
    },
  };
});

router.post('/api/admin/custom-fields', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.custom_fields');
  const form = v.oneOf(ctx.body.form, 'Форма', Object.keys(cf.FORMS));
  const type = v.oneOf(ctx.body.type, 'Тип поля', Object.keys(cf.FIELD_TYPES));
  const labelRu = v.str(ctx.body.label_ru, 'Название поля', { required: true, max: 200 });
  const key = (v.str(ctx.body.field_key, 'Системное имя', { max: 60 }) || transliterate(labelRu))
    .toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `field_${Date.now()}`;

  if (get('SELECT id FROM custom_fields WHERE form = ? AND field_key = ?', form, key)) {
    throw conflict('Поле с таким системным именем уже существует в этой форме');
  }
  const options = v.array(ctx.body.options, 'Варианты', { max: 50 }).map((o) => String(o).slice(0, 200));
  if (['select', 'multiselect', 'poll'].includes(type) && options.length < 2) {
    throw badRequest('Для списков и голосований укажите не менее двух вариантов');
  }

  const maxPosition = get('SELECT COALESCE(MAX(position), 0) AS n FROM custom_fields WHERE form = ?', form).n;
  const result = run(
    `INSERT INTO custom_fields (form, field_key, label_ru, label_uz, label_en, type, required, help_text,
       options_json, position, team_can_fill, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    form, key, labelRu,
    v.str(ctx.body.label_uz, 'Название (узб.)', { max: 200 }),
    v.str(ctx.body.label_en, 'Название (англ.)', { max: 200 }),
    type, v.bool(ctx.body.required) ? 1 : 0,
    v.str(ctx.body.help_text, 'Подсказка', { max: 500 }),
    JSON.stringify(options),
    v.int(ctx.body.position, 'Позиция') ?? maxPosition + 1,
    v.bool(ctx.body.team_can_fill, true) ? 1 : 0,
    admin.id
  );
  audit.record({
    user: admin, action: 'settings', entityType: 'custom_field', entityId: Number(result.lastInsertRowid),
    summary: `Добавлено произвольное поле «${labelRu}» (${cf.FIELD_TYPES[type]}) в форму «${cf.FORMS[form]}»`, req: ctx.req,
  });
  return get('SELECT * FROM custom_fields WHERE id = ?', Number(result.lastInsertRowid));
});

router.patch('/api/admin/custom-fields/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.custom_fields');
  const field = get('SELECT * FROM custom_fields WHERE id = ?', Number(ctx.params.id));
  if (!field) throw notFound('Поле не найдено');

  const updates = {};
  if (ctx.body.label_ru !== undefined) updates.label_ru = v.str(ctx.body.label_ru, 'Название поля', { required: true, max: 200 });
  if (ctx.body.label_uz !== undefined) updates.label_uz = v.str(ctx.body.label_uz, 'Название (узб.)', { max: 200 });
  if (ctx.body.label_en !== undefined) updates.label_en = v.str(ctx.body.label_en, 'Название (англ.)', { max: 200 });
  if (ctx.body.help_text !== undefined) updates.help_text = v.str(ctx.body.help_text, 'Подсказка', { max: 500 });
  if (ctx.body.required !== undefined) updates.required = v.bool(ctx.body.required) ? 1 : 0;
  if (ctx.body.team_can_fill !== undefined) updates.team_can_fill = v.bool(ctx.body.team_can_fill) ? 1 : 0;
  if (ctx.body.position !== undefined) updates.position = v.int(ctx.body.position, 'Позиция', { min: 0 });
  if (ctx.body.options !== undefined) updates.options_json = JSON.stringify(v.array(ctx.body.options, 'Варианты', { max: 50 }).map(String));
  // Отключение поля скрывает его в новых записях, но сохраняет исторические данные (п. 9.1 ТЗ).
  if (ctx.body.is_active !== undefined) updates.is_active = v.bool(ctx.body.is_active) ? 1 : 0;
  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');

  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(`UPDATE custom_fields SET ${assignments} WHERE id = ?`, ...Object.values(updates), field.id);
  audit.record({
    user: admin, action: 'settings', entityType: 'custom_field', entityId: field.id,
    summary: `Изменено произвольное поле «${field.label_ru}»`,
    changes: audit.diff(Object.fromEntries(Object.keys(updates).map((k) => [k, field[k]])), updates), req: ctx.req,
  });
  return get('SELECT * FROM custom_fields WHERE id = ?', field.id);
});

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const transliterate = (text) =>
  String(text).toLowerCase().split('').map((ch) => (TRANSLIT[ch] ?? ch)).join('').replace(/[^a-z0-9]+/g, '_');

// -------------------------------------------------------------------------
// Настройки (п. 9.2 ТЗ)
// -------------------------------------------------------------------------
const EDITABLE_SETTINGS = {
  'reminders.days_before': 'Напоминания за N дней до срока',
  'reminders.escalate_overdue': 'Эскалация просроченных этапов руководству',
  'reminders.digest_weekday': 'День недели для еженедельной сводки (0 — воскресенье)',
  'reminders.digest_hour': 'Час отправки сводки (по Ташкенту)',
  'projects.stale_days': 'Порог «замершего» проекта, дней',
  'security.session_timeout_minutes': 'Тайм-аут неактивной сессии, минут',
  'security.require_2fa': 'Обязательная двухфакторная аутентификация',
  'recycle_bin.retention_days': 'Срок хранения в корзине, дней',
  'attention.meeting_tbc_days': 'За сколько дней предупреждать о несогласованных встречах',
  'currency.rates_to_usd': 'Курсы валют к доллару США',
  'org.name': 'Название организации',
  'org.ministry': 'Министерство',
  'projects.locations_for_export': 'Указывать регионы реализации и для экспортных проектов',
};

router.get('/api/admin/settings', async (ctx) => {
  requireAdmin(ctx, 'admin.settings');
  // Если строки в базе нет, отдаём значение по умолчанию, а не null:
  // иначе форма покажет нули и сохранит их поверх рабочих настроек.
  const values = {};
  for (const key of Object.keys(EDITABLE_SETTINGS)) values[key] = getSetting(key, DEFAULT_SETTINGS[key] ?? null);
  return {
    labels: EDITABLE_SETTINGS,
    values,
    channels: {
      email: { enabled: config.smtp.enabled, host: config.smtp.host || 'не настроен' },
      telegram: { enabled: config.telegram.enabled },
    },
    storage: { upload_dir: config.uploadDir, max_upload_mb: Math.round(config.maxUploadBytes / 1048576) },
  };
});

router.patch('/api/admin/settings', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.settings');
  const changes = [];
  for (const [key, value] of Object.entries(ctx.body || {})) {
    if (!Object.prototype.hasOwnProperty.call(EDITABLE_SETTINGS, key)) continue;
    const before = getSetting(key, null);
    setSetting(key, value, admin.id);
    changes.push({ field: key, label: EDITABLE_SETTINGS[key], from: before, to: value });
  }
  if (!changes.length) throw badRequest('Не передано ни одной известной настройки');
  audit.record({ user: admin, action: 'settings', entityType: 'settings', summary: 'Изменены настройки системы', changes, req: ctx.req });
  return { ok: true, changed: changes.length };
});

// -------------------------------------------------------------------------
// Журнал аудита (раздел 10 ТЗ)
// -------------------------------------------------------------------------
router.get('/api/admin/audit', async (ctx) => {
  requireAdmin(ctx, 'admin.audit');
  const result = audit.query({
    userId: ctx.query.user_id, action: ctx.query.action, entityType: ctx.query.entity_type,
    entityId: ctx.query.entity_id, from: ctx.query.from, to: ctx.query.to, search: ctx.query.search,
    limit: ctx.query.limit || 100, offset: ctx.query.offset || 0,
  });
  return { ...result, actions: audit.ACTION_LABELS, entities: audit.ENTITY_LABELS };
});

// -------------------------------------------------------------------------
// Корзина (п. 9.2 ТЗ): удалённые записи хранятся 30 дней
// -------------------------------------------------------------------------
const BINS = {
  project: { table: 'projects', label: 'Проекты', title: "code || ' — ' || title" },
  company: { table: 'companies', label: 'Компании', title: 'name' },
  visit: { table: 'visits', label: 'Визиты', title: "code || ' — ' || cities" },
  meeting: { table: 'meetings', label: 'Встречи', title: 'company_name' },
  step: { table: 'roadmap_steps', label: 'Этапы дорожных карт', title: 'title' },
};

router.get('/api/admin/recycle-bin', async (ctx) => {
  requireAdmin(ctx, 'admin.recycle_bin');
  const retention = Number(getSetting('recycle_bin.retention_days', 30));
  const result = {};
  for (const [type, meta] of Object.entries(BINS)) {
    result[type] = {
      label: meta.label,
      rows: all(
        `SELECT id, ${meta.title} AS title, deleted_at,
                CAST(julianday(deleted_at, '+${retention} day') - julianday('now') AS INTEGER) AS days_left
         FROM ${meta.table} WHERE is_deleted = 1 ORDER BY deleted_at DESC LIMIT 200`
      ),
    };
  }
  return { retention_days: retention, bins: result };
});

router.post('/api/admin/recycle-bin/:type/:id/restore', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.recycle_bin');
  const meta = BINS[ctx.params.type];
  if (!meta) throw badRequest('Неизвестный тип записи');
  const row = get(`SELECT * FROM ${meta.table} WHERE id = ? AND is_deleted = 1`, Number(ctx.params.id));
  if (!row) throw notFound('Запись не найдена в корзине');
  run(`UPDATE ${meta.table} SET is_deleted = 0, deleted_at = NULL WHERE id = ?`, row.id);
  audit.record({ user: admin, action: 'restore', entityType: ctx.params.type, entityId: row.id, summary: `Восстановлена запись из корзины (${meta.label})`, req: ctx.req });
  return { ok: true };
});

router.delete('/api/admin/recycle-bin/:type/:id', async (ctx) => {
  const admin = requireAdmin(ctx, 'admin.recycle_bin');
  const meta = BINS[ctx.params.type];
  if (!meta) throw badRequest('Неизвестный тип записи');
  const row = get(`SELECT * FROM ${meta.table} WHERE id = ? AND is_deleted = 1`, Number(ctx.params.id));
  if (!row) throw notFound('Запись не найдена в корзине');
  transaction(() => {
    run(`DELETE FROM ${meta.table} WHERE id = ?`, row.id);
    run('DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?', ctx.params.type, row.id);
    run('DELETE FROM comments WHERE entity_type = ? AND entity_id = ?', ctx.params.type, row.id);
  });
  audit.record({ user: admin, action: 'delete', entityType: ctx.params.type, entityId: row.id, summary: `Запись удалена окончательно (${meta.label})`, req: ctx.req });
  return { ok: true };
});

module.exports = router;

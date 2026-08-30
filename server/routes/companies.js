'use strict';
/** Модуль «Компании и партнёры» (раздел 4 ТЗ). */
const { Router, notFound, badRequest, conflict } = require('../lib/http');
const { all, get, run, transaction } = require('../db');
const { listCompanies, COMPANY_SELECT } = require('../queries');
const rbac = require('../rbac');
const audit = require('../audit');
const entities = require('../entities');
const cf = require('../customfields');
const v = require('../lib/validate');

const router = new Router();

const FIELD_LABELS = {
  name: 'Название', country_id: 'Страна', city: 'Город', website: 'Сайт',
  industry: 'Отрасль / сегмент', profile: 'Краткая справка', responsible_user_id: 'Ответственный',
};

function loadCompany(id) {
  const row = get(`${COMPANY_SELECT} WHERE c.id = ? AND c.is_deleted = 0`, Number(id));
  if (!row) throw notFound('Компания не найдена');
  return row;
}

/** Простая нормализация названия для поиска похожих компаний. */
const normalizeName = (name) =>
  String(name).toLowerCase()
    .replace(/[«»"'`.,\-—–()]/g, ' ')
    .replace(/\b(ооо|оао|зао|ао|гмбх|gmbh|ltd|llc|inc|co|corp|company|group|holding|s\.?a|sarl|plc|as|ag|bv|nv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

router.get('/api/companies', async (ctx) => {
  ctx.requireUser();
  return listCompanies(ctx.query);
});

/** Подсказка о возможных дубликатах при создании (раздел 4 ТЗ). */
router.get('/api/companies/similar', async (ctx) => {
  ctx.requireUser();
  const name = normalizeName(ctx.query.name || '');
  if (name.length < 3) return [];
  const words = name.split(' ').filter((w) => w.length > 2);
  if (!words.length) return [];
  const rows = all(
    'SELECT id, name, city, country_id FROM companies WHERE is_deleted = 0 AND merged_into_id IS NULL LIMIT 2000'
  );
  return rows
    .map((row) => {
      const other = normalizeName(row.name);
      const otherWords = new Set(other.split(' '));
      const overlap = words.filter((w) => otherWords.has(w)).length;
      return { ...row, score: overlap / words.length };
    })
    .filter((row) => row.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
});

router.get('/api/companies/:id', async (ctx) => {
  const user = ctx.requireUser();
  const company = loadCompany(ctx.params.id);
  const custom = cf.valuesFor('company', company.id, user.id);

  // Требование ТЗ: карточка компании показывает все её проекты, встречи и суммы.
  const projects = all(
    `SELECT p.id, p.code, p.title, p.status_code, p.area, p.amount, p.currency, p.sector_code,
            d.name_ru AS status_name, d.color AS status_color, u.full_name AS responsible_name,
            co.name_ru AS country_name
     FROM projects p
     LEFT JOIN dictionaries d ON d.kind = 'project_status' AND d.code = p.status_code
     LEFT JOIN users u ON u.id = p.responsible_user_id
     LEFT JOIN countries co ON co.id = p.country_id
     WHERE p.company_id = ? AND p.is_deleted = 0 ORDER BY p.updated_at DESC`,
    company.id
  );

  const meetings = all(
    `SELECT m.*, v.code AS visit_code, v.direction, v.date_from, v.date_to, v.id AS visit_id,
            d.name_ru AS status_name, d.color AS status_color
     FROM meetings m JOIN visits v ON v.id = m.visit_id
     LEFT JOIN dictionaries d ON d.kind = 'meeting_status' AND d.code = m.status_code
     WHERE m.company_id = ? AND m.is_deleted = 0 AND v.is_deleted = 0 ORDER BY m.meet_date DESC`,
    company.id
  );

  // Проекты, где компания выступает узбекской стороной (дополнение № 1 к ТЗ)
  const partnerProjects = all(
    `SELECT p.id, p.code, p.title, p.status_code, p.area, p.amount, p.currency,
            pp.role_note, d.name_ru AS status_name, d.color AS status_color,
            u.full_name AS responsible_name, co.name_ru AS country_name
     FROM project_partners pp
     JOIN projects p ON p.id = pp.project_id AND p.is_deleted = 0
     LEFT JOIN dictionaries d ON d.kind = 'project_status' AND d.code = p.status_code
     LEFT JOIN users u ON u.id = p.responsible_user_id
     LEFT JOIN countries co ON co.id = p.country_id
     WHERE pp.company_id = ? ORDER BY p.updated_at DESC`,
    company.id
  );

  const partnerTotals = {};
  for (const project of partnerProjects) {
    if (!project.amount) continue;
    partnerTotals[project.currency] = (partnerTotals[project.currency] || 0) + project.amount;
  }

  const totals = {};
  for (const project of projects) {
    if (!project.amount) continue;
    totals[project.currency] = (totals[project.currency] || 0) + project.amount;
  }

  return {
    ...company,
    contacts: all("SELECT * FROM contacts WHERE entity_type = 'company' AND entity_id = ? ORDER BY id", company.id),
    projects,
    partner_projects: partnerProjects,
    partner_totals: partnerTotals,
    role: projects.length && partnerProjects.length ? 'both'
      : partnerProjects.length ? 'local' : 'foreign',
    meetings,
    totals,
    attachments: entities.listAttachments('company', company.id, { allVersions: true }),
    comments: entities.listComments('company', company.id),
    custom_fields: cf.listFields('company'),
    custom_values: custom.values,
    polls: custom.polls,
  };
});

function readCompanyPayload(body, { partial = false } = {}) {
  const required = !partial;
  const data = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  if (required || has('name')) data.name = v.str(body.name, FIELD_LABELS.name, { required, max: 300 });
  if (required || has('country_id')) {
    data.country_id = v.int(body.country_id, FIELD_LABELS.country_id, { required });
    if (data.country_id && !get('SELECT id FROM countries WHERE id = ?', data.country_id)) throw badRequest('Страна не найдена');
  }
  if (has('city')) data.city = v.str(body.city, FIELD_LABELS.city, { max: 120 });
  if (has('website')) data.website = v.str(body.website, FIELD_LABELS.website, { max: 300 });
  if (has('industry')) data.industry = v.str(body.industry, FIELD_LABELS.industry, { max: 200 });
  if (has('profile')) data.profile = v.text(body.profile, FIELD_LABELS.profile, { max: 5000 });
  if (has('responsible_user_id')) data.responsible_user_id = v.int(body.responsible_user_id, FIELD_LABELS.responsible_user_id);
  return data;
}

router.post('/api/companies', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'company.create');
  const data = readCompanyPayload(ctx.body);
  if (!data.responsible_user_id) data.responsible_user_id = user.id;

  const company = transaction(() => {
    const result = run(
      `INSERT INTO companies (name, country_id, city, website, industry, profile, responsible_user_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.name, data.country_id, data.city || '', data.website || '', data.industry || '',
      data.profile || '', data.responsible_user_id, user.id, user.id
    );
    const companyId = Number(result.lastInsertRowid);
    for (const contact of v.array(ctx.body.contacts, 'Контактные лица', { max: 20 })) {
      run(
        `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email, note)
         VALUES ('company', ?, ?, ?, ?, ?, ?)`,
        companyId,
        v.str(contact.full_name, 'ФИО контактного лица', { required: true, max: 200 }),
        v.str(contact.position, 'Должность', { max: 200 }),
        v.str(contact.phone, 'Телефон', { max: 60 }),
        v.email(contact.email, 'Электронная почта'),
        v.str(contact.note, 'Примечание', { max: 500 })
      );
    }
    cf.saveValues('company', 'company', companyId, ctx.body.custom_values || {}, user);
    return loadCompany(companyId);
  });

  audit.record({
    user, action: 'create', entityType: 'company', entityId: company.id,
    summary: `Создана компания «${company.name}»`, changes: audit.diff({}, data, FIELD_LABELS), req: ctx.req,
  });
  return company;
});

router.patch('/api/companies/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'company.edit');
  const before = loadCompany(ctx.params.id);
  const data = readCompanyPayload(ctx.body, { partial: true });
  if (Object.keys(data).length) {
    const assignments = Object.keys(data).map((key) => `${key} = ?`).join(', ');
    run(
      `UPDATE companies SET ${assignments}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ...Object.values(data), user.id, before.id
    );
  }
  if (ctx.body.custom_values) cf.saveValues('company', 'company', before.id, ctx.body.custom_values, user);

  const after = loadCompany(before.id);
  audit.record({
    user, action: 'update', entityType: 'company', entityId: before.id,
    summary: `Изменена компания «${before.name}»`,
    changes: audit.diff(Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])), data, FIELD_LABELS),
    req: ctx.req,
  });
  return after;
});

router.delete('/api/companies/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'company.delete');
  const company = loadCompany(ctx.params.id);
  // Целостность данных (раздел 11 ТЗ): нельзя удалить компанию со связанными проектами.
  const linked = get('SELECT COUNT(*) AS n FROM projects WHERE company_id = ? AND is_deleted = 0', company.id).n;
  const asPartner = get(
    `SELECT COUNT(*) AS n FROM project_partners pp JOIN projects p ON p.id = pp.project_id
     WHERE pp.company_id = ? AND p.is_deleted = 0`,
    company.id
  ).n;
  if (linked > 0 || asPartner > 0) {
    const parts = [];
    if (linked > 0) parts.push(`как иностранный партнёр — ${linked}`);
    if (asPartner > 0) parts.push(`как местный партнёр — ${asPartner}`);
    throw conflict(
      `Нельзя удалить компанию: с ней связано проектов (${parts.join(', ')}). Сначала переназначьте или удалите эти записи.`,
      { linked, as_partner: asPartner }
    );
  }
  run("UPDATE companies SET is_deleted = 1, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?", user.id, company.id);
  audit.record({ user, action: 'delete', entityType: 'company', entityId: company.id, summary: `Удалена компания «${company.name}»`, req: ctx.req });
  return { ok: true };
});

/** Объединение дубликатов — только администратор (раздел 4 ТЗ). */
router.post('/api/companies/:id/merge', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'company.merge');
  const target = loadCompany(ctx.params.id);
  const sourceId = v.int(ctx.body.source_id, 'Компания-дубликат', { required: true });
  if (sourceId === target.id) throw badRequest('Нельзя объединить компанию саму с собой');
  const source = loadCompany(sourceId);

  transaction(() => {
    run('UPDATE projects SET company_id = ? WHERE company_id = ?', target.id, source.id);
    // Переносим роль местного партнёра, не создавая дублей в одном проекте
    run(`DELETE FROM project_partners WHERE company_id = ? AND project_id IN
           (SELECT project_id FROM project_partners WHERE company_id = ?)`, source.id, target.id);
    run('UPDATE project_partners SET company_id = ? WHERE company_id = ?', target.id, source.id);
    run('UPDATE meetings SET company_id = ? WHERE company_id = ?', target.id, source.id);
    run("UPDATE contacts SET entity_id = ? WHERE entity_type = 'company' AND entity_id = ?", target.id, source.id);
    run("UPDATE attachments SET entity_id = ? WHERE entity_type = 'company' AND entity_id = ?", target.id, source.id);
    run(
      "UPDATE companies SET is_deleted = 1, merged_into_id = ?, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?",
      target.id, user.id, source.id
    );
  });

  audit.record({
    user, action: 'update', entityType: 'company', entityId: target.id,
    summary: `Объединение дубликатов: «${source.name}» → «${target.name}»`,
    changes: [{ field: 'merge', label: 'Объединение', from: source.name, to: target.name }], req: ctx.req,
  });
  return loadCompany(target.id);
});

router.post('/api/companies/:id/contacts', async (ctx) => {
  const user = ctx.requireUser();
  const company = loadCompany(ctx.params.id);
  if (!rbac.can(user, 'company.edit') && company.created_by !== user.id && company.responsible_user_id !== user.id) {
    throw badRequest('Добавлять контакты можно только к своим записям');
  }
  const result = run(
    `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email, note)
     VALUES ('company', ?, ?, ?, ?, ?, ?)`,
    company.id,
    v.str(ctx.body.full_name, 'ФИО', { required: true, max: 200 }),
    v.str(ctx.body.position, 'Должность', { max: 200 }),
    v.str(ctx.body.phone, 'Телефон', { max: 60 }),
    v.email(ctx.body.email, 'Электронная почта'),
    v.str(ctx.body.note, 'Примечание', { max: 500 })
  );
  audit.record({ user, action: 'update', entityType: 'company', entityId: company.id, summary: 'Добавлено контактное лицо', req: ctx.req });
  return get('SELECT * FROM contacts WHERE id = ?', Number(result.lastInsertRowid));
});

router.post('/api/companies/:id/comments', async (ctx) => {
  const user = ctx.requireUser();
  loadCompany(ctx.params.id);
  return entities.addComment({ entityType: 'company', entityId: Number(ctx.params.id), body: ctx.body.body, user, req: ctx.req });
});

module.exports = router;

'use strict';
/** Модуль «Проекты / Соглашения» (раздел 3 ТЗ). */
const { Router, notFound, badRequest, forbidden } = require('../lib/http');
const { all, get, run, transaction, nextCode, getSetting } = require('../db');
const { listProjects, PROJECT_SELECT, decorateProject } = require('../queries');
const rbac = require('../rbac');
const audit = require('../audit');
const notify = require('../notify');
const entities = require('../entities');
const cf = require('../customfields');
const v = require('../lib/validate');

const router = new Router();

const FIELD_LABELS = {
  record_type: 'Тип записи', sector_code: 'Отрасль', area: 'Направление',
  country_id: 'Страна', company_id: 'Компания', title: 'Название',
  description: 'Описание', amount: 'Сумма', currency: 'Валюта',
  responsible_user_id: 'Ответственный', status_code: 'Статус',
};

const dictCodes = (kind) => all('SELECT code FROM dictionaries WHERE kind = ? AND is_active = 1', kind).map((r) => r.code);

function loadProject(id) {
  const row = get(`${PROJECT_SELECT} WHERE p.id = ? AND p.is_deleted = 0`, Number(id));
  if (!row) throw notFound('Проект не найден');
  return decorateProject(row);
}

const stepsOf = (projectId) =>
  all(
    `SELECT s.*, u.full_name AS responsible_name, cb.full_name AS created_by_name, db.full_name AS done_by_name,
            (SELECT COUNT(*) FROM attachments a WHERE a.entity_type = 'step' AND a.entity_id = s.id AND a.is_deleted = 0 AND a.is_current = 1) AS files_count
     FROM roadmap_steps s
     LEFT JOIN users u  ON u.id = s.responsible_user_id
     LEFT JOIN users cb ON cb.id = s.created_by
     LEFT JOIN users db ON db.id = s.done_by
     WHERE s.project_id = ? AND s.is_deleted = 0 ORDER BY s.seq, s.id`,
    projectId
  ).map((step) => ({
    ...step,
    is_overdue: step.state !== 'done' && step.due_date && step.due_date < new Date().toISOString().slice(0, 10),
  }));

// -------------------------------------------------------------------------
// Список и карточка
// -------------------------------------------------------------------------
router.get('/api/projects', async (ctx) => {
  ctx.requireUser();
  return listProjects(ctx.query);
});

router.get('/api/projects/:id', async (ctx) => {
  const user = ctx.requireUser();
  const project = loadProject(ctx.params.id);
  const custom = cf.valuesFor('project', project.id, user.id);
  return {
    ...project,
    steps: stepsOf(project.id),
    contacts: all("SELECT * FROM contacts WHERE entity_type = 'project' AND entity_id = ? ORDER BY id", project.id),
    comments: entities.listComments('project', project.id),
    attachments: entities.listAttachments('project', project.id, { allVersions: true }),
    status_history: all(
      `SELECT h.*, u.full_name AS user_name, d.name_ru AS to_status_name
       FROM project_status_history h LEFT JOIN users u ON u.id = h.user_id
       LEFT JOIN dictionaries d ON d.kind = 'project_status' AND d.code = h.to_status
       WHERE h.project_id = ? ORDER BY h.id DESC`,
      project.id
    ),
    meetings: all(
      `SELECT m.*, v.code AS visit_code, v.direction FROM meetings m JOIN visits v ON v.id = m.visit_id
       WHERE m.project_id = ? AND m.is_deleted = 0 AND v.is_deleted = 0 ORDER BY m.meet_date DESC`,
      project.id
    ),
    corrections: all(
      `SELECT cr.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
       FROM correction_requests cr LEFT JOIN users u ON u.id = cr.requested_by
       LEFT JOIN users d ON d.id = cr.decided_by
       WHERE cr.entity_type = 'project' AND cr.entity_id = ? ORDER BY cr.id DESC`,
      project.id
    ),
    custom_fields: cf.listFields('project'),
    custom_values: custom.values,
    polls: custom.polls,
  };
});

// -------------------------------------------------------------------------
// Создание — доступно администратору и проектному менеджеру
// -------------------------------------------------------------------------
function readProjectPayload(body, user, { partial = false } = {}) {
  const required = !partial;
  const data = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (required || has('record_type')) data.record_type = v.oneOf(body.record_type, FIELD_LABELS.record_type, dictCodes('record_type'), { required });
  if (required || has('sector_code')) data.sector_code = v.oneOf(body.sector_code, FIELD_LABELS.sector_code, dictCodes('sector'), { required });
  if (required || has('area')) data.area = v.oneOf(body.area, FIELD_LABELS.area, ['export', 'investment'], { required });
  if (required || has('country_id')) {
    data.country_id = v.int(body.country_id, FIELD_LABELS.country_id, { required });
    if (data.country_id && !get('SELECT id FROM countries WHERE id = ?', data.country_id)) throw badRequest('Страна не найдена в справочнике');
  }
  if (required || has('company_id')) {
    data.company_id = v.int(body.company_id, FIELD_LABELS.company_id, { required });
    if (data.company_id && !get('SELECT id FROM companies WHERE id = ? AND is_deleted = 0', data.company_id)) throw badRequest('Компания не найдена');
  }
  if (required || has('title')) data.title = v.str(body.title, FIELD_LABELS.title, { required, max: 300 });
  if (has('description')) data.description = v.text(body.description, FIELD_LABELS.description, { max: 10000 });
  if (has('amount')) data.amount = v.money(body.amount, FIELD_LABELS.amount);
  if (required || has('currency')) data.currency = v.oneOf(body.currency || 'USD', FIELD_LABELS.currency, dictCodes('currency'), { required: false, fallback: 'USD' }) || 'USD';
  if (required || has('responsible_user_id')) {
    data.responsible_user_id = v.int(body.responsible_user_id, FIELD_LABELS.responsible_user_id, { required: false }) || user.id;
    if (!get("SELECT id FROM users WHERE id = ? AND is_active = 1 AND role IN ('admin','team')", data.responsible_user_id)) {
      throw badRequest('Ответственный должен быть активным сотрудником офиса');
    }
  }
  if (required || has('status_code')) data.status_code = v.oneOf(body.status_code || 'negotiation', FIELD_LABELS.status_code, dictCodes('project_status'), { required: false, fallback: 'negotiation' }) || 'negotiation';
  return data;
}

router.post('/api/projects', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'project.create');
  const data = readProjectPayload(ctx.body, user);
  const contacts = v.array(ctx.body.contacts, 'Контактные лица', { max: 20 });
  if (!contacts.length) throw badRequest('Укажите хотя бы одно контактное лицо иностранного партнёра (поле P-10)');

  const project = transaction(() => {
    const code = nextCode('PRJ', 'projects');
    const result = run(
      `INSERT INTO projects (code, record_type, sector_code, area, country_id, company_id, title, description,
         amount, currency, responsible_user_id, status_code, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code, data.record_type, data.sector_code, data.area, data.country_id, data.company_id,
      data.title, data.description || '', data.amount ?? null, data.currency,
      data.responsible_user_id, data.status_code, user.id, user.id
    );
    const projectId = Number(result.lastInsertRowid);

    for (const contact of contacts) {
      run(
        `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email, note)
         VALUES ('project', ?, ?, ?, ?, ?, ?)`,
        projectId,
        v.str(contact.full_name, 'ФИО контактного лица', { required: true, max: 200 }),
        v.str(contact.position, 'Должность', { max: 200 }),
        v.str(contact.phone, 'Телефон', { max: 60 }),
        v.email(contact.email, 'Электронная почта'),
        v.str(contact.note, 'Примечание', { max: 500 })
      );
    }

    run(
      'INSERT INTO project_status_history (project_id, from_status, to_status, comment, user_id) VALUES (?, NULL, ?, ?, ?)',
      projectId, data.status_code, 'Создание записи', user.id
    );

    cf.saveValues('project', 'project', projectId, ctx.body.custom_values || {}, user);

    // Этапы дорожной карты можно передать сразу при создании.
    const steps = v.array(ctx.body.steps, 'Дорожная карта', { max: 100 });
    steps.forEach((step, index) => {
      run(
        `INSERT INTO roadmap_steps (project_id, seq, title, description, due_date, responsible_user_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        projectId, index + 1,
        v.str(step.title, 'Название этапа', { required: true, max: 300 }),
        v.text(step.description, 'Описание этапа', { max: 5000 }),
        v.date(step.due_date, 'Срок этапа'),
        v.int(step.responsible_user_id, 'Ответственный за этап') || data.responsible_user_id,
        user.id, user.id
      );
    });

    return loadProject(projectId);
  });

  audit.record({
    user, action: 'create', entityType: 'project', entityId: project.id,
    summary: `Создан проект ${project.code} — «${project.title}»`,
    changes: audit.diff({}, data, FIELD_LABELS), req: ctx.req,
  });

  const watchers = new Set([project.responsible_user_id, ...notify.adminIds()]);
  watchers.delete(user.id);
  notify.notifyMany([...watchers], {
    type: 'project_created',
    title: `Новый проект: ${project.code}`,
    body: `${project.title}\nСтрана: ${project.country_name}. Ответственный: ${project.responsible_name}.`,
    link: `/#/projects/${project.id}`,
  });

  return project;
});

// -------------------------------------------------------------------------
// Изменение — только администратор (п. 2.2 ТЗ)
// -------------------------------------------------------------------------
router.patch('/api/projects/:id', async (ctx) => {
  const user = ctx.requireUser();
  const before = loadProject(ctx.params.id);

  // Проектный менеджер может изменить только статус собственной записи.
  const onlyStatus = Object.keys(ctx.body).every((key) => key === 'status_code' || key === 'status_comment');
  if (!rbac.can(user, 'project.edit')) {
    if (!onlyStatus) {
      throw forbidden('Изменение записи доступно только администратору. Используйте «Запросить исправление».');
    }
    rbac.requireOwnOrAdmin(user, before, 'project.status_change');
  }

  const data = readProjectPayload(ctx.body, user, { partial: true });
  if (!Object.keys(data).length && !ctx.body.custom_values) throw badRequest('Нет данных для изменения');

  transaction(() => {
    if (Object.keys(data).length) {
      const assignments = Object.keys(data).map((key) => `${key} = ?`).join(', ');
      run(
        `UPDATE projects SET ${assignments}, updated_by = ?, updated_at = datetime('now'), last_activity_at = datetime('now') WHERE id = ?`,
        ...Object.values(data), user.id, before.id
      );
    }
    if (data.status_code && data.status_code !== before.status_code) {
      run(
        'INSERT INTO project_status_history (project_id, from_status, to_status, comment, user_id) VALUES (?, ?, ?, ?, ?)',
        before.id, before.status_code, data.status_code, v.str(ctx.body.status_comment, 'Комментарий', { max: 1000 }), user.id
      );
    }
    if (ctx.body.custom_values) cf.saveValues('project', 'project', before.id, ctx.body.custom_values, user);
  });

  const after = loadProject(before.id);
  const changes = audit.diff(
    Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])),
    data, FIELD_LABELS
  );
  audit.record({
    user,
    action: data.status_code && data.status_code !== before.status_code ? 'status_change' : 'update',
    entityType: 'project', entityId: before.id,
    summary: `Изменён проект ${before.code} — «${before.title}»`, changes, req: ctx.req,
  });

  if (data.status_code && data.status_code !== before.status_code) {
    const watchers = new Set([after.responsible_user_id, ...notify.adminIds()]);
    watchers.delete(user.id);
    notify.notifyMany([...watchers], {
      type: 'project_status',
      title: `Статус проекта ${after.code}: ${after.status_name}`,
      body: `${after.title}\nБыло: ${before.status_name} → стало: ${after.status_name}.`,
      link: `/#/projects/${after.id}`,
    });
  }
  return after;
});

router.delete('/api/projects/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'project.delete');
  const project = loadProject(ctx.params.id);
  run(
    "UPDATE projects SET is_deleted = 1, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?",
    user.id, project.id
  );
  audit.record({
    user, action: 'delete', entityType: 'project', entityId: project.id,
    summary: `Удалён проект ${project.code} — «${project.title}» (перемещён в корзину)`, req: ctx.req,
  });
  return { ok: true };
});

// -------------------------------------------------------------------------
// Дорожная карта (п. 3.2 ТЗ)
// -------------------------------------------------------------------------
router.post('/api/projects/:id/steps', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'step.create');
  const project = loadProject(ctx.params.id);

  const title = v.str(ctx.body.title, 'Название этапа', { required: true, max: 300 });
  const dueDate = v.date(ctx.body.due_date, 'Срок');
  const responsible = v.int(ctx.body.responsible_user_id, 'Ответственный') || project.responsible_user_id;
  const maxSeq = get('SELECT COALESCE(MAX(seq), 0) AS n FROM roadmap_steps WHERE project_id = ?', project.id).n;

  const result = run(
    `INSERT INTO roadmap_steps (project_id, seq, title, description, due_date, responsible_user_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    project.id, maxSeq + 1, title,
    v.text(ctx.body.description, 'Описание этапа', { max: 5000 }),
    dueDate, responsible, user.id, user.id
  );
  const stepId = Number(result.lastInsertRowid);
  entities.touchActivity('project', project.id);

  audit.record({
    user, action: 'create', entityType: 'step', entityId: stepId,
    summary: `Добавлен этап «${title}» в проект ${project.code}`,
    changes: [{ field: 'due_date', label: 'Срок', from: null, to: dueDate }], req: ctx.req,
  });

  if (responsible !== user.id) {
    notify.notify({
      userId: responsible, type: 'step_assigned',
      title: `Вам назначен этап: ${title}`,
      body: `Проект ${project.code} — «${project.title}».\nСрок: ${notify.formatDate(dueDate)}.`,
      link: `/#/projects/${project.id}`,
    });
  }
  return get('SELECT * FROM roadmap_steps WHERE id = ?', stepId);
});

router.patch('/api/steps/:id', async (ctx) => {
  const user = ctx.requireUser();
  const step = get('SELECT * FROM roadmap_steps WHERE id = ? AND is_deleted = 0', Number(ctx.params.id));
  if (!step) throw notFound('Этап не найден');
  const project = loadProject(step.project_id);

  const changingContent = ['title', 'description', 'due_date', 'responsible_user_id', 'seq']
    .some((key) => Object.prototype.hasOwnProperty.call(ctx.body, key));

  if (changingContent && !rbac.can(user, 'step.edit')) {
    throw forbidden('Изменение содержания этапа доступно только администратору. Используйте «Запросить исправление».');
  }

  const updates = {};
  if (rbac.can(user, 'step.edit')) {
    if (ctx.body.title !== undefined) updates.title = v.str(ctx.body.title, 'Название этапа', { required: true, max: 300 });
    if (ctx.body.description !== undefined) updates.description = v.text(ctx.body.description, 'Описание', { max: 5000 });
    if (ctx.body.due_date !== undefined) updates.due_date = v.date(ctx.body.due_date, 'Срок');
    if (ctx.body.responsible_user_id !== undefined) updates.responsible_user_id = v.int(ctx.body.responsible_user_id, 'Ответственный');
    if (ctx.body.seq !== undefined) updates.seq = v.int(ctx.body.seq, 'Порядок', { min: 0 });
  }

  // Отметка о выполнении доступна ответственному менеджеру (п. 3.2 ТЗ):
  // текст этапа при этом не меняется, действие фиксируется в журнале.
  if (ctx.body.state !== undefined) {
    const state = v.oneOf(ctx.body.state, 'Состояние этапа', ['planned', 'in_progress', 'done']);
    const own = step.responsible_user_id === user.id || project.responsible_user_id === user.id;
    if (!rbac.can(user, 'step.complete') || (user.role !== 'admin' && !own)) {
      throw forbidden('Отмечать выполнение можно только по своим этапам');
    }
    updates.state = state;
    updates.done_at = state === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    updates.done_by = state === 'done' ? user.id : null;
    if (ctx.body.done_comment !== undefined) updates.done_comment = v.text(ctx.body.done_comment, 'Комментарий о выполнении', { max: 2000 });
  }

  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');

  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(
    `UPDATE roadmap_steps SET ${assignments}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
    ...Object.values(updates), user.id, step.id
  );
  entities.touchActivity('project', project.id);

  const stateLabels = { planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен' };
  audit.record({
    user,
    action: updates.state ? 'complete' : 'update',
    entityType: 'step', entityId: step.id,
    summary: updates.state
      ? `Этап «${step.title}» переведён в состояние «${stateLabels[updates.state]}» (проект ${project.code})`
      : `Изменён этап «${step.title}» (проект ${project.code})`,
    changes: audit.diff(
      Object.fromEntries(Object.keys(updates).map((k) => [k, step[k]])),
      updates,
      { title: 'Название', due_date: 'Срок', state: 'Состояние', responsible_user_id: 'Ответственный' }
    ),
    req: ctx.req,
  });
  return get('SELECT * FROM roadmap_steps WHERE id = ?', step.id);
});

router.delete('/api/steps/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'step.delete');
  const step = get('SELECT * FROM roadmap_steps WHERE id = ? AND is_deleted = 0', Number(ctx.params.id));
  if (!step) throw notFound('Этап не найден');
  run("UPDATE roadmap_steps SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?", step.id);
  audit.record({ user, action: 'delete', entityType: 'step', entityId: step.id, summary: `Удалён этап «${step.title}»`, req: ctx.req });
  return { ok: true };
});

// -------------------------------------------------------------------------
// Комментарии и контакты
// -------------------------------------------------------------------------
router.post('/api/projects/:id/comments', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'project.comment');
  loadProject(ctx.params.id);
  return entities.addComment({ entityType: 'project', entityId: Number(ctx.params.id), body: ctx.body.body, user, req: ctx.req });
});

router.post('/api/projects/:id/contacts', async (ctx) => {
  const user = ctx.requireUser();
  const project = loadProject(ctx.params.id);
  if (!rbac.can(user, 'project.edit') && project.created_by !== user.id && project.responsible_user_id !== user.id) {
    throw forbidden('Добавлять контакты можно только к своим записям');
  }
  const result = run(
    `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email, note)
     VALUES ('project', ?, ?, ?, ?, ?, ?)`,
    project.id,
    v.str(ctx.body.full_name, 'ФИО', { required: true, max: 200 }),
    v.str(ctx.body.position, 'Должность', { max: 200 }),
    v.str(ctx.body.phone, 'Телефон', { max: 60 }),
    v.email(ctx.body.email, 'Электронная почта'),
    v.str(ctx.body.note, 'Примечание', { max: 500 })
  );
  audit.record({ user, action: 'update', entityType: 'project', entityId: project.id, summary: 'Добавлено контактное лицо', req: ctx.req });
  return get('SELECT * FROM contacts WHERE id = ?', Number(result.lastInsertRowid));
});

// -------------------------------------------------------------------------
// Заявки на исправление (п. 2.3 ТЗ)
// -------------------------------------------------------------------------
router.post('/api/corrections', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'correction.request');
  const entityType = v.oneOf(ctx.body.entity_type, 'Тип записи', ['project', 'company', 'visit', 'meeting', 'step']);
  const entityId = v.int(ctx.body.entity_id, 'Запись', { required: true });
  entities.assertEntityExists(entityType, entityId);
  const reason = v.text(ctx.body.reason, 'Что и почему нужно исправить', { required: true, max: 3000 });

  const result = run(
    `INSERT INTO correction_requests (entity_type, entity_id, entity_label, requested_by, reason, proposed_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    entityType, entityId, v.str(ctx.body.entity_label, 'Запись', { max: 300 }), user.id, reason,
    JSON.stringify(ctx.body.proposed || {})
  );
  const id = Number(result.lastInsertRowid);

  audit.record({ user, action: 'correction_request', entityType, entityId, summary: `Заявка на исправление: ${reason.slice(0, 150)}`, req: ctx.req });
  notify.notifyMany(notify.adminIds(), {
    type: 'correction_request',
    title: 'Новая заявка на исправление',
    body: `${user.full_name}: ${reason.slice(0, 400)}`,
    link: `/#/corrections`,
    severity: 'warning',
  });
  return get('SELECT * FROM correction_requests WHERE id = ?', id);
});

router.get('/api/corrections', async (ctx) => {
  const user = ctx.requireUser();
  const where = ['1 = 1'];
  const params = [];
  if (ctx.query.status) { where.push('cr.status = ?'); params.push(ctx.query.status); }
  if (user.role === 'team') { where.push('cr.requested_by = ?'); params.push(user.id); }
  return all(
    `SELECT cr.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
     FROM correction_requests cr LEFT JOIN users u ON u.id = cr.requested_by
     LEFT JOIN users d ON d.id = cr.decided_by
     WHERE ${where.join(' AND ')} ORDER BY cr.status = 'pending' DESC, cr.id DESC LIMIT 300`,
    ...params
  );
});

router.post('/api/corrections/:id/decide', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'correction.decide');
  const request = get("SELECT * FROM correction_requests WHERE id = ? AND status = 'pending'", Number(ctx.params.id));
  if (!request) throw notFound('Заявка не найдена или уже рассмотрена');

  const decision = v.oneOf(ctx.body.decision, 'Решение', ['approved', 'rejected']);
  const note = v.text(ctx.body.note, 'Комментарий', { max: 2000 });

  run(
    "UPDATE correction_requests SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?",
    decision, user.id, note, request.id
  );

  audit.record({
    user, action: 'correction_decision', entityType: request.entity_type, entityId: request.entity_id,
    summary: `Заявка на исправление ${decision === 'approved' ? 'одобрена' : 'отклонена'}: ${request.reason.slice(0, 150)}`,
    req: ctx.req,
  });
  notify.notify({
    userId: request.requested_by,
    type: 'correction_decision',
    title: `Заявка на исправление ${decision === 'approved' ? 'одобрена' : 'отклонена'}`,
    body: note || request.reason,
    link: `/#/${request.entity_type}s/${request.entity_id}`,
    severity: decision === 'approved' ? 'success' : 'warning',
  });
  return get('SELECT * FROM correction_requests WHERE id = ?', request.id);
});

// -------------------------------------------------------------------------
// Kanban-доска (раздел 10 ТЗ)
// -------------------------------------------------------------------------
router.get('/api/kanban', async (ctx) => {
  ctx.requireUser();
  const statuses = all("SELECT * FROM dictionaries WHERE kind = 'project_status' AND is_active = 1 ORDER BY sort");
  const { rows } = listProjects({ ...ctx.query, limit: 500 });
  return {
    columns: statuses.map((status) => ({
      ...status,
      projects: rows.filter((p) => p.status_code === status.code),
    })),
  };
});

// -------------------------------------------------------------------------
// Голосование в произвольном поле типа «poll»
// -------------------------------------------------------------------------
router.post('/api/polls/:fieldId/vote', async (ctx) => {
  const user = ctx.requireUser();
  const entityType = v.oneOf(ctx.body.entity_type, 'Тип записи', ['project', 'visit', 'company']);
  const entityId = v.int(ctx.body.entity_id, 'Запись', { required: true });
  entities.assertEntityExists(entityType, entityId);
  return cf.vote(Number(ctx.params.fieldId), entityType, entityId, user.id, String(ctx.body.option));
});

module.exports = router;

'use strict';
/** Модуль «Визиты и встречи» (раздел 5 ТЗ). */
const { Router, notFound, badRequest, forbidden } = require('../lib/http');
const { all, get, run, transaction, nextCode } = require('../db');
const { listVisits, VISIT_SELECT } = require('../queries');
const rbac = require('../rbac');
const audit = require('../audit');
const notify = require('../notify');
const entities = require('../entities');
const cf = require('../customfields');
const v = require('../lib/validate');

const router = new Router();

const FIELD_LABELS = {
  direction: 'Направление', country_id: 'Страна', cities: 'Города',
  date_from: 'Дата начала', date_to: 'Дата окончания', status_code: 'Статус',
  goal: 'Цель визита', outcome: 'Итоги визита', responsible_user_id: 'Ответственный',
};

const dictCodes = (kind) => all('SELECT code FROM dictionaries WHERE kind = ? AND is_active = 1', kind).map((r) => r.code);

function loadVisit(id) {
  const row = get(`${VISIT_SELECT} WHERE v.id = ? AND v.is_deleted = 0`, Number(id));
  if (!row) throw notFound('Визит не найден');
  return row;
}

const meetingsOf = (visitId) =>
  all(
    `SELECT m.*, c.name AS linked_company_name, p.code AS project_code, p.title AS project_title,
            d.name_ru AS status_name, d.color AS status_color
     FROM meetings m
     LEFT JOIN companies c ON c.id = m.company_id
     LEFT JOIN projects p  ON p.id = m.project_id
     LEFT JOIN dictionaries d ON d.kind = 'meeting_status' AND d.code = m.status_code
     WHERE m.visit_id = ? AND m.is_deleted = 0
     ORDER BY m.meet_date, m.meet_time, m.id`,
    visitId
  );

router.get('/api/visits', async (ctx) => {
  ctx.requireUser();
  return listVisits(ctx.query);
});

router.get('/api/visits/:id', async (ctx) => {
  const user = ctx.requireUser();
  const visit = loadVisit(ctx.params.id);
  const meetings = meetingsOf(visit.id);
  const custom = cf.valuesFor('visit', visit.id, user.id);

  // Программа визита по дням — для печати одностраничного документа (п. 5.2 ТЗ).
  const agenda = [];
  for (const meeting of meetings) {
    let day = agenda.find((d) => d.date === meeting.meet_date);
    if (!day) { day = { date: meeting.meet_date, meetings: [] }; agenda.push(day); }
    day.meetings.push(meeting);
  }

  return {
    ...visit,
    members: all(
      `SELECT vm.*, u.full_name AS user_full_name FROM visit_members vm
       LEFT JOIN users u ON u.id = vm.user_id WHERE vm.visit_id = ? ORDER BY vm.id`,
      visit.id
    ),
    meetings,
    agenda,
    attachments: entities.listAttachments('visit', visit.id, { allVersions: true }),
    comments: entities.listComments('visit', visit.id),
    custom_fields: cf.listFields('visit'),
    custom_values: custom.values,
    polls: custom.polls,
  };
});

function readVisitPayload(body, { partial = false } = {}) {
  const required = !partial;
  const data = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (required || has('direction')) data.direction = v.oneOf(body.direction, FIELD_LABELS.direction, ['outbound', 'inbound'], { required });
  if (required || has('country_id')) {
    data.country_id = v.int(body.country_id, FIELD_LABELS.country_id, { required });
    if (data.country_id && !get('SELECT id FROM countries WHERE id = ?', data.country_id)) throw badRequest('Страна не найдена');
  }
  if (required || has('cities')) {
    const cities = Array.isArray(body.cities) ? body.cities.join(', ') : body.cities;
    data.cities = v.str(cities, FIELD_LABELS.cities, { required, max: 500 });
  }
  if (required || has('date_from')) data.date_from = v.date(body.date_from, FIELD_LABELS.date_from, { required });
  if (required || has('date_to')) data.date_to = v.date(body.date_to, FIELD_LABELS.date_to, { required });
  if (data.date_from && data.date_to && data.date_to < data.date_from) {
    throw badRequest('Дата окончания визита не может быть раньше даты начала');
  }
  if (required || has('status_code')) data.status_code = v.oneOf(body.status_code || 'planned', FIELD_LABELS.status_code, dictCodes('visit_status'), { required: false, fallback: 'planned' }) || 'planned';
  if (required || has('goal')) data.goal = v.text(body.goal, FIELD_LABELS.goal, { required, max: 5000 });
  if (has('outcome')) data.outcome = v.text(body.outcome, FIELD_LABELS.outcome, { max: 10000 });
  if (has('responsible_user_id')) data.responsible_user_id = v.int(body.responsible_user_id, FIELD_LABELS.responsible_user_id);
  return data;
}

router.post('/api/visits', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'visit.create');
  const data = readVisitPayload(ctx.body);
  if (!data.responsible_user_id) data.responsible_user_id = user.id;

  const members = v.array(ctx.body.members, 'Состав делегации', { max: 100 });
  if (!members.length) throw badRequest('Укажите состав делегации (поле V-07)');

  const visit = transaction(() => {
    const code = nextCode('VIS', 'visits');
    const result = run(
      `INSERT INTO visits (code, direction, country_id, cities, date_from, date_to, status_code, goal, outcome,
         responsible_user_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code, data.direction, data.country_id, data.cities, data.date_from, data.date_to,
      data.status_code, data.goal, data.outcome || '', data.responsible_user_id, user.id, user.id
    );
    const visitId = Number(result.lastInsertRowid);

    for (const member of members) {
      const userId = v.int(member.user_id, 'Сотрудник');
      const fullName = userId
        ? get('SELECT full_name FROM users WHERE id = ?', userId)?.full_name
        : v.str(member.full_name, 'ФИО участника', { required: true, max: 200 });
      if (!fullName) throw badRequest('Не удалось определить участника делегации');
      run(
        'INSERT INTO visit_members (visit_id, user_id, full_name, organization, position) VALUES (?, ?, ?, ?, ?)',
        visitId, userId, fullName,
        v.str(member.organization, 'Организация', { max: 200 }),
        v.str(member.position, 'Должность', { max: 200 })
      );
    }

    for (const meeting of v.array(ctx.body.meetings, 'Встречи', { max: 100 })) {
      insertMeeting(visitId, meeting, user);
    }

    cf.saveValues('visit', 'visit', visitId, ctx.body.custom_values || {}, user);
    return loadVisit(visitId);
  });

  audit.record({
    user, action: 'create', entityType: 'visit', entityId: visit.id,
    summary: `Создан визит ${visit.code}: ${visit.country_name}, ${visit.cities}`,
    changes: audit.diff({}, data, FIELD_LABELS), req: ctx.req,
  });
  return visit;
});

router.patch('/api/visits/:id', async (ctx) => {
  const user = ctx.requireUser();
  const before = loadVisit(ctx.params.id);
  const onlyStatus = Object.keys(ctx.body).every((key) => key === 'status_code');
  if (!rbac.can(user, 'visit.edit')) {
    if (!onlyStatus) throw forbidden('Изменение визита доступно только администратору. Используйте «Запросить исправление».');
    rbac.requireOwnOrAdmin(user, before, 'visit.create');
  }

  const data = readVisitPayload(ctx.body, { partial: true });
  if (Object.keys(data).length) {
    const assignments = Object.keys(data).map((key) => `${key} = ?`).join(', ');
    run(
      `UPDATE visits SET ${assignments}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ...Object.values(data), user.id, before.id
    );
  }
  if (ctx.body.custom_values) cf.saveValues('visit', 'visit', before.id, ctx.body.custom_values, user);

  const after = loadVisit(before.id);
  audit.record({
    user, action: data.status_code && data.status_code !== before.status_code ? 'status_change' : 'update',
    entityType: 'visit', entityId: before.id,
    summary: `Изменён визит ${before.code}`,
    changes: audit.diff(Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])), data, FIELD_LABELS),
    req: ctx.req,
  });

  if (data.status_code === 'confirmed' && before.status_code !== 'confirmed') {
    const recipients = new Set([
      after.responsible_user_id,
      ...all('SELECT user_id FROM visit_members WHERE visit_id = ? AND user_id IS NOT NULL', after.id).map((r) => r.user_id),
      ...notify.adminIds(),
    ]);
    recipients.delete(user.id);
    notify.notifyMany([...recipients], {
      type: 'visit_confirmed',
      title: `Визит подтверждён: ${after.country_name}`,
      body: `${after.code} — ${after.cities}\n${notify.formatDate(after.date_from)} – ${notify.formatDate(after.date_to)}`,
      link: `/#/visits/${after.id}`,
      severity: 'success',
    });
  }
  return after;
});

router.delete('/api/visits/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'visit.delete');
  const visit = loadVisit(ctx.params.id);
  run("UPDATE visits SET is_deleted = 1, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?", user.id, visit.id);
  audit.record({ user, action: 'delete', entityType: 'visit', entityId: visit.id, summary: `Удалён визит ${visit.code}`, req: ctx.req });
  return { ok: true };
});

// -------------------------------------------------------------------------
// Состав делегации
// -------------------------------------------------------------------------
router.post('/api/visits/:id/members', async (ctx) => {
  const user = ctx.requireUser();
  const visit = loadVisit(ctx.params.id);
  if (!rbac.can(user, 'visit.edit') && visit.created_by !== user.id && visit.responsible_user_id !== user.id) {
    throw forbidden('Изменять состав делегации можно только по своим визитам');
  }
  const userId = v.int(ctx.body.user_id, 'Сотрудник');
  const fullName = userId
    ? get('SELECT full_name FROM users WHERE id = ?', userId)?.full_name
    : v.str(ctx.body.full_name, 'ФИО участника', { required: true, max: 200 });
  const result = run(
    'INSERT INTO visit_members (visit_id, user_id, full_name, organization, position) VALUES (?, ?, ?, ?, ?)',
    visit.id, userId, fullName,
    v.str(ctx.body.organization, 'Организация', { max: 200 }),
    v.str(ctx.body.position, 'Должность', { max: 200 })
  );
  audit.record({ user, action: 'update', entityType: 'visit', entityId: visit.id, summary: `В состав делегации добавлен(а) ${fullName}`, req: ctx.req });
  return get('SELECT * FROM visit_members WHERE id = ?', Number(result.lastInsertRowid));
});

router.delete('/api/visit-members/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'visit.edit');
  const member = get('SELECT * FROM visit_members WHERE id = ?', Number(ctx.params.id));
  if (!member) throw notFound('Участник не найден');
  run('DELETE FROM visit_members WHERE id = ?', member.id);
  audit.record({ user, action: 'delete', entityType: 'visit', entityId: member.visit_id, summary: `Из состава делегации исключён(а) ${member.full_name}`, req: ctx.req });
  return { ok: true };
});

// -------------------------------------------------------------------------
// Встречи внутри визита (п. 5.2 ТЗ)
// -------------------------------------------------------------------------
function insertMeeting(visitId, body, user) {
  const companyId = v.int(body.company_id, 'Компания');
  let companyName = v.str(body.company_name, 'Название организации', { max: 300 });
  if (companyId) {
    const company = get('SELECT name FROM companies WHERE id = ? AND is_deleted = 0', companyId);
    if (!company) throw badRequest('Компания не найдена');
    companyName = company.name;
  }
  if (!companyName) throw badRequest('Укажите компанию или название организации для встречи');

  const projectId = v.int(body.project_id, 'Проект');
  if (projectId && !get('SELECT id FROM projects WHERE id = ? AND is_deleted = 0', projectId)) {
    throw badRequest('Связанный проект не найден');
  }

  const result = run(
    `INSERT INTO meetings (visit_id, company_id, company_name, project_id, meet_date, meet_time, venue,
       status_code, participants, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    visitId, companyId, companyName, projectId,
    v.date(body.meet_date, 'Дата встречи', { required: true }),
    v.time(body.meet_time, 'Время встречи'),
    v.str(body.venue, 'Место проведения', { max: 300 }),
    v.oneOf(body.status_code || 'tbc', 'Статус встречи', dictCodes('meeting_status'), { required: false, fallback: 'tbc' }) || 'tbc',
    v.str(body.participants, 'Участники', { max: 1000 }),
    v.text(body.notes, 'Примечания / итоги', { max: 5000 }),
    user.id, user.id
  );
  return Number(result.lastInsertRowid);
}

router.post('/api/visits/:id/meetings', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'meeting.create');
  const visit = loadVisit(ctx.params.id);
  const meetingId = insertMeeting(visit.id, ctx.body, user);
  const meeting = get('SELECT * FROM meetings WHERE id = ?', meetingId);
  audit.record({
    user, action: 'create', entityType: 'meeting', entityId: meetingId,
    summary: `Добавлена встреча с «${meeting.company_name}» (визит ${visit.code})`, req: ctx.req,
  });
  return meeting;
});

router.patch('/api/meetings/:id', async (ctx) => {
  const user = ctx.requireUser();
  const meeting = get('SELECT * FROM meetings WHERE id = ? AND is_deleted = 0', Number(ctx.params.id));
  if (!meeting) throw notFound('Встреча не найдена');
  const visit = loadVisit(meeting.visit_id);

  const changingContent = ['company_id', 'company_name', 'meet_date', 'meet_time', 'venue', 'participants', 'project_id']
    .some((key) => Object.prototype.hasOwnProperty.call(ctx.body, key));
  if (changingContent && !rbac.can(user, 'meeting.edit')) {
    throw forbidden('Изменение встречи доступно только администратору. Используйте «Запросить исправление».');
  }

  const updates = {};
  if (rbac.can(user, 'meeting.edit')) {
    if (ctx.body.company_id !== undefined) {
      updates.company_id = v.int(ctx.body.company_id, 'Компания');
      if (updates.company_id) {
        updates.company_name = get('SELECT name FROM companies WHERE id = ?', updates.company_id)?.name || meeting.company_name;
      }
    }
    if (ctx.body.company_name !== undefined && !updates.company_name) updates.company_name = v.str(ctx.body.company_name, 'Организация', { max: 300 });
    if (ctx.body.meet_date !== undefined) updates.meet_date = v.date(ctx.body.meet_date, 'Дата встречи', { required: true });
    if (ctx.body.meet_time !== undefined) updates.meet_time = v.time(ctx.body.meet_time, 'Время встречи');
    if (ctx.body.venue !== undefined) updates.venue = v.str(ctx.body.venue, 'Место проведения', { max: 300 });
    if (ctx.body.participants !== undefined) updates.participants = v.str(ctx.body.participants, 'Участники', { max: 1000 });
    if (ctx.body.project_id !== undefined) updates.project_id = v.int(ctx.body.project_id, 'Проект');
  }

  // Статус и итоги встречи может обновлять проектный менеджер (п. 5.2 ТЗ).
  if (ctx.body.status_code !== undefined) {
    rbac.require(user, 'meeting.status_change');
    if (user.role !== 'admin' && visit.responsible_user_id !== user.id && meeting.created_by !== user.id) {
      throw forbidden('Статус встречи может изменить ответственный за визит');
    }
    updates.status_code = v.oneOf(ctx.body.status_code, 'Статус встречи', dictCodes('meeting_status'));
  }
  if (ctx.body.notes !== undefined) {
    if (user.role !== 'admin' && visit.responsible_user_id !== user.id && meeting.created_by !== user.id) {
      throw forbidden('Итоги встречи заполняет ответственный за визит');
    }
    updates.notes = v.text(ctx.body.notes, 'Примечания / итоги', { max: 5000 });
  }

  if (!Object.keys(updates).length) throw badRequest('Нет данных для изменения');
  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  run(
    `UPDATE meetings SET ${assignments}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
    ...Object.values(updates), user.id, meeting.id
  );

  audit.record({
    user, action: updates.status_code ? 'status_change' : 'update',
    entityType: 'meeting', entityId: meeting.id,
    summary: `Изменена встреча с «${meeting.company_name}» (визит ${visit.code})`,
    changes: audit.diff(
      Object.fromEntries(Object.keys(updates).map((k) => [k, meeting[k]])), updates,
      { status_code: 'Статус', meet_date: 'Дата', meet_time: 'Время', venue: 'Место', notes: 'Итоги' }
    ),
    req: ctx.req,
  });

  if (updates.status_code && updates.status_code !== meeting.status_code) {
    const recipients = new Set([visit.responsible_user_id, ...notify.adminIds()]);
    recipients.delete(user.id);
    notify.notifyMany([...recipients], {
      type: 'meeting_status',
      title: `Встреча с «${meeting.company_name}»: новый статус`,
      body: `Визит ${visit.code}, ${notify.formatDate(updates.meet_date || meeting.meet_date)}.`,
      link: `/#/visits/${visit.id}`,
    });
  }
  return get('SELECT * FROM meetings WHERE id = ?', meeting.id);
});

router.delete('/api/meetings/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'meeting.delete');
  const meeting = get('SELECT * FROM meetings WHERE id = ? AND is_deleted = 0', Number(ctx.params.id));
  if (!meeting) throw notFound('Встреча не найдена');
  run("UPDATE meetings SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?", meeting.id);
  audit.record({ user, action: 'delete', entityType: 'meeting', entityId: meeting.id, summary: `Удалена встреча с «${meeting.company_name}»`, req: ctx.req });
  return { ok: true };
});

router.post('/api/visits/:id/comments', async (ctx) => {
  const user = ctx.requireUser();
  loadVisit(ctx.params.id);
  return entities.addComment({ entityType: 'visit', entityId: Number(ctx.params.id), body: ctx.body.body, user, req: ctx.req });
});

module.exports = router;

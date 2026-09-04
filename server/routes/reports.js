'use strict';
/** Отчёты, выгрузки Excel/CSV и календарь (раздел 8 ТЗ). */
const { Router, sendBuffer, notFound } = require('../lib/http');
const { all, get, getSetting } = require('../db');
const { allProjects, allVisits, allCompanies } = require('../queries');
const { buildWorkbook, buildCsv } = require('../lib/xlsx');
const { buildCalendar } = require('../lib/ics');
const config = require('../config');
const rbac = require('../rbac');
const audit = require('../audit');
const cf = require('../customfields');

const router = new Router();

const AREA_LABELS = { export: 'Экспорт', investment: 'Инвестиции' };
const DIRECTION_LABELS = { outbound: 'Выездной (делегация из Узбекистана)', inbound: 'Входящий (иностранная делегация)' };
const STATE_LABELS = { planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен' };

const PROJECT_COLUMNS = [
  { header: 'Код', key: 'code', width: 14 },
  { header: 'Тип записи', key: 'record_type_name', width: 18 },
  { header: 'Название', key: 'title', width: 46 },
  { header: 'Отрасль', key: 'sector_name', width: 16 },
  { header: 'Направление', key: 'area_label', width: 14 },
  { header: 'Страна', key: 'country_name', width: 18 },
  { header: 'Регион', key: 'region_name', width: 20 },
  { header: 'Компания', key: 'company_name', width: 32 },
  { header: 'Местные партнёры', key: 'partner_names', width: 34 },
  { header: 'Регионы реализации', key: 'uz_region_names', width: 30 },
  { header: 'Города и районы', key: 'locality_names', width: 28 },
  { header: 'Статус', key: 'status_name', width: 22 },
  { header: 'Сумма', key: 'amount', type: 'money', width: 16 },
  { header: 'Валюта', key: 'currency', width: 10 },
  { header: 'Ответственный', key: 'responsible_name', width: 26 },
  { header: 'Этапов всего', key: 'steps_total', type: 'number', width: 13 },
  { header: 'Выполнено', key: 'steps_done', type: 'number', width: 12 },
  { header: 'Просрочено', key: 'steps_overdue', type: 'number', width: 12 },
  { header: 'Ближайший срок', key: 'next_due_date', type: 'date', width: 16 },
  { header: 'Создан', key: 'created_at', type: 'date', width: 16 },
  { header: 'Последняя активность', key: 'last_activity_at', type: 'date', width: 20 },
];

const VISIT_COLUMNS = [
  { header: 'Код', key: 'code', width: 14 },
  { header: 'Направление', key: 'direction_label', width: 34 },
  { header: 'Страна', key: 'country_name', width: 18 },
  { header: 'Города', key: 'cities', width: 26 },
  { header: 'Начало', key: 'date_from', type: 'date', width: 14 },
  { header: 'Окончание', key: 'date_to', type: 'date', width: 14 },
  { header: 'Статус', key: 'status_name', width: 18 },
  { header: 'Цель', key: 'goal', width: 50 },
  { header: 'Ответственный', key: 'responsible_name', width: 26 },
  { header: 'Встреч', key: 'meetings_total', type: 'number', width: 10 },
  { header: 'Не подтверждено', key: 'meetings_tbc', type: 'number', width: 16 },
  { header: 'Участников', key: 'members_total', type: 'number', width: 12 },
];

const COMPANY_COLUMNS = [
  { header: 'Название', key: 'name', width: 38 },
  { header: 'Страна', key: 'country_name', width: 18 },
  { header: 'Город', key: 'city', width: 18 },
  { header: 'Отрасль / сегмент', key: 'industry', width: 26 },
  { header: 'Сайт', key: 'website', width: 26 },
  { header: 'Ответственный', key: 'responsible_name', width: 26 },
  { header: 'Проектов', key: 'projects_count', type: 'number', width: 11 },
  { header: 'Сумма USD', key: 'amount_usd', type: 'money', width: 16 },
  { header: 'Встреч', key: 'meetings_count', type: 'number', width: 10 },
];

const STEP_COLUMNS = [
  { header: 'Проект', key: 'project_code', width: 14 },
  { header: 'Название проекта', key: 'project_title', width: 42 },
  { header: 'Этап', key: 'title', width: 42 },
  { header: 'Срок', key: 'due_date', type: 'date', width: 14 },
  { header: 'Состояние', key: 'state_label', width: 16 },
  { header: 'Просрочен', key: 'overdue_label', width: 12 },
  { header: 'Ответственный', key: 'responsible_name', width: 26 },
  { header: 'Выполнен', key: 'done_at', type: 'date', width: 16 },
];

async function projectRows(query) {
  const rows = await allProjects(query);
  const ids = rows.map((r) => r.id);
  const customValues = await cf.exportValues('project', 'project', ids);
  return rows.map((row) => ({
    ...row,
    area_label: AREA_LABELS[row.area] || row.area,
    ...(customValues.get(row.id) || {}),
  }));
}

async function visitRows(query) {
  const rows = await allVisits(query);
  const customValues = await cf.exportValues('visit', 'visit', rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    direction_label: DIRECTION_LABELS[row.direction] || row.direction,
    ...(customValues.get(row.id) || {}),
  }));
}

async function stepRows(query) {
  const today = new Date().toISOString().slice(0, 10);
  const where = ['s.is_deleted = 0', 'p.is_deleted = 0'];
  const params = [];
  if (query.responsible_id) { where.push('s.responsible_user_id = ?'); params.push(Number(query.responsible_id)); }
  if (query.state) { where.push('s.state = ?'); params.push(query.state); }
  if (query.overdue === '1') { where.push("s.state <> 'done' AND s.due_date IS NOT NULL AND s.due_date < date('now')"); }
  if (query.date_from) { where.push('s.due_date >= ?'); params.push(query.date_from); }
  if (query.date_to) { where.push('s.due_date <= ?'); params.push(query.date_to); }

  return (await all(
    `SELECT s.*, p.code AS project_code, p.title AS project_title, u.full_name AS responsible_name
     FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.responsible_user_id
     WHERE ${where.join(' AND ')} ORDER BY s.due_date IS NULL, s.due_date LIMIT 20000`,
    ...params
  )).map((row) => ({
    ...row,
    state_label: STATE_LABELS[row.state] || row.state,
    overdue_label: row.state !== 'done' && row.due_date && row.due_date < today ? 'Да' : 'Нет',
  }));
}

/** Построчная выгрузка: одна строка на пару «проект — регион реализации». */
async function uzLocationRows() {
  return await all(
    `SELECT p.code, p.title, ur.name_ru AS region_name, pl.locality, pl.amount AS region_amount,
            p.amount AS project_amount, p.currency, d.name_ru AS status_name,
            u.full_name AS responsible_name,
            (SELECT GROUP_CONCAT(c2.name, '; ') FROM project_partners pp2
               JOIN companies c2 ON c2.id = pp2.company_id WHERE pp2.project_id = p.id) AS partner_names
     FROM project_locations pl
     JOIN projects p ON p.id = pl.project_id AND p.is_deleted = 0
     JOIN uz_regions ur ON ur.id = pl.uz_region_id
     LEFT JOIN dictionaries d ON d.kind = 'project_status' AND d.code = p.status_code
     LEFT JOIN users u ON u.id = p.responsible_user_id
     ORDER BY ur.sort, p.code`
  );
}

const UZ_LOCATION_COLUMNS = [
  { header: 'Код проекта', key: 'code', width: 14 },
  { header: 'Название', key: 'title', width: 46 },
  { header: 'Регион Узбекистана', key: 'region_name', width: 28 },
  { header: 'Город или район', key: 'locality', width: 26 },
  { header: 'Объём в регионе', key: 'region_amount', type: 'money', width: 18 },
  { header: 'Сумма проекта', key: 'project_amount', type: 'money', width: 18 },
  { header: 'Валюта', key: 'currency', width: 10 },
  { header: 'Местные партнёры', key: 'partner_names', width: 34 },
  { header: 'Статус', key: 'status_name', width: 22 },
  { header: 'Ответственный', key: 'responsible_name', width: 26 },
];

const DATASETS = {
  projects: { name: 'Проекты и соглашения', columns: async () => [...PROJECT_COLUMNS, ...(await cf.exportColumns('project'))], rows: projectRows },
  visits:   { name: 'Визиты', columns: async () => [...VISIT_COLUMNS, ...(await cf.exportColumns('visit'))], rows: visitRows },
  companies:{ name: 'Компании', columns: async () => COMPANY_COLUMNS, rows: (q) => allCompanies(q) },
  steps:    { name: 'Этапы дорожных карт', columns: async () => STEP_COLUMNS, rows: stepRows },
  uz_locations: { name: 'Проекты по регионам Узбекистана', columns: async () => UZ_LOCATION_COLUMNS, rows: uzLocationRows },
};

const fileTimestamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

router.get('/api/export/:dataset', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'report.export');
  const dataset = DATASETS[ctx.params.dataset];
  if (!dataset) throw notFound('Неизвестный набор данных для выгрузки');

  const format = ctx.query.format === 'csv' ? 'csv' : 'xlsx';
  const columns = await dataset.columns();
  const rows = await dataset.rows(ctx.query);

  await audit.record({
    user, action: 'export', entityType: ctx.params.dataset,
    summary: `Выгрузка «${dataset.name}» в формате ${format.toUpperCase()}: строк — ${rows.length}`, req: ctx.req,
  });

  const filename = `${ctx.params.dataset}-${fileTimestamp()}.${format}`;
  const body = format === 'csv' ? buildCsv(columns, rows) : buildWorkbook([{ name: dataset.name, columns, rows }]);
  sendBuffer(ctx.res, 200, body, {
    'Content-Type': format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  return undefined;
});

/** Сводный отчёт для руководства: несколько листов в одной книге. */
router.get('/api/export/report/portfolio', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'report.export');
  const projects = await projectRows(ctx.query);
  const rates = await getSetting('currency.rates_to_usd', { USD: 1 });
  const toUsd = (row) => (row.amount || 0) * (Number(rates[row.currency]) || 0);

  const summarize = (keyFn, labelFn) => {
    const map = new Map();
    for (const project of projects) {
      const key = keyFn(project);
      if (!map.has(key)) map.set(key, { label: labelFn(project), count: 0, amount_usd: 0, signed: 0 });
      const bucket = map.get(key);
      bucket.count += 1;
      bucket.amount_usd += toUsd(project);
      if (['agreement_signed', 'implementation', 'completed'].includes(project.status_code)) bucket.signed += 1;
    }
    return [...map.values()].map((row) => ({ ...row, amount_usd: Math.round(row.amount_usd) }));
  };

  const summaryColumns = [
    { header: 'Показатель', key: 'label', width: 34 },
    { header: 'Проектов', key: 'count', type: 'number', width: 14 },
    { header: 'Подписано', key: 'signed', type: 'number', width: 14 },
    { header: 'Сумма, USD', key: 'amount_usd', type: 'money', width: 20 },
  ];

  // Разрез по регионам Узбекистана: проект учитывается в каждом своём регионе
  const uzRows = (await all(
    `SELECT ur.name_ru AS label, COUNT(DISTINCT pl.project_id) AS count,
            COUNT(DISTINCT CASE WHEN p.status_code IN ('agreement_signed','implementation','completed')
                  THEN pl.project_id END) AS signed,
            COALESCE(SUM(pl.amount), 0) AS amount_usd,
            GROUP_CONCAT(DISTINCT pl.locality) AS localities
     FROM project_locations pl
     JOIN uz_regions ur ON ur.id = pl.uz_region_id
     JOIN projects p ON p.id = pl.project_id AND p.is_deleted = 0
     GROUP BY ur.id ORDER BY count DESC, ur.sort`
  )).map((row) => ({ ...row, amount_usd: Math.round(row.amount_usd), localities: (row.localities || '').split(',').join('; ') }));

  const workbook = buildWorkbook([
    { name: 'По регионам', columns: summaryColumns, rows: summarize((p) => p.region_code, (p) => p.region_name) },
    { name: 'По регионам Узбекистана', columns: [...summaryColumns, { header: 'Города и районы', key: 'localities', width: 40 }], rows: uzRows },
    { name: 'По отраслям', columns: summaryColumns, rows: summarize((p) => p.sector_code, (p) => p.sector_name) },
    { name: 'По статусам', columns: summaryColumns, rows: summarize((p) => p.status_code, (p) => p.status_name) },
    { name: 'По менеджерам', columns: summaryColumns, rows: summarize((p) => p.responsible_user_id, (p) => p.responsible_name) },
    { name: 'Реестр проектов', columns: [...PROJECT_COLUMNS, ...(await cf.exportColumns('project'))], rows: projects },
  ]);

  await audit.record({ user, action: 'export', entityType: 'report', summary: 'Выгрузка сводного отчёта по портфелю', req: ctx.req });
  sendBuffer(ctx.res, 200, workbook, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="portfolio-report-${fileTimestamp()}.xlsx"`,
  });
  return undefined;
});

/** Отчёт по эффективности проектных менеджеров. */
router.get('/api/export/report/managers', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'report.export');
  const rows = await all(
    `SELECT u.full_name, u.email, r.name_ru AS region_name,
            (SELECT COUNT(*) FROM projects p WHERE p.responsible_user_id = u.id AND p.is_deleted = 0) AS projects_total,
            (SELECT COUNT(*) FROM projects p WHERE p.responsible_user_id = u.id AND p.is_deleted = 0
               AND p.status_code IN ('agreement_signed','implementation','completed')) AS projects_signed,
            (SELECT COUNT(*) FROM roadmap_steps s WHERE s.responsible_user_id = u.id AND s.is_deleted = 0 AND s.state = 'done') AS steps_done,
            (SELECT COUNT(*) FROM roadmap_steps s WHERE s.responsible_user_id = u.id AND s.is_deleted = 0
               AND s.state = 'done' AND (s.due_date IS NULL OR date(s.done_at) <= s.due_date)) AS steps_on_time,
            (SELECT COUNT(*) FROM roadmap_steps s WHERE s.responsible_user_id = u.id AND s.is_deleted = 0
               AND s.state <> 'done' AND s.due_date IS NOT NULL AND s.due_date < date('now')) AS steps_overdue,
            (SELECT COUNT(*) FROM visits v WHERE v.responsible_user_id = u.id AND v.is_deleted = 0) AS visits_total
     FROM users u LEFT JOIN regions r ON r.id = u.region_id
     WHERE u.is_active = 1 AND u.role IN ('admin','team') ORDER BY projects_total DESC`
  );
  const workbook = buildWorkbook([{
    name: 'Работа менеджеров',
    columns: [
      { header: 'Сотрудник', key: 'full_name', width: 30 },
      { header: 'Регион', key: 'region_name', width: 24 },
      { header: 'Проектов', key: 'projects_total', type: 'number', width: 12 },
      { header: 'Подписано', key: 'projects_signed', type: 'number', width: 12 },
      { header: 'Этапов выполнено', key: 'steps_done', type: 'number', width: 18 },
      { header: 'В срок', key: 'steps_on_time', type: 'number', width: 12 },
      { header: 'Просрочено', key: 'steps_overdue', type: 'number', width: 14 },
      { header: 'Визитов', key: 'visits_total', type: 'number', width: 12 },
    ],
    rows,
  }]);
  await audit.record({ user, action: 'export', entityType: 'report', summary: 'Выгрузка отчёта по работе менеджеров', req: ctx.req });
  sendBuffer(ctx.res, 200, workbook, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="managers-report-${fileTimestamp()}.xlsx"`,
  });
  return undefined;
});

// -------------------------------------------------------------------------
// Календарь (п. 8.2 ТЗ)
// -------------------------------------------------------------------------
async function calendarEvents(query = {}) {
  const from = query.from || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to = query.to || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const managerFilter = query.responsible_id ? Number(query.responsible_id) : null;

  const steps = (await all(
    `SELECT s.id, s.title, s.due_date, s.state, s.project_id, p.code, p.title AS project_title,
            u.full_name AS responsible_name, s.responsible_user_id
     FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.responsible_user_id
     WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.due_date BETWEEN ? AND ?
       ${managerFilter ? 'AND s.responsible_user_id = ?' : ''}`,
    ...(managerFilter ? [from, to, managerFilter] : [from, to])
  )).map((step) => ({
    type: 'deadline',
    id: `step-${step.id}`,
    title: step.title,
    subtitle: `${step.code} — ${step.project_title}`,
    date: step.due_date,
    end: step.due_date,
    link: `/#/projects/${step.project_id}`,
    responsible: step.responsible_name,
    state: step.state,
    color: step.state === 'done' ? '#2e7d4f' : step.due_date < new Date().toISOString().slice(0, 10) ? '#a33a3a' : '#1f4e9e',
  }));

  const visits = (await all(
    `SELECT v.id, v.code, v.cities, v.date_from, v.date_to, v.direction, v.status_code,
            co.name_ru AS country_name, u.full_name AS responsible_name, v.responsible_user_id
     FROM visits v JOIN countries co ON co.id = v.country_id
     LEFT JOIN users u ON u.id = v.responsible_user_id
     WHERE v.is_deleted = 0 AND v.date_to >= ? AND v.date_from <= ?
       ${managerFilter ? 'AND v.responsible_user_id = ?' : ''}`,
    ...(managerFilter ? [from, to, managerFilter] : [from, to])
  )).map((visit) => ({
    type: 'visit',
    id: `visit-${visit.id}`,
    title: `${visit.direction === 'outbound' ? 'Визит' : 'Приём делегации'}: ${visit.country_name}`,
    subtitle: `${visit.code} — ${visit.cities}`,
    date: visit.date_from,
    end: visit.date_to,
    link: `/#/visits/${visit.id}`,
    responsible: visit.responsible_name,
    color: '#8a5cf0',
  }));

  const meetings = (await all(
    `SELECT m.id, m.company_name, m.meet_date, m.meet_time, m.venue, m.status_code, m.visit_id,
            v.code AS visit_code, v.responsible_user_id, u.full_name AS responsible_name
     FROM meetings m JOIN visits v ON v.id = m.visit_id
     LEFT JOIN users u ON u.id = v.responsible_user_id
     WHERE m.is_deleted = 0 AND v.is_deleted = 0 AND m.meet_date BETWEEN ? AND ?
       ${managerFilter ? 'AND v.responsible_user_id = ?' : ''}`,
    ...(managerFilter ? [from, to, managerFilter] : [from, to])
  )).map((meeting) => ({
    type: 'meeting',
    id: `meeting-${meeting.id}`,
    title: `Встреча: ${meeting.company_name}`,
    subtitle: `${meeting.visit_code}${meeting.meet_time ? `, ${meeting.meet_time}` : ''}${meeting.venue ? `, ${meeting.venue}` : ''}`,
    date: meeting.meet_date,
    end: meeting.meet_date,
    time: meeting.meet_time,
    link: `/#/visits/${meeting.visit_id}`,
    responsible: meeting.responsible_name,
    color: meeting.status_code === 'tbc' ? '#b3661a' : '#0f8a6a',
  }));

  return [...steps, ...visits, ...meetings].sort((a, b) => a.date.localeCompare(b.date));
}

router.get('/api/calendar', async (ctx) => {
  ctx.requireUser();
  return { events: await calendarEvents(ctx.query) };
});

/** Лента iCal для подписки из Outlook / Google Calendar. */
router.get('/api/calendar.ics', async (ctx) => {
  const user = ctx.requireUser();
  const events = await calendarEvents(ctx.query);
  const ics = buildCalendar(
    events.map((event) => ({
      uid: event.id,
      summary: event.title,
      description: `${event.subtitle}\nОтветственный: ${event.responsible || '—'}\n${config.publicUrl}${event.link}`,
      location: event.subtitle,
      start: `${event.date}T00:00:00Z`,
      end: `${event.end || event.date}T00:00:00Z`,
      allDay: true,
      url: `${config.publicUrl}${event.link}`,
      categories: event.type,
    })),
    `Проектный офис — ${user.full_name}`
  );
  await audit.record({ user, action: 'export', entityType: 'calendar', summary: 'Выгрузка календаря в формате iCal', req: ctx.req });
  sendBuffer(ctx.res, 200, Buffer.from(ics, 'utf8'), {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="project-office.ics"',
  });
  return undefined;
});

module.exports = router;

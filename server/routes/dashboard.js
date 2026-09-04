'use strict';
/** Дашборд и аналитика (раздел 6 ТЗ). */
const { Router } = require('../lib/http');
const { all, get, getSetting } = require('../db');
const { buildProjectFilters } = require('../queries');

const router = new Router();

/** Пересчёт сумм в доллары США по курсам из настроек. */
function toUsd(amount, currency, rates) {
  if (!amount) return 0;
  return amount * (Number(rates[currency]) || 0);
}

router.get('/api/dashboard', async (ctx) => {
  const user = ctx.requireUser();

  // Менеджер по умолчанию видит свой регион, администратор — весь офис (п. 6 ТЗ).
  const query = { ...ctx.query };
  if (query.scope === 'mine') query.responsible_id = user.id;
  if (query.scope === 'my_region' && user.region_id) {
    query.region_id = user.region_id;
    delete query.scope;
  }
  const { where, params } = await buildProjectFilters(query);
  const rates = await getSetting('currency.rates_to_usd', { USD: 1 });

  const baseFrom = `
    FROM projects p
    JOIN companies c  ON c.id = p.company_id
    JOIN countries co ON co.id = p.country_id
    JOIN regions r    ON r.id = co.region_id
    JOIN users u      ON u.id = p.responsible_user_id
    LEFT JOIN dictionaries ds ON ds.kind = 'project_status' AND ds.code = p.status_code
    WHERE ${where}`;

  const projects = await all(
    `SELECT p.id, p.amount, p.currency, p.area, p.sector_code, p.status_code, p.created_at,
            p.responsible_user_id, co.iso2, co.name_ru AS country_name, r.code AS region_code,
            r.name_ru AS region_name, u.full_name AS responsible_name ${baseFrom}`,
    ...params
  );

  const sum = (list) => list.reduce((acc, p) => acc + toUsd(p.amount, p.currency, rates), 0);
  const groupBy = (list, keyFn, labelFn) => {
    const map = new Map();
    for (const item of list) {
      const key = keyFn(item);
      if (key === null || key === undefined) continue;
      if (!map.has(key)) map.set(key, { key, label: labelFn(item), count: 0, amount_usd: 0 });
      const bucket = map.get(key);
      bucket.count += 1;
      bucket.amount_usd += toUsd(item.amount, item.currency, rates);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  };

  const statusDict = await all("SELECT code, name_ru, color, sort FROM dictionaries WHERE kind = 'project_status' ORDER BY sort");
  const sectorDict = await all("SELECT code, name_ru, color FROM dictionaries WHERE kind = 'sector'");

  const active = projects.filter((p) => !['completed', 'cancelled'].includes(p.status_code));
  const signedCodes = ['agreement_signed', 'implementation', 'completed'];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const quarterStart = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  })();

  const signedThis = async (since) =>
    (await get(
      `SELECT COUNT(*) AS n FROM project_status_history h JOIN projects p ON p.id = h.project_id
       WHERE p.is_deleted = 0 AND h.to_status IN ('agreement_signed','mou_signed') AND date(h.created_at) >= ?`,
      since
    ))?.n ?? 0;

  // Панель внимания (п. 6 ТЗ)
  const staleDays = Number(await getSetting('projects.stale_days', 30));
  const tbcDays = Number(await getSetting('attention.meeting_tbc_days', 7));

  const overdueSteps = await all(
    `SELECT s.id, s.title, s.due_date, s.project_id, p.code, p.title AS project_title,
            u.full_name AS responsible_name, current_date - CAST(s.due_date AS date) AS days_late
     FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.responsible_user_id
     WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.state <> 'done'
       AND s.due_date IS NOT NULL AND s.due_date < date('now')
     ORDER BY s.due_date LIMIT 50`
  );

  const dueSoonSteps = await all(
    `SELECT s.id, s.title, s.due_date, s.project_id, p.code, p.title AS project_title, u.full_name AS responsible_name
     FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.responsible_user_id
     WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.state <> 'done'
       AND s.due_date BETWEEN date('now') AND date('now', '+7 day')
     ORDER BY s.due_date LIMIT 50`
  );

  const staleProjects = await all(
    `SELECT p.id, p.code, p.title, p.last_activity_at, u.full_name AS responsible_name
     FROM projects p LEFT JOIN users u ON u.id = p.responsible_user_id
     WHERE p.is_deleted = 0 AND p.status_code NOT IN ('completed','cancelled')
       AND p.last_activity_at < datetime('now', '-${staleDays} day')
     ORDER BY p.last_activity_at LIMIT 50`
  );

  const tbcMeetings = await all(
    `SELECT m.id, m.company_name, m.meet_date, m.visit_id, v.code AS visit_code, v.date_from,
            co.name_ru AS country_name
     FROM meetings m JOIN visits v ON v.id = m.visit_id
     LEFT JOIN countries co ON co.id = v.country_id
     WHERE m.is_deleted = 0 AND v.is_deleted = 0 AND m.status_code = 'tbc'
       AND v.date_from BETWEEN date('now') AND date('now', '+${tbcDays} day')
     ORDER BY v.date_from LIMIT 50`
  );

  const upcomingVisits = await all(
    `SELECT v.id, v.code, v.direction, v.date_from, v.date_to, v.cities, co.name_ru AS country_name,
            u.full_name AS responsible_name, d.name_ru AS status_name, d.color AS status_color
     FROM visits v JOIN countries co ON co.id = v.country_id
     LEFT JOIN users u ON u.id = v.responsible_user_id
     LEFT JOIN dictionaries d ON d.kind = 'visit_status' AND d.code = v.status_code
     WHERE v.is_deleted = 0 AND v.date_to >= date('now') AND v.status_code NOT IN ('cancelled')
     ORDER BY v.date_from LIMIT 10`
  );

  // --- Разрез по регионам Узбекистана (дополнение № 1 к ТЗ) ---
  // Проект с площадками в нескольких регионах учитывается в каждом из них,
  // поэтому сумма по регионам может превышать общее число проектов.
  const projectIds = projects.map((p) => p.id);
  const placeholders = projectIds.length ? projectIds.map(() => '?').join(',') : 'NULL';
  const locationRows = projectIds.length
    ? await all(
        `SELECT pl.project_id, pl.locality, pl.amount, ur.code, ur.name_ru
         FROM project_locations pl JOIN uz_regions ur ON ur.id = pl.uz_region_id
         WHERE pl.project_id IN (${placeholders}) ORDER BY ur.sort`,
        ...projectIds
      )
    : [];

  const uzMap = new Map();
  const projectsWithLocation = new Set();
  for (const row of locationRows) {
    projectsWithLocation.add(row.project_id);
    if (!uzMap.has(row.code)) {
      uzMap.set(row.code, { key: row.code, label: row.name_ru, count: 0, amount_usd: 0, localities: [] });
    }
    const bucket = uzMap.get(row.code);
    bucket.count += 1;
    // Решение Р-1: в разрез попадает только объём, заданный по этому региону
    const project = projects.find((p) => p.id === row.project_id);
    if (row.amount && project) bucket.amount_usd += toUsd(row.amount, project.currency, rates);
    if (row.locality && !bucket.localities.includes(row.locality)) bucket.localities.push(row.locality);
  }

  const investmentProjects = projects.filter((p) => p.area === 'investment');
  const withoutLocation = investmentProjects.filter((p) => !projectsWithLocation.has(p.id));

  // Объём, не отнесённый ни к одному региону (решение Р-1)
  const allocatedByProject = new Map();
  for (const row of locationRows) {
    if (!row.amount) continue;
    allocatedByProject.set(row.project_id, (allocatedByProject.get(row.project_id) || 0) + row.amount);
  }
  let unallocatedUsd = 0;
  for (const project of investmentProjects) {
    const allocated = allocatedByProject.get(project.id) || 0;
    const rest = Math.max((project.amount || 0) - allocated, 0);
    unallocatedUsd += toUsd(rest, project.currency, rates);
  }

  const byUzRegion = [...uzMap.values()]
    .map((r) => ({ ...r, amount_usd: Math.round(r.amount_usd) }))
    .sort((a, b) => b.count - a.count || b.amount_usd - a.amount_usd);

  // Динамика по месяцам за 12 месяцев
  const dynamics = await all(
    `SELECT left(p.created_at, 7) AS month, COUNT(*) AS count,
            SUM(CASE WHEN p.currency = 'USD' THEN COALESCE(p.amount,0) ELSE 0 END) AS amount_usd
     ${baseFrom} AND p.created_at >= datetime('now', '-12 month')
     GROUP BY left(p.created_at, 7) ORDER BY month`,
    ...params
  );

  return {
    scope: query.scope || 'all',
    kpi: {
      projects_total: projects.length,
      projects_active: active.length,
      amount_total_usd: Math.round(sum(projects)),
      amount_export_usd: Math.round(sum(projects.filter((p) => p.area === 'export'))),
      amount_investment_usd: Math.round(sum(projects.filter((p) => p.area === 'investment'))),
      signed_quarter: await signedThis(quarterStart),
      signed_year: await signedThis(yearStart),
      upcoming_visits: upcomingVisits.length,
      companies_total: (await get('SELECT COUNT(*) AS n FROM companies WHERE is_deleted = 0'))?.n ?? 0,
      overdue_steps: overdueSteps.length,
    },
    by_status: statusDict.map((status) => {
      const bucket = projects.filter((p) => p.status_code === status.code);
      return { code: status.code, label: status.name_ru, color: status.color, count: bucket.length, amount_usd: Math.round(sum(bucket)) };
    }),
    by_sector: sectorDict.map((sector) => {
      const bucket = projects.filter((p) => p.sector_code === sector.code);
      return { code: sector.code, label: sector.name_ru, color: sector.color, count: bucket.length, amount_usd: Math.round(sum(bucket)) };
    }),
    by_area: ['export', 'investment'].map((area) => {
      const bucket = projects.filter((p) => p.area === area);
      return { code: area, label: area === 'export' ? 'Экспорт' : 'Инвестиции', count: bucket.length, amount_usd: Math.round(sum(bucket)) };
    }),
    by_region: groupBy(projects, (p) => p.region_code, (p) => p.region_name).map((r) => ({ ...r, amount_usd: Math.round(r.amount_usd) })),
    by_country: groupBy(projects, (p) => p.iso2, (p) => p.country_name).map((r) => ({ ...r, amount_usd: Math.round(r.amount_usd) })),
    by_manager: groupBy(projects, (p) => p.responsible_user_id, (p) => p.responsible_name).map((r) => ({ ...r, amount_usd: Math.round(r.amount_usd) })),
    by_uz_region: byUzRegion,
    uz_summary: {
      regions_total: (await get('SELECT COUNT(*) AS n FROM uz_regions WHERE is_active = 1'))?.n ?? 0,
      regions_covered: byUzRegion.length,
      investment_total: investmentProjects.length,
      without_location: withoutLocation.length,
      unallocated_usd: Math.round(unallocatedUsd),
    },
    dynamics,
    attention: {
      overdue_steps: overdueSteps,
      due_soon_steps: dueSoonSteps,
      stale_projects: staleProjects,
      tbc_meetings: tbcMeetings,
      stale_days: staleDays,
      tbc_days: tbcDays,
    },
    upcoming_visits: upcomingVisits,
  };
});

/** Показатели работы проектных менеджеров (п. 8.1 ТЗ). */
router.get('/api/dashboard/managers', async (ctx) => {
  ctx.requireUser();
  return await all(
    `SELECT u.id, u.full_name, u.email, r.name_ru AS region_name,
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
     WHERE u.is_active = 1 AND u.role IN ('admin','team')
     ORDER BY projects_total DESC, u.full_name`
  );
});

module.exports = router;

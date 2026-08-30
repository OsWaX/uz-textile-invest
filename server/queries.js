'use strict';
/** Построители выборок с фильтрами — используются списками, дашбордом и выгрузками. */
const { all, get, getSetting } = require('./db');

const PROJECT_SELECT = `
  SELECT p.*,
         c.name        AS company_name,
         co.name_ru    AS country_name,
         co.iso2       AS country_iso2,
         r.code        AS region_code,
         r.name_ru     AS region_name,
         u.full_name   AS responsible_name,
         cb.full_name  AS created_by_name,
         ds.name_ru    AS status_name, ds.color AS status_color,
         dsec.name_ru  AS sector_name, dsec.color AS sector_color,
         dtype.name_ru AS record_type_name,
         (SELECT COUNT(*) FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0) AS steps_total,
         (SELECT COUNT(*) FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0 AND s.state = 'done') AS steps_done,
         (SELECT COUNT(*) FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0
            AND s.state <> 'done' AND s.due_date IS NOT NULL AND s.due_date < date('now')) AS steps_overdue,
         (SELECT MIN(s.due_date) FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0 AND s.state <> 'done') AS next_due_date,
         (SELECT s.title FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0 AND s.state <> 'done'
            ORDER BY s.due_date IS NULL, s.due_date, s.seq LIMIT 1) AS next_step_title,
         (SELECT COUNT(*) FROM project_partners pp WHERE pp.project_id = p.id) AS partners_count,
         (SELECT GROUP_CONCAT(pc.name, '; ') FROM project_partners pp
            JOIN companies pc ON pc.id = pp.company_id WHERE pp.project_id = p.id) AS partner_names,
         (SELECT COUNT(*) FROM project_locations pl WHERE pl.project_id = p.id) AS locations_count,
         (SELECT GROUP_CONCAT(ur.name_ru, '; ') FROM project_locations pl
            JOIN uz_regions ur ON ur.id = pl.uz_region_id WHERE pl.project_id = p.id) AS uz_region_names,
         (SELECT GROUP_CONCAT(pl.locality, '; ') FROM project_locations pl
            WHERE pl.project_id = p.id) AS locality_names
  FROM projects p
  JOIN companies c   ON c.id = p.company_id
  JOIN countries co  ON co.id = p.country_id
  JOIN regions r     ON r.id = co.region_id
  JOIN users u       ON u.id = p.responsible_user_id
  LEFT JOIN users cb ON cb.id = p.created_by
  LEFT JOIN dictionaries ds    ON ds.kind = 'project_status' AND ds.code = p.status_code
  LEFT JOIN dictionaries dsec  ON dsec.kind = 'sector' AND dsec.code = p.sector_code
  LEFT JOIN dictionaries dtype ON dtype.kind = 'record_type' AND dtype.code = p.record_type
`;

const PROJECT_SORTS = {
  updated_at: 'p.updated_at', created_at: 'p.created_at', title: 'p.title',
  amount: 'p.amount', status: 'ds.sort', country: 'co.name_ru', company: 'c.name',
  responsible: 'u.full_name', next_due_date: 'next_due_date', code: 'p.code',
};

function buildProjectFilters(query = {}) {
  const where = ['p.is_deleted = 0'];
  const params = [];
  const push = (clause, ...values) => { where.push(clause); params.push(...values); };

  if (query.status) push('p.status_code IN (' + splitList(query.status).map(() => '?').join(',') + ')', ...splitList(query.status));
  if (query.sector) push('p.sector_code IN (' + splitList(query.sector).map(() => '?').join(',') + ')', ...splitList(query.sector));
  if (query.area) push('p.area = ?', query.area);
  if (query.record_type) push('p.record_type = ?', query.record_type);
  if (query.country_id) push('p.country_id = ?', Number(query.country_id));
  if (query.region) push('r.code = ?', query.region);
  if (query.region_id) push('r.id = ?', Number(query.region_id));
  if (query.company_id) push('p.company_id = ?', Number(query.company_id));
  // Местный партнёр (дополнение № 1 к ТЗ)
  if (query.partner_company_id) {
    push('EXISTS (SELECT 1 FROM project_partners pp WHERE pp.project_id = p.id AND pp.company_id = ?)',
      Number(query.partner_company_id));
  }
  // Регион Узбекистана — допускается несколько кодов через запятую
  if (query.uz_region) {
    const codes = splitList(query.uz_region);
    push(
      `EXISTS (SELECT 1 FROM project_locations pl JOIN uz_regions ur ON ur.id = pl.uz_region_id
               WHERE pl.project_id = p.id AND ur.code IN (${codes.map(() => '?').join(',')}))`,
      ...codes
    );
  }
  // Инвестиционные проекты без указанной площадки реализации
  if (query.no_uz_region === '1' || query.no_uz_region === true) {
    push("p.area = 'investment' AND NOT EXISTS (SELECT 1 FROM project_locations pl WHERE pl.project_id = p.id)");
  }
  if (query.responsible_id) push('p.responsible_user_id = ?', Number(query.responsible_id));
  if (query.date_from) push('date(p.created_at) >= ?', query.date_from);
  if (query.date_to) push('date(p.created_at) <= ?', query.date_to);
  if (query.amount_min) push('COALESCE(p.amount, 0) >= ?', Number(query.amount_min));
  if (query.amount_max) push('COALESCE(p.amount, 0) <= ?', Number(query.amount_max));

  if (query.overdue === '1' || query.overdue === true) {
    push(`EXISTS (SELECT 1 FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0
            AND s.state <> 'done' AND s.due_date IS NOT NULL AND s.due_date < date('now'))`);
  }
  if (query.due_soon === '1' || query.due_soon === true) {
    push(`EXISTS (SELECT 1 FROM roadmap_steps s WHERE s.project_id = p.id AND s.is_deleted = 0
            AND s.state <> 'done' AND s.due_date BETWEEN date('now') AND date('now', '+7 day'))`);
  }
  if (query.stale === '1' || query.stale === true) {
    const staleDays = Number(getSetting('projects.stale_days', 30));
    push(`p.last_activity_at < datetime('now', '-${staleDays} day') AND p.status_code NOT IN ('completed','cancelled')`);
  }
  if (query.search) {
    const like = `%${String(query.search).trim()}%`;
    push(
      `(p.title LIKE ? OR p.code LIKE ? OR p.description LIKE ? OR c.name LIKE ?
        OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.entity_type = 'project' AND ct.entity_id = p.id
                   AND (ct.full_name LIKE ? OR ct.email LIKE ?))
        OR EXISTS (SELECT 1 FROM comments cm WHERE cm.entity_type = 'project' AND cm.entity_id = p.id AND cm.body LIKE ?)
        OR EXISTS (SELECT 1 FROM project_partners pp JOIN companies pc ON pc.id = pp.company_id
                   WHERE pp.project_id = p.id AND pc.name LIKE ?)
        OR EXISTS (SELECT 1 FROM project_locations pl JOIN uz_regions ur ON ur.id = pl.uz_region_id
                   WHERE pl.project_id = p.id AND (pl.locality LIKE ? OR ur.name_ru LIKE ?)))`,
      like, like, like, like, like, like, like, like, like, like
    );
  }
  return { where: where.join(' AND '), params };
}

/** Местные партнёры проекта (P-16). */
const partnersOf = (projectId) =>
  all(
    `SELECT pp.id, pp.company_id, pp.role_note, c.name AS company_name, c.city,
            co.name_ru AS country_name
     FROM project_partners pp
     JOIN companies c ON c.id = pp.company_id
     LEFT JOIN countries co ON co.id = c.country_id
     WHERE pp.project_id = ? ORDER BY pp.id`,
    projectId
  );

/** Регионы реализации проекта (P-17). */
const locationsOf = (projectId) =>
  all(
    `SELECT pl.id, pl.uz_region_id, pl.locality, pl.amount,
            ur.code AS region_code, ur.name_ru AS region_name
     FROM project_locations pl
     JOIN uz_regions ur ON ur.id = pl.uz_region_id
     WHERE pl.project_id = ? ORDER BY ur.sort`,
    projectId
  );

const splitList = (value) => String(value).split(',').map((s) => s.trim()).filter(Boolean);

function listProjects(query = {}) {
  const { where, params } = buildProjectFilters(query);
  const sortKey = PROJECT_SORTS[query.sort] || PROJECT_SORTS.updated_at;
  const direction = String(query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Number(query.offset) || 0;

  const rows = all(
    `${PROJECT_SELECT} WHERE ${where} ORDER BY ${sortKey} ${direction} LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  const total = get(
    `SELECT COUNT(*) AS n FROM projects p
     JOIN companies c ON c.id = p.company_id
     JOIN countries co ON co.id = p.country_id
     JOIN regions r ON r.id = co.region_id
     JOIN users u ON u.id = p.responsible_user_id
     LEFT JOIN dictionaries ds ON ds.kind = 'project_status' AND ds.code = p.status_code
     WHERE ${where}`,
    ...params
  )?.n ?? 0;

  return { rows: rows.map(decorateProject), total, limit, offset };
}

/** Все проекты по фильтру без постраничной разбивки — для выгрузок. */
function allProjects(query = {}) {
  const { where, params } = buildProjectFilters(query);
  const sortKey = PROJECT_SORTS[query.sort] || PROJECT_SORTS.updated_at;
  const direction = String(query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return all(`${PROJECT_SELECT} WHERE ${where} ORDER BY ${sortKey} ${direction} LIMIT 20000`, ...params)
    .map(decorateProject);
}

function decorateProject(row) {
  const staleDays = Number(getSetting('projects.stale_days', 30));
  const lastActivity = new Date(`${String(row.last_activity_at).replace(' ', 'T')}Z`).getTime();
  return {
    ...row,
    is_overdue: row.steps_overdue > 0,
    is_stale:
      !['completed', 'cancelled'].includes(row.status_code) &&
      Number.isFinite(lastActivity) && Date.now() - lastActivity > staleDays * 86400000,
    progress: row.steps_total ? Math.round((row.steps_done / row.steps_total) * 100) : 0,
    partners: partnersOf(row.id),
    locations: locationsOf(row.id),
  };
}

const VISIT_SELECT = `
  SELECT v.*, co.name_ru AS country_name, co.iso2 AS country_iso2,
         r.code AS region_code, r.name_ru AS region_name,
         u.full_name AS responsible_name,
         d.name_ru AS status_name, d.color AS status_color,
         (SELECT COUNT(*) FROM meetings m WHERE m.visit_id = v.id AND m.is_deleted = 0) AS meetings_total,
         (SELECT COUNT(*) FROM meetings m WHERE m.visit_id = v.id AND m.is_deleted = 0 AND m.status_code = 'tbc') AS meetings_tbc,
         (SELECT COUNT(*) FROM visit_members vm WHERE vm.visit_id = v.id) AS members_total
  FROM visits v
  JOIN countries co ON co.id = v.country_id
  JOIN regions r    ON r.id = co.region_id
  JOIN users u      ON u.id = v.responsible_user_id
  LEFT JOIN dictionaries d ON d.kind = 'visit_status' AND d.code = v.status_code
`;

function buildVisitFilters(query = {}) {
  const where = ['v.is_deleted = 0'];
  const params = [];
  const push = (clause, ...values) => { where.push(clause); params.push(...values); };

  if (query.status) push(`v.status_code IN (${splitList(query.status).map(() => '?').join(',')})`, ...splitList(query.status));
  if (query.direction) push('v.direction = ?', query.direction);
  if (query.country_id) push('v.country_id = ?', Number(query.country_id));
  if (query.region) push('r.code = ?', query.region);
  if (query.responsible_id) push('v.responsible_user_id = ?', Number(query.responsible_id));
  if (query.date_from) push('v.date_to >= ?', query.date_from);
  if (query.date_to) push('v.date_from <= ?', query.date_to);
  if (query.upcoming === '1') push("v.date_from >= date('now')");
  if (query.search) {
    const like = `%${String(query.search).trim()}%`;
    push('(v.goal LIKE ? OR v.code LIKE ? OR v.cities LIKE ? OR co.name_ru LIKE ?)', like, like, like, like);
  }
  return { where: where.join(' AND '), params };
}

function listVisits(query = {}) {
  const { where, params } = buildVisitFilters(query);
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Number(query.offset) || 0;
  const direction = String(query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`${VISIT_SELECT} WHERE ${where} ORDER BY v.date_from ${direction} LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = get(
    `SELECT COUNT(*) AS n FROM visits v JOIN countries co ON co.id = v.country_id
     JOIN regions r ON r.id = co.region_id JOIN users u ON u.id = v.responsible_user_id WHERE ${where}`,
    ...params
  )?.n ?? 0;
  return { rows, total, limit, offset };
}

const allVisits = (query = {}) => {
  const { where, params } = buildVisitFilters(query);
  return all(`${VISIT_SELECT} WHERE ${where} ORDER BY v.date_from DESC LIMIT 20000`, ...params);
};

const COMPANY_SELECT = `
  SELECT c.*, co.name_ru AS country_name, co.iso2 AS country_iso2,
         r.name_ru AS region_name, r.code AS region_code,
         u.full_name AS responsible_name,
         (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id AND p.is_deleted = 0) AS projects_count,
         (SELECT COALESCE(SUM(p.amount), 0) FROM projects p WHERE p.company_id = c.id AND p.is_deleted = 0 AND p.currency = 'USD') AS amount_usd,
         (SELECT COUNT(*) FROM meetings m WHERE m.company_id = c.id AND m.is_deleted = 0) AS meetings_count
  FROM companies c
  LEFT JOIN countries co ON co.id = c.country_id
  LEFT JOIN regions r    ON r.id = co.region_id
  LEFT JOIN users u      ON u.id = c.responsible_user_id
`;

function listCompanies(query = {}) {
  const where = ['c.is_deleted = 0', 'c.merged_into_id IS NULL'];
  const params = [];
  if (query.country_id) { where.push('c.country_id = ?'); params.push(Number(query.country_id)); }
  if (query.region) { where.push('r.code = ?'); params.push(query.region); }
  if (query.responsible_id) { where.push('c.responsible_user_id = ?'); params.push(Number(query.responsible_id)); }
  if (query.search) {
    const like = `%${String(query.search).trim()}%`;
    where.push(`(c.name LIKE ? OR c.industry LIKE ? OR c.profile LIKE ? OR c.city LIKE ?
      OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.entity_type = 'company' AND ct.entity_id = c.id AND ct.full_name LIKE ?))`);
    params.push(like, like, like, like, like);
  }
  const clause = where.join(' AND ');
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Number(query.offset) || 0;
  const rows = all(`${COMPANY_SELECT} WHERE ${clause} ORDER BY c.name LIMIT ? OFFSET ?`, ...params, limit, offset);
  const total = get(
    `SELECT COUNT(*) AS n FROM companies c LEFT JOIN countries co ON co.id = c.country_id
     LEFT JOIN regions r ON r.id = co.region_id WHERE ${clause}`,
    ...params
  )?.n ?? 0;
  return { rows, total, limit, offset };
};

const allCompanies = (query = {}) => listCompanies({ ...query, limit: 5000 }).rows;

module.exports = {
  PROJECT_SELECT, VISIT_SELECT, COMPANY_SELECT, partnersOf, locationsOf,
  listProjects, allProjects, buildProjectFilters, decorateProject,
  listVisits, allVisits, buildVisitFilters,
  listCompanies, allCompanies,
};

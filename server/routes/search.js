'use strict';
/** Глобальный поиск по проектам, компаниям, контактам и визитам (раздел 10 ТЗ). */
const { Router } = require('../lib/http');
const { all } = require('../db');

const router = new Router();

router.get('/api/search', async (ctx) => {
  ctx.requireUser();
  const term = String(ctx.query.q || '').trim();
  if (term.length < 2) return { projects: [], companies: [], visits: [], contacts: [] };
  const like = `%${term}%`;

  return {
    projects: all(
      `SELECT p.id, p.code, p.title, c.name AS company_name, co.name_ru AS country_name,
              d.name_ru AS status_name, d.color AS status_color
       FROM projects p JOIN companies c ON c.id = p.company_id
       JOIN countries co ON co.id = p.country_id
       LEFT JOIN dictionaries d ON d.kind = 'project_status' AND d.code = p.status_code
       WHERE p.is_deleted = 0 AND (p.title LIKE ? OR p.code LIKE ? OR p.description LIKE ?)
       ORDER BY p.updated_at DESC LIMIT 10`,
      like, like, like
    ),
    companies: all(
      `SELECT c.id, c.name, c.city, co.name_ru AS country_name,
              (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id AND p.is_deleted = 0) AS projects_count
       FROM companies c LEFT JOIN countries co ON co.id = c.country_id
       WHERE c.is_deleted = 0 AND (c.name LIKE ? OR c.industry LIKE ? OR c.city LIKE ?)
       ORDER BY c.name LIMIT 10`,
      like, like, like
    ),
    visits: all(
      `SELECT v.id, v.code, v.goal, v.date_from, v.date_to, v.cities, co.name_ru AS country_name
       FROM visits v JOIN countries co ON co.id = v.country_id
       WHERE v.is_deleted = 0 AND (v.goal LIKE ? OR v.code LIKE ? OR v.cities LIKE ? OR co.name_ru LIKE ?)
       ORDER BY v.date_from DESC LIMIT 10`,
      like, like, like, like
    ),
    contacts: all(
      `SELECT ct.id, ct.full_name, ct.position, ct.phone, ct.email, ct.entity_type, ct.entity_id,
              CASE ct.entity_type WHEN 'company' THEN (SELECT name FROM companies WHERE id = ct.entity_id)
                                  ELSE (SELECT title FROM projects WHERE id = ct.entity_id) END AS parent_name
       FROM contacts ct
       WHERE ct.full_name LIKE ? OR ct.email LIKE ? OR ct.phone LIKE ?
       ORDER BY ct.full_name LIMIT 10`,
      like, like, like
    ),
  };
});

module.exports = router;

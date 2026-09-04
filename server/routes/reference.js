'use strict';
/** Справочные данные для интерфейса: регионы, страны, справочники, пользователи, сохранённые фильтры. */
const { Router, notFound, badRequest } = require('../lib/http');
const { all, get, run, getSetting } = require('../db');
const reference = require('../reference');
const cf = require('../customfields');
const v = require('../lib/validate');

const router = new Router();

router.get('/api/reference', async (ctx) => {
  ctx.requireUser();
  return {
    regions: await reference.listRegions(),
    uz_regions: await reference.listUzRegions(),
    countries: await reference.listCountries(),
    sectors: await reference.listDictionary('sector'),
    record_types: await reference.listDictionary('record_type'),
    project_statuses: await reference.listDictionary('project_status'),
    visit_statuses: await reference.listDictionary('visit_status'),
    meeting_statuses: await reference.listDictionary('meeting_status'),
    currencies: await reference.listDictionary('currency'),
    // Краткий список организаций для выбора местных партнёров: узбекские — первыми
    companies_brief: (await all(
      `SELECT c.id, c.name, co.name_ru AS country_name, (co.iso2 = 'UZ') AS uz
       FROM companies c LEFT JOIN countries co ON co.id = c.country_id
       WHERE c.is_deleted = 0 AND c.merged_into_id IS NULL
       ORDER BY (co.iso2 = 'UZ') DESC, c.name`
    )).map((row) => ({ ...row, uz: Boolean(row.uz) })),
    users: await all(
      `SELECT u.id, u.full_name, u.email, u.role, u.region_id, u.position, r.name_ru AS region_name
       FROM users u LEFT JOIN regions r ON r.id = u.region_id
       WHERE u.is_active = 1 ORDER BY u.role, u.full_name`
    ),
    custom_fields: {
      project: await cf.listFields('project'),
      visit: await cf.listFields('visit'),
      company: await cf.listFields('company'),
    },
    settings: {
      stale_days: await getSetting('projects.stale_days', 30),
      locations_for_export: Boolean(await getSetting('projects.locations_for_export', false)),
      org_name: await getSetting('org.name', ''),
      ministry: await getSetting('org.ministry', ''),
      rates: await getSetting('currency.rates_to_usd', { USD: 1 }),
    },
  };
});

router.get('/api/saved-filters', async (ctx) => {
  const user = ctx.requireUser();
  return (await all(
    `SELECT * FROM saved_filters WHERE (user_id = ? OR is_shared = 1) ${ctx.query.entity ? 'AND entity = ?' : ''}
     ORDER BY name`,
    ...(ctx.query.entity ? [user.id, ctx.query.entity] : [user.id])
  )).map((row) => ({ ...row, query: JSON.parse(row.query_json || '{}') }));
});

router.post('/api/saved-filters', async (ctx) => {
  const user = ctx.requireUser();
  const name = v.str(ctx.body.name, 'Название фильтра', { required: true, max: 120 });
  const entity = v.oneOf(ctx.body.entity, 'Раздел', ['projects', 'visits', 'companies']);
  const result = await run(
    'INSERT INTO saved_filters (user_id, entity, name, query_json, is_shared) VALUES (?, ?, ?, ?, ?)',
    user.id, entity, name, JSON.stringify(ctx.body.query || {}),
    v.bool(ctx.body.is_shared) && user.role === 'admin' ? 1 : 0
  );
  return await get('SELECT * FROM saved_filters WHERE id = ?', Number(result.lastInsertRowid));
});

router.delete('/api/saved-filters/:id', async (ctx) => {
  const user = ctx.requireUser();
  const row = await get('SELECT * FROM saved_filters WHERE id = ?', Number(ctx.params.id));
  if (!row) throw notFound('Фильтр не найден');
  if (row.user_id !== user.id && user.role !== 'admin') throw badRequest('Можно удалять только собственные фильтры');
  await run('DELETE FROM saved_filters WHERE id = ?', row.id);
  return { ok: true };
});

module.exports = router;

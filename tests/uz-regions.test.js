'use strict';
/**
 * Приёмочные испытания по дополнению № 1 к ТЗ:
 * местные партнёры (P-16) и регионы реализации в Узбекистане (P-17).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, createClient, cleanup } = require('./helpers');
const db = require('../server/db');
const notify = require('../server/notify');

const PASSWORD = 'Parol2026!';
let admin;
let manager;
const ctx = {};

test.before(async () => {
  await startServer();
  admin = createClient();
  await admin.login('admin@textile.gov.uz', PASSWORD);

  const region = db.get("SELECT id FROM regions WHERE code = 'europe'");
  const created = await admin.post('/api/admin/users', {
    email: 'pm.uz@textile.gov.uz', full_name: 'Каримова Дилноза Шухратовна',
    role: 'team', region_id: region.id, password: PASSWORD,
  });
  ctx.managerId = created.body.id;
  manager = createClient();
  await manager.login('pm.uz@textile.gov.uz', PASSWORD);

  ctx.countryTr = db.get("SELECT id FROM countries WHERE iso2 = 'TR'").id;
  ctx.countryUz = db.get("SELECT id FROM countries WHERE iso2 = 'UZ'").id;
  ctx.namangan = db.get("SELECT id FROM uz_regions WHERE code = 'namangan'").id;
  ctx.fergana = db.get("SELECT id FROM uz_regions WHERE code = 'fergana'").id;

  const foreign = await admin.post('/api/companies', { name: 'Anadolu Tekstil A.S.', country_id: ctx.countryTr });
  ctx.foreignId = foreign.body.id;
  const local1 = await admin.post('/api/companies', { name: 'ООО «Наманган Тукимачилик»', country_id: ctx.countryUz, city: 'Наманган' });
  ctx.local1 = local1.body.id;
  const local2 = await admin.post('/api/companies', { name: 'АО «Узбектекстиль»', country_id: ctx.countryUz, city: 'Ташкент' });
  ctx.local2 = local2.body.id;
});

test.after(async () => {
  notify.stopScheduler();
  await stopServer();
  cleanup();
});

const baseProject = () => ({
  record_type: 'project', sector_code: 'textile', area: 'investment',
  country_id: ctx.countryTr, company_id: ctx.foreignId,
  title: 'Совместное прядильное производство', amount: 28000000, currency: 'USD',
  status_code: 'negotiation', contacts: [{ full_name: 'Мехмет Йылмаз' }],
});

test('Справочник содержит 14 регионов Узбекистана', async () => {
  const reference = await manager.get('/api/reference');
  const regions = reference.body.uz_regions;
  assert.equal(regions.length, 14, 'ровно 14 административных единиц');
  const codes = regions.map((r) => r.code);
  for (const expected of ['karakalpakstan', 'tashkent_city', 'fergana', 'khorezm']) {
    assert.ok(codes.includes(expected), `в справочнике есть ${expected}`);
  }
  assert.equal(regions[0].name_ru, 'Республика Каракалпакстан', 'порядок сортировки соблюдён');
  assert.ok(regions.every((r) => r.name_uz && r.name_en), 'названия заполнены на трёх языках');
});

test('Сценарий 1: проект с несколькими местными партнёрами и регионами реализации', async () => {
  const created = await manager.post('/api/projects', {
    ...baseProject(),
    partners: [
      { company_id: ctx.local1, role_note: 'учредитель совместного предприятия' },
      { company_id: ctx.local2, role_note: 'отраслевое сопровождение' },
    ],
    locations: [
      { uz_region_id: ctx.namangan, locality: 'г. Наманган', amount: 20000000 },
      { uz_region_id: ctx.fergana, locality: 'Кувинский район', amount: 8000000 },
    ],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  ctx.projectId = created.body.id;

  const card = await manager.get(`/api/projects/${ctx.projectId}`);
  assert.equal(card.body.partners.length, 2, 'сохранены оба местных партнёра');
  assert.equal(card.body.partners[0].role_note, 'учредитель совместного предприятия');
  assert.equal(card.body.locations.length, 2, 'сохранены оба региона');
  assert.equal(card.body.locations[0].locality, 'г. Наманган');
  assert.equal(card.body.locations[0].amount, 20000000);

  // Менеджер не может изменить запись, администратор может (раздел 2.2 ТЗ)
  const byManager = await manager.patch(`/api/projects/${ctx.projectId}`, { title: 'Другое название' });
  assert.equal(byManager.status, 403, 'изменение менеджером запрещено');

  const byAdmin = await admin.patch(`/api/projects/${ctx.projectId}`, {
    partners: [{ company_id: ctx.local1, role_note: 'единственный учредитель' }],
  });
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
  assert.equal(byAdmin.body.partners.length, 1, 'администратор сократил список партнёров');
});

test('Сценарий 2: регион без города или района не сохраняется', async () => {
  const result = await manager.post('/api/projects', {
    ...baseProject(),
    locations: [{ uz_region_id: ctx.namangan, locality: '' }],
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /укажите город или район/i);
  assert.match(result.body.error, /Наманганская область/);
});

test('Сценарий 3: повтор региона и повтор партнёра отклоняются', async () => {
  const dupRegion = await manager.post('/api/projects', {
    ...baseProject(),
    locations: [
      { uz_region_id: ctx.fergana, locality: 'г. Фергана' },
      { uz_region_id: ctx.fergana, locality: 'Кувинский район' },
    ],
  });
  assert.equal(dupRegion.status, 400);
  assert.match(dupRegion.body.error, /уже добавлен/i);

  const dupPartner = await manager.post('/api/projects', {
    ...baseProject(),
    partners: [{ company_id: ctx.local1 }, { company_id: ctx.local1 }],
  });
  assert.equal(dupPartner.status, 400);
  assert.match(dupPartner.body.error, /уже указана как местный партнёр/i);

  // Ограничение действует и на уровне базы данных
  const unique = db.all("SELECT sql FROM sqlite_master WHERE name = 'project_locations'")[0].sql;
  assert.match(unique, /UNIQUE \(project_id, uz_region_id\)/);
});

test('Иностранный партнёр не может быть указан местным партнёром того же проекта', async () => {
  const result = await manager.post('/api/projects', {
    ...baseProject(),
    partners: [{ company_id: ctx.foreignId }],
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /не могут быть одной организацией/i);
});

test('Сценарий 4: регионы указываются только у инвестиционных проектов', async () => {
  const asExport = await manager.post('/api/projects', {
    ...baseProject(), area: 'export',
    locations: [{ uz_region_id: ctx.namangan, locality: 'г. Наманган' }],
  });
  assert.equal(asExport.status, 400, 'для экспортного проекта регионы не принимаются');
  assert.match(asExport.body.error, /только для инвестиционных/i);

  // Смена направления не удаляет уже введённые данные
  const before = await admin.get(`/api/projects/${ctx.projectId}`);
  assert.ok(before.body.locations.length > 0);
  const switched = await admin.patch(`/api/projects/${ctx.projectId}`, { area: 'export' });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));

  const after = await admin.get(`/api/projects/${ctx.projectId}`);
  assert.equal(after.body.locations.length, before.body.locations.length, 'площадки сохранены при смене направления');
  assert.equal(after.body.locations_allowed, false, 'поле помечено как недоступное для редактирования');

  await admin.patch(`/api/projects/${ctx.projectId}`, { area: 'investment' });

  // Настройка администратора распространяет поле на экспортные записи (решение Р-3)
  await admin.patch('/api/admin/settings', { 'projects.locations_for_export': true });
  const allowed = await manager.post('/api/projects', {
    ...baseProject(), area: 'export', title: 'Экспорт с указанием площадки',
    locations: [{ uz_region_id: ctx.namangan, locality: 'г. Наманган' }],
  });
  assert.equal(allowed.status, 200, 'при включённой настройке регионы принимаются');
  await admin.patch('/api/admin/settings', { 'projects.locations_for_export': false });
  await admin.delete(`/api/projects/${allowed.body.id}`);
});

test('Сценарий 5: карточка компании показывает проекты, где она местный партнёр', async () => {
  const company = await manager.get(`/api/companies/${ctx.local1}`);
  assert.equal(company.status, 200);
  assert.ok(company.body.partner_projects.length >= 1, 'проекты местного партнёрства перечислены');
  assert.equal(company.body.partner_projects[0].role_note, 'единственный учредитель');
  assert.equal(company.body.role, 'local', 'роль компании определена');
  assert.ok(company.body.partner_totals.USD > 0, 'подсчитана сумма по роли местного партнёра');
});

test('Сценарий 6: дашборд считает проекты по регионам Узбекистана', async () => {
  const dashboard = await admin.get('/api/dashboard');
  const byRegion = dashboard.body.by_uz_region;
  assert.ok(byRegion.length >= 2, 'разрез по регионам построен');

  const namangan = byRegion.find((r) => r.key === 'namangan');
  assert.ok(namangan, 'Наманганская область присутствует');
  assert.ok(namangan.localities.includes('г. Наманган'), 'населённые пункты перечислены');

  // Сверка с расчётом по базе данных
  const expected = db.get(
    `SELECT COUNT(*) AS n FROM project_locations pl
     JOIN uz_regions ur ON ur.id = pl.uz_region_id
     JOIN projects p ON p.id = pl.project_id AND p.is_deleted = 0
     WHERE ur.code = 'namangan'`
  ).n;
  assert.equal(namangan.count, expected, 'число совпадает с расчётом по базе');

  const summary = dashboard.body.uz_summary;
  assert.equal(summary.regions_total, 14);
  assert.equal(summary.regions_covered, byRegion.length);
  assert.ok(summary.investment_total >= 1);
});

test('Сценарий 6а: сумма распределяется только по заполненным объёмам (решение Р-1)', async () => {
  const withoutAmounts = await manager.post('/api/projects', {
    ...baseProject(), title: 'Проект без распределения объёмов', amount: 5000000,
    locations: [{ uz_region_id: ctx.fergana, locality: 'г. Фергана' }],
  });
  assert.equal(withoutAmounts.status, 200, JSON.stringify(withoutAmounts.body));

  const dashboard = await admin.get('/api/dashboard');
  const fergana = dashboard.body.by_uz_region.find((r) => r.key === 'fergana');
  assert.ok(fergana, 'регион присутствует в разрезе');
  assert.ok(
    dashboard.body.uz_summary.unallocated_usd >= 5000000,
    'нераспределённый объём включает проект без сумм по регионам'
  );
  await admin.delete(`/api/projects/${withoutAmounts.body.id}`);
});

test('Сценарий 7: фильтры реестра по региону и по местному партнёру', async () => {
  const byRegion = await manager.get('/api/projects?uz_region=namangan');
  assert.ok(byRegion.body.rows.some((p) => p.id === ctx.projectId), 'фильтр по региону находит проект');

  const byPartner = await manager.get(`/api/projects?partner_company_id=${ctx.local1}`);
  assert.ok(byPartner.body.rows.some((p) => p.id === ctx.projectId), 'фильтр по местному партнёру работает');

  const missing = await manager.get('/api/projects?no_uz_region=1');
  assert.ok(missing.body.rows.every((p) => p.area === 'investment'), 'в выборку попадают только инвестиционные записи');

  const search = await manager.get('/api/projects?search=' + encodeURIComponent('Кувинский'));
  assert.ok(search.body.rows.some((p) => p.id === ctx.projectId), 'поиск охватывает населённые пункты');
});

test('Сценарий 8: выгрузка содержит партнёров, регионы и населённые пункты', async () => {
  const csv = await admin.get('/api/export/projects?format=csv');
  assert.equal(csv.status, 200);
  const text = csv.body.toString('utf8');
  assert.ok(text.includes('Местные партнёры'), 'колонка местных партнёров');
  assert.ok(text.includes('Регионы реализации'), 'колонка регионов');
  assert.ok(text.includes('Города и районы'), 'колонка населённых пунктов');
  assert.ok(text.includes('Наманганская область'), 'значение региона выгружено');

  const rowsExport = await admin.get('/api/export/uz_locations?format=csv');
  assert.equal(rowsExport.status, 200);
  const rowsText = rowsExport.body.toString('utf8');
  assert.ok(rowsText.includes('Регион Узбекистана'), 'построчная выгрузка по площадкам');

  const portfolio = await admin.get('/api/export/report/portfolio');
  assert.equal(portfolio.status, 200);
  assert.equal(portfolio.body.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(portfolio.body.includes(Buffer.from('xl/worksheets/sheet6.xml')), 'в сводном отчёте появился шестой лист');
});

test('Сценарий 9: журнал аудита фиксирует состав партнёров и регионов', async () => {
  await admin.patch(`/api/projects/${ctx.projectId}`, {
    partners: [{ company_id: ctx.local1, role_note: 'единственный учредитель' }, { company_id: ctx.local2, role_note: '' }],
  });
  const audit = await admin.get(`/api/admin/audit?entity_type=project&entity_id=${ctx.projectId}`);
  const entry = audit.body.rows.find((row) => row.changes.some((c) => c.field === 'partners'));
  assert.ok(entry, 'изменение состава партнёров записано');
  const change = entry.changes.find((c) => c.field === 'partners');
  assert.equal(change.label, 'Местные партнёры');
  assert.notEqual(change.from, change.to, 'сохранены прежнее и новое значения');
});

test('Сценарий 10: компанию — местного партнёра нельзя удалить', async () => {
  const result = await admin.delete(`/api/companies/${ctx.local1}`);
  assert.equal(result.status, 409, 'удаление заблокировано');
  assert.match(result.body.error, /как местный партнёр/i);
});

test('Регион, используемый в проектах, нельзя отключить в справочнике', async () => {
  const result = await admin.patch(`/api/admin/uz-regions/${ctx.namangan}`, { is_active: false });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /не может быть отключён/i);

  const rename = await admin.patch(`/api/admin/uz-regions/${ctx.fergana}`, { name_en: 'Fergana Province' });
  assert.equal(rename.status, 200, 'переименование доступно администратору');

  const byManager = await manager.patch(`/api/admin/uz-regions/${ctx.fergana}`, { name_ru: 'Тест' });
  assert.equal(byManager.status, 403, 'менеджер справочник не редактирует');
});

test('Сценарий 11: настройки системы сохраняются и читаются корректно', async () => {
  // Проверка исправления: значения по умолчанию должны попадать в базу,
  // иначе форма настроек показывает нули и способна их сохранить.
  const settings = await admin.get('/api/admin/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.values['security.session_timeout_minutes'], 30, 'тайм-аут сессии не обнулён');
  assert.equal(settings.body.values['projects.stale_days'], 30);
  assert.equal(settings.body.values['recycle_bin.retention_days'], 30);
  assert.deepEqual(settings.body.values['reminders.days_before'], [7, 3, 1]);
  assert.ok(settings.body.values['org.ministry'].length > 10, 'наименование организации заполнено');
  assert.ok(settings.body.values['currency.rates_to_usd'].USD === 1, 'курсы валют заданы');
});

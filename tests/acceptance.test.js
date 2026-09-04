'use strict';
/**
 * Приёмочные испытания по разделу 14.1 ТЗ.
 * Каждый тест соответствует одному сценарию приёмки.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, createClient, cleanup } = require('./helpers');
const db = require('../server/db');
const notify = require('../server/notify');

const PASSWORD = 'Parol2026!';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

let admin;
let manager;
let context = {};

test.before(async () => {
  await startServer();

  admin = createClient();
  await admin.login('admin@textile.gov.uz', PASSWORD);

  // Проектный менеджер по Европе
  const region = await db.get("SELECT id FROM regions WHERE code = 'europe'");
  const created = await admin.post('/api/admin/users', {
    email: 'pm.europe@textile.gov.uz',
    full_name: 'Каримова Дилноза Шухратовна',
    position: 'Проектный менеджер по Европе',
    role: 'team',
    region_id: region.id,
    password: PASSWORD,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  context.managerId = created.body.id;

  manager = createClient();
  await manager.login('pm.europe@textile.gov.uz', PASSWORD);

  context.countryDe = (await db.get("SELECT id FROM countries WHERE iso2 = 'DE'")).id;
  context.countryIt = (await db.get("SELECT id FROM countries WHERE iso2 = 'IT'")).id;
});

test.after(async () => {
  notify.stopScheduler();
  await stopServer();
  cleanup();
});

// ---------------------------------------------------------------------------
test('Сценарий 1: менеджер создаёт проект с дорожной картой и файлом, но не может его изменить или удалить', async () => {
  const created = await manager.post('/api/projects', {
    record_type: 'contract',
    sector_code: 'textile',
    area: 'export',
    country_id: context.countryDe,
    company_id: null,
    title: 'Поставка домашнего текстиля в розничную сеть Германии',
    amount: 4200000,
    currency: 'USD',
    status_code: 'negotiation',
    contacts: [{ full_name: 'Клаус Вебер', position: 'Директор по закупкам', email: 'k.weber@example.com' }],
    steps: [
      { title: 'Подписание годовой спецификации', due_date: day(10) },
      { title: 'Первая отгрузка', due_date: day(30) },
      { title: 'Согласование объёмов на следующий год', due_date: day(60) },
    ],
  });
  // Компания обязательна — сначала создаём её, как это делает интерфейс.
  assert.equal(created.status, 400, 'без компании запись создаваться не должна');

  const company = await manager.post('/api/companies', {
    name: 'Textilhandel Nord GmbH', country_id: context.countryDe, city: 'Гамбург',
  });
  assert.equal(company.status, 200, JSON.stringify(company.body));
  context.companyId = company.body.id;

  const project = await manager.post('/api/projects', {
    record_type: 'contract', sector_code: 'textile', area: 'export',
    country_id: context.countryDe, company_id: context.companyId,
    title: 'Поставка домашнего текстиля в розничную сеть Германии',
    amount: 4200000, currency: 'USD', status_code: 'negotiation',
    contacts: [{ full_name: 'Клаус Вебер', position: 'Директор по закупкам', email: 'k.weber@example.com' }],
    steps: [
      { title: 'Подписание годовой спецификации', due_date: day(10) },
      { title: 'Первая отгрузка', due_date: day(30) },
      { title: 'Согласование объёмов на следующий год', due_date: day(60) },
    ],
  });
  assert.equal(project.status, 200, JSON.stringify(project.body));
  context.projectId = project.body.id;
  assert.match(project.body.code, /^PRJ-\d{4}-\d{4}$/);

  const card = await manager.get(`/api/projects/${context.projectId}`);
  assert.equal(card.body.steps.length, 3, 'дорожная карта из трёх этапов');
  assert.equal(card.body.contacts.length, 1);
  context.stepId = card.body.steps[0].id;

  // Фотография прикладывается к этапу
  const upload = await manager.upload('step', context.stepId, 'otchet-foto.png', Buffer.from('PNG-заглушка'), 'image/png');
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  assert.equal(upload.body[0].orig_name, 'otchet-foto.png');

  // Менеджер НЕ может изменить или удалить запись
  const edit = await manager.patch(`/api/projects/${context.projectId}`, { title: 'Другое название' });
  assert.equal(edit.status, 403, 'изменение записи менеджером должно запрещаться');
  assert.match(edit.body.error, /администратор/i);

  const remove = await manager.delete(`/api/projects/${context.projectId}`);
  assert.equal(remove.status, 403, 'удаление записи менеджером должно запрещаться');

  const stepEdit = await manager.patch(`/api/steps/${context.stepId}`, { title: 'Изменённый этап' });
  assert.equal(stepEdit.status, 403, 'изменение содержания этапа менеджером должно запрещаться');

  const stepDelete = await manager.delete(`/api/steps/${context.stepId}`);
  assert.equal(stepDelete.status, 403, 'удаление этапа менеджером должно запрещаться');

  // Отметить выполнение своего этапа менеджер может — текст этапа не меняется
  const complete = await manager.patch(`/api/steps/${context.stepId}`, { state: 'done', done_comment: 'Спецификация подписана' });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal(complete.body.state, 'done');
  assert.equal(complete.body.title, 'Подписание годовой спецификации', 'текст этапа остаётся прежним');

  // Администратор изменить и удалить может
  const adminEdit = await admin.patch(`/api/projects/${context.projectId}`, { title: 'Поставка домашнего текстиля в сеть Германии' });
  assert.equal(adminEdit.status, 200, JSON.stringify(adminEdit.body));
  assert.equal(adminEdit.body.title, 'Поставка домашнего текстиля в сеть Германии');
});

// ---------------------------------------------------------------------------
test('Сценарий 2: карточка компании показывает все её проекты и итоговые суммы', async () => {
  for (const [title, amount] of [['Поставка трикотажа', 1500000], ['Поставка махровых изделий', 800000]]) {
    const result = await manager.post('/api/projects', {
      record_type: 'agreement', sector_code: 'textile', area: 'export',
      country_id: context.countryDe, company_id: context.companyId,
      title, amount, currency: 'USD', status_code: 'negotiation',
      contacts: [{ full_name: 'Клаус Вебер' }],
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }

  const company = await manager.get(`/api/companies/${context.companyId}`);
  assert.equal(company.status, 200);
  assert.equal(company.body.projects.length, 3, 'у компании три проекта');
  assert.equal(company.body.totals.USD, 4200000 + 1500000 + 800000, 'итоговая сумма по компании');
});

// ---------------------------------------------------------------------------
test('Сценарий 3: истёкший срок делает этап просроченным, ответственный и руководство получают уведомления', async () => {
  const step = await manager.post(`/api/projects/${context.projectId}/steps`, {
    title: 'Отправка образцов партнёру',
    due_date: day(-3),
  });
  assert.equal(step.status, 200, JSON.stringify(step.body));

  // Признак просрочки вычисляется автоматически по дате
  const card = await manager.get(`/api/projects/${context.projectId}`);
  const overdueStep = card.body.steps.find((s) => s.id === step.body.id);
  assert.equal(overdueStep.is_overdue, true, 'этап помечен как просроченный');

  const list = await manager.get('/api/projects?overdue=1');
  assert.ok(list.body.rows.some((p) => p.id === context.projectId), 'проект попадает в фильтр «просроченные этапы»');

  // Планировщик формирует уведомления с эскалацией руководству
  const created = await notify.runOverdueChecks();
  assert.ok(created > 0, 'создано хотя бы одно уведомление о просрочке');

  const managerInbox = await manager.get('/api/notifications');
  assert.ok(
    managerInbox.body.rows.some((n) => n.type === 'deadline_overdue' && n.title.includes('Отправка образцов')),
    'ответственный менеджер получил уведомление'
  );

  const adminInbox = await admin.get('/api/notifications');
  assert.ok(
    adminInbox.body.rows.some((n) => n.type === 'deadline_escalation'),
    'руководство получило эскалацию'
  );

  // Повторный запуск не создаёт дубликатов
  const again = await notify.runOverdueChecks();
  assert.equal(again, 0, 'повторные уведомления не дублируются');
});

// ---------------------------------------------------------------------------
test('Сценарий 4: администратор добавляет поле-голосование, оно появляется в форме, фильтрах и выгрузке', async () => {
  const poll = await admin.post('/api/admin/custom-fields', {
    form: 'project',
    type: 'poll',
    label_ru: 'Приоритет проекта',
    help_text: 'Оценка приоритетности офисом',
    options: ['Высокий', 'Средний', 'Низкий'],
  });
  assert.equal(poll.status, 200, JSON.stringify(poll.body));
  context.pollFieldId = poll.body.id;

  const textField = await admin.post('/api/admin/custom-fields', {
    form: 'project',
    type: 'select',
    label_ru: 'Мера государственной поддержки',
    options: ['Не требуется', 'Экспортная субсидия', 'Льготный кредит'],
  });
  assert.equal(textField.status, 200, JSON.stringify(textField.body));

  // Поле доступно в справочнике форм — интерфейс строит форму по этим данным
  const reference = await manager.get('/api/reference');
  const fields = reference.body.custom_fields.project;
  assert.ok(fields.some((f) => f.field_key === poll.body.field_key), 'поле появилось в форме проекта');

  // Значение произвольного поля сохраняется вместе с записью
  const saved = await admin.patch(`/api/projects/${context.projectId}`, {
    custom_values: { [textField.body.field_key]: 'Экспортная субсидия' },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const card = await admin.get(`/api/projects/${context.projectId}`);
  assert.equal(card.body.custom_values[textField.body.field_key], 'Экспортная субсидия');

  // Голосование
  const vote = await manager.post(`/api/polls/${context.pollFieldId}/vote`, {
    entity_type: 'project', entity_id: context.projectId, option: 'Высокий',
  });
  assert.equal(vote.status, 200, JSON.stringify(vote.body));
  assert.equal(vote.body.my_vote, 'Высокий');
  assert.equal(vote.body.total, 1);

  // Поле присутствует в выгрузке Excel
  const exported = await admin.get('/api/export/projects?format=csv');
  assert.equal(exported.status, 200);
  const csv = exported.body.toString('utf8');
  assert.ok(csv.includes('Мера государственной поддержки'), 'заголовок произвольного поля есть в выгрузке');
  assert.ok(csv.includes('Экспортная субсидия'), 'значение произвольного поля есть в выгрузке');
});

// ---------------------------------------------------------------------------
test('Сценарий 5: визит со встречами формирует программу по дням, несогласованная встреча попадает в панель внимания', async () => {
  const visit = await manager.post('/api/visits', {
    direction: 'outbound',
    country_id: context.countryDe,
    cities: 'Гамбург, Дюссельдорф',
    date_from: day(6),
    date_to: day(9),
    status_code: 'planned',
    goal: 'Участие в выставке и переговоры с покупателями домашнего текстиля',
    members: [
      { user_id: context.managerId, organization: 'Проектный офис', position: 'Руководитель делегации' },
      { full_name: 'Шодиев Фаррух Абдуллаевич', organization: 'АО «Узбектекстиль»', position: 'Заместитель председателя' },
    ],
  });
  assert.equal(visit.status, 200, JSON.stringify(visit.body));
  context.visitId = visit.body.id;

  const meetings = [
    { company_id: context.companyId, meet_date: day(6), meet_time: '10:00', venue: 'Гамбург', status_code: 'arranged' },
    { company_name: 'Торгово-промышленная палата Гамбурга', meet_date: day(6), meet_time: '15:00', status_code: 'arranged' },
    { company_name: 'Heimtextil — деловая программа', meet_date: day(7), meet_time: '09:00', status_code: 'tbc' },
    { company_name: 'Rheinland Home Collection GmbH', meet_date: day(8), meet_time: '11:00', status_code: 'tbc' },
    { company_name: 'Nordwest Trading AG', meet_date: day(9), meet_time: '13:00', status_code: 'arranged' },
  ];
  for (const meeting of meetings) {
    const result = await manager.post(`/api/visits/${context.visitId}/meetings`, meeting);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }

  const card = await manager.get(`/api/visits/${context.visitId}`);
  assert.equal(card.body.meetings.length, 5, 'пять встреч в визите');
  assert.equal(card.body.agenda.length, 4, 'программа сгруппирована по четырём дням');
  assert.equal(card.body.agenda[0].meetings.length, 2, 'в первый день две встречи');
  assert.equal(card.body.members.length, 2, 'состав делегации из двух человек');
  assert.equal(card.body.meetings_tbc, 2, 'две несогласованные встречи');

  // Несогласованная встреча в пределах порога попадает в панель внимания
  const dashboard = await admin.get('/api/dashboard');
  assert.ok(
    dashboard.body.attention.tbc_meetings.some((m) => m.visit_id === context.visitId),
    'несогласованная встреча показана в панели внимания'
  );

  // Встреча связывается с проектом, и она видна в истории проекта
  const linked = await admin.patch(`/api/meetings/${card.body.meetings[0].id}`, { project_id: context.projectId });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const project = await admin.get(`/api/projects/${context.projectId}`);
  assert.equal(project.body.meetings.length, 1, 'встреча отображается в истории проекта');
});

// ---------------------------------------------------------------------------
test('Сценарий 6: дашборд по одному региону совпадает с расчётом вручную', async () => {
  // Проект в другом регионе — не должен попасть в выборку по Европе
  const china = await db.get("SELECT id FROM countries WHERE iso2='CN'");
  const other = await admin.post('/api/companies', { name: 'Shandong Silk Co.', country_id: china.id });
  await admin.post('/api/projects', {
    record_type: 'contract', sector_code: 'silk', area: 'export',
    country_id: china.id,
    company_id: other.body.id, title: 'Экспорт шёлка-сырца в КНР',
    amount: 12600000, currency: 'USD', status_code: 'implementation',
    contacts: [{ full_name: 'Ли Вэй' }],
  });

  const dashboard = await admin.get('/api/dashboard?region=europe');
  const europe = dashboard.body;

  const expected = await db.all(
    `SELECT p.amount FROM projects p JOIN countries c ON c.id = p.country_id
     JOIN regions r ON r.id = c.region_id
     WHERE p.is_deleted = 0 AND r.code = 'europe'`
  );
  const expectedSum = expected.reduce((sum, row) => sum + (row.amount || 0), 0);

  assert.equal(europe.kpi.projects_total, expected.length, 'число проектов совпадает с расчётом по базе');
  assert.equal(europe.kpi.amount_total_usd, Math.round(expectedSum), 'сумма совпадает с расчётом по базе');
  assert.equal(europe.by_region.length, 1, 'в выборке только один регион');
  assert.equal(europe.by_region[0].key, 'europe');
});

// ---------------------------------------------------------------------------
test('Сценарий 7: выгрузка отфильтрованного реестра открывается как книга Excel', async () => {
  const result = await admin.get('/api/export/projects?area=export&format=xlsx');
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /spreadsheetml\.sheet/);

  const buffer = result.body;
  // Признак ZIP-контейнера, в котором хранится .xlsx
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK', 'файл является корректным ZIP-контейнером');
  assert.ok(buffer.length > 2000, 'книга содержит данные');
  assert.ok(buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')), 'в архиве есть лист книги');
  assert.ok(buffer.includes(Buffer.from('xl/sharedStrings.xml')), 'в архиве есть словарь строк');

  const portfolio = await admin.get('/api/export/report/portfolio');
  assert.equal(portfolio.status, 200);
  assert.equal(portfolio.body.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(portfolio.body.includes(Buffer.from('xl/worksheets/sheet5.xml')), 'сводный отчёт содержит пять листов');
});

// ---------------------------------------------------------------------------
test('Сценарий 8: журнал аудита фиксирует старое и новое значение, автора и время удаления', async () => {
  const before = await admin.get(`/api/projects/${context.projectId}`);
  await admin.patch(`/api/projects/${context.projectId}`, { amount: 5000000 });

  const audit = await admin.get(`/api/admin/audit?entity_type=project&entity_id=${context.projectId}`);
  assert.equal(audit.status, 200);
  const updateEntry = audit.body.rows.find((row) => row.action === 'update' && row.changes.some((c) => c.field === 'amount'));
  assert.ok(updateEntry, 'изменение суммы записано в журнал');
  const change = updateEntry.changes.find((c) => c.field === 'amount');
  assert.equal(change.from, before.body.amount, 'старое значение сохранено');
  assert.equal(change.to, 5000000, 'новое значение сохранено');
  assert.equal(change.label, 'Сумма', 'название поля на русском языке');
  assert.ok(updateEntry.user_label.includes('admin@textile.gov.uz'), 'автор изменения зафиксирован');
  assert.ok(updateEntry.created_at, 'время изменения зафиксировано');

  // Удаление
  const temp = await admin.post('/api/projects', {
    record_type: 'project', sector_code: 'textile', area: 'export',
    country_id: context.countryIt, company_id: context.companyId,
    title: 'Временная запись для проверки удаления', status_code: 'negotiation',
    contacts: [{ full_name: 'Тестовый контакт' }],
  });
  await admin.delete(`/api/projects/${temp.body.id}`);

  const deleteAudit = await admin.get(`/api/admin/audit?action=delete&entity_type=project&entity_id=${temp.body.id}`);
  const deleteEntry = deleteAudit.body.rows[0];
  assert.ok(deleteEntry, 'удаление записано в журнал');
  assert.match(deleteEntry.summary, /Удалён проект/);
  assert.ok(deleteEntry.user_label.includes('admin@textile.gov.uz'));

  // Менеджеру журнал аудита недоступен
  const forbidden = await manager.get('/api/admin/audit');
  assert.equal(forbidden.status, 403, 'журнал аудита доступен только администратору');

  context.deletedProjectId = temp.body.id;
});

// ---------------------------------------------------------------------------
test('Сценарий 9: удалённая запись восстанавливается из корзины', async () => {
  const bin = await admin.get('/api/admin/recycle-bin');
  assert.equal(bin.status, 200);
  assert.ok(bin.body.bins.project.rows.some((row) => row.id === context.deletedProjectId), 'запись лежит в корзине');
  assert.equal(bin.body.retention_days, 30, 'срок хранения — 30 дней');

  const restored = await admin.post(`/api/admin/recycle-bin/project/${context.deletedProjectId}/restore`);
  assert.equal(restored.status, 200);

  const card = await admin.get(`/api/projects/${context.deletedProjectId}`);
  assert.equal(card.status, 200, 'запись снова доступна');
});

// ---------------------------------------------------------------------------
test('Заявка на исправление: менеджер запрашивает, администратор рассматривает (п. 2.3 ТЗ)', async () => {
  const request = await manager.post('/api/corrections', {
    entity_type: 'project',
    entity_id: context.projectId,
    entity_label: 'Поставка домашнего текстиля',
    reason: 'В поле «Сумма» опечатка: указано 5 000 000 вместо 5 500 000 долларов США.',
  });
  assert.equal(request.status, 200, JSON.stringify(request.body));
  assert.equal(request.body.status, 'pending');

  const adminInbox = await admin.get('/api/notifications');
  assert.ok(adminInbox.body.rows.some((n) => n.type === 'correction_request'), 'администратор уведомлён о заявке');

  const decided = await admin.post(`/api/corrections/${request.body.id}/decide`, {
    decision: 'approved', note: 'Сумма исправлена на 5 500 000 USD.',
  });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.status, 'approved');

  const managerInbox = await manager.get('/api/notifications');
  assert.ok(managerInbox.body.rows.some((n) => n.type === 'correction_decision'), 'автор заявки уведомлён о решении');

  // Решение по заявке доступно только администратору
  const forbidden = await manager.post(`/api/corrections/${request.body.id}/decide`, { decision: 'approved' });
  assert.equal(forbidden.status, 403);
});

// ---------------------------------------------------------------------------
test('Целостность данных: компанию со связанными проектами удалить нельзя (раздел 11 ТЗ)', async () => {
  const result = await admin.delete(`/api/companies/${context.companyId}`);
  assert.equal(result.status, 409, 'удаление блокируется');
  assert.match(result.body.error, /связано проектов/i);
});

// ---------------------------------------------------------------------------
test('Роль «Наблюдатель» имеет доступ только на чтение', async () => {
  await admin.post('/api/admin/users', {
    email: 'viewer@textile.gov.uz', full_name: 'Эргашев Дилшод Насибович',
    role: 'viewer', password: PASSWORD,
  });
  const viewer = createClient();
  await viewer.login('viewer@textile.gov.uz', PASSWORD);

  const list = await viewer.get('/api/projects');
  assert.equal(list.status, 200, 'просмотр разрешён');

  const create = await viewer.post('/api/projects', {
    record_type: 'project', sector_code: 'textile', area: 'export',
    country_id: context.countryDe, company_id: context.companyId,
    title: 'Попытка создания наблюдателем', status_code: 'negotiation',
    contacts: [{ full_name: 'Тест' }],
  });
  assert.equal(create.status, 403, 'создание запрещено');

  const exportResult = await viewer.get('/api/export/projects?format=csv');
  assert.equal(exportResult.status, 200, 'выгрузка отчётов разрешена');
});

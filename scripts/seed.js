'use strict';
/**
 * Наполнение системы демонстрационными данными.
 *   node scripts/seed.js           — добавить демо-данные (если их ещё нет)
 *   node scripts/seed.js --reset   — очистить базу и создать демо-данные заново
 *
 * Пароль всех демонстрационных учётных записей: Parol2026!
 */
const { db, all, get, run, transaction, nextCode } = require('../server/db');
const reference = require('../server/reference');
const auth = require('../server/auth');

const DEMO_PASSWORD = 'Parol2026!';
const reset = process.argv.includes('--reset');

const TABLES = [
  'poll_votes', 'custom_values', 'custom_fields', 'correction_requests',
  'notification_deliveries', 'notifications', 'audit_log', 'saved_filters',
  'comments', 'attachments', 'contacts', 'meetings', 'visit_members', 'visits',
  'roadmap_steps', 'project_status_history', 'projects', 'companies', 'sessions', 'users',
];

if (reset) {
  db.exec('PRAGMA foreign_keys = OFF');
  transaction(() => { for (const table of TABLES) run(`DELETE FROM ${table}`); });
  db.exec('PRAGMA foreign_keys = ON');
  console.log('База очищена.');
}

reference.ensureReference();

if (get('SELECT id FROM projects LIMIT 1') && !reset) {
  console.log('Демонстрационные данные уже присутствуют. Для пересоздания используйте: npm run reset');
  process.exit(0);
}

const regionId = (code) => get('SELECT id FROM regions WHERE code = ?', code).id;
const countryId = (iso2) => get('SELECT id FROM countries WHERE iso2 = ?', iso2).id;

// --------------------------------------------------------------------------
// Пользователи: руководитель офиса (администратор) и 9 проектных менеджеров
// --------------------------------------------------------------------------
const USERS = [
  { email: 'admin@textile.gov.uz', full_name: 'Азизов Тимур Рустамович', position: 'Руководитель Проектного офиса', role: 'admin', region: null },
  { email: 'europe@textile.gov.uz', full_name: 'Каримова Дилноза Шухратовна', position: 'Проектный менеджер по Европе', role: 'team', region: 'europe' },
  { email: 'cis@textile.gov.uz', full_name: 'Юсупов Бекзод Алишерович', position: 'Проектный менеджер по СНГ и Центральной Азии', role: 'team', region: 'cis' },
  { email: 'me@textile.gov.uz', full_name: 'Рахимов Санжар Икромович', position: 'Проектный менеджер по Ближнему Востоку', role: 'team', region: 'middle_east' },
  { email: 'southasia@textile.gov.uz', full_name: 'Норова Малика Фарходовна', position: 'Проектный менеджер по Южной Азии', role: 'team', region: 'south_asia' },
  { email: 'eastasia@textile.gov.uz', full_name: 'Турсунов Жасур Улугбекович', position: 'Проектный менеджер по Восточной Азии', role: 'team', region: 'east_asia' },
  { email: 'apac@textile.gov.uz', full_name: 'Абдуллаева Нилуфар Бахтиёровна', position: 'Проектный менеджер по ЮВА и Океании', role: 'team', region: 'asia_pacific' },
  { email: 'namerica@textile.gov.uz', full_name: 'Хасанов Отабек Джамшидович', position: 'Проектный менеджер по Северной Америке', role: 'team', region: 'north_america' },
  { email: 'latam@textile.gov.uz', full_name: 'Мирзаев Улугбек Тахирович', position: 'Проектный менеджер по Латинской Америке', role: 'team', region: 'latin_america' },
  { email: 'africa@textile.gov.uz', full_name: 'Салимова Зухра Кахрамоновна', position: 'Проектный менеджер по Африке', role: 'team', region: 'africa' },
  { email: 'observer@textile.gov.uz', full_name: 'Эргашев Дилшод Насибович', position: 'Наблюдатель (руководство министерства)', role: 'viewer', region: null },
];

const users = {};
transaction(() => {
  for (const user of USERS) {
    const { salt, hash } = auth.hashPassword(DEMO_PASSWORD);
    const result = run(
      `INSERT INTO users (email, full_name, position, role, region_id, password_hash, password_salt, phone, language, notify_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ru', 1)`,
      user.email, user.full_name, user.position, user.role,
      user.region ? regionId(user.region) : null, hash, salt,
      `+998 71 ${200 + Math.floor(Math.random() * 700)}-${10 + Math.floor(Math.random() * 89)}-${10 + Math.floor(Math.random() * 89)}`
    );
    users[user.email] = Number(result.lastInsertRowid);
  }
});

const U = (key) => users[`${key}@textile.gov.uz`];

// --------------------------------------------------------------------------
// Компании-партнёры
// --------------------------------------------------------------------------
const COMPANIES = [
  { key: 'textilhandel', name: 'Textilhandel Nord GmbH', iso2: 'DE', city: 'Гамбург', industry: 'Оптовая торговля текстилем', website: 'https://textilhandel-nord.example', owner: 'europe',
    profile: 'Крупный оптовый импортёр домашнего текстиля и трикотажа в Северной Германии. Сеть из 340 розничных партнёров.',
    contacts: [{ full_name: 'Клаус Вебер', position: 'Директор по закупкам', phone: '+49 40 555-12-34', email: 'k.weber@textilhandel-nord.example' }] },
  { key: 'milanoseta', name: 'Milano Seta S.p.A.', iso2: 'IT', city: 'Комо', industry: 'Производство шёлковых тканей', website: 'https://milanoseta.example', owner: 'europe',
    profile: 'Итальянский производитель шёлковых тканей премиального сегмента. Интерес к сырцовому шёлку из Ферганской долины.',
    contacts: [{ full_name: 'Джулия Росси', position: 'Руководитель отдела снабжения', phone: '+39 031 555-880', email: 'g.rossi@milanoseta.example' }] },
  { key: 'anadolu', name: 'Anadolu Tekstil A.Ş.', iso2: 'TR', city: 'Бурса', industry: 'Текстильное производство', website: 'https://anadolu-tekstil.example', owner: 'europe',
    profile: 'Турецкий вертикально интегрированный холдинг: пряжа, ткани, готовая одежда. Рассматривает совместное производство в Узбекистане.',
    contacts: [{ full_name: 'Мехмет Йылмаз', position: 'Член правления', phone: '+90 224 555-70-10', email: 'm.yilmaz@anadolu-tekstil.example' }] },
  { key: 'volgatex', name: 'ООО «ВолгаТекс»', iso2: 'RU', city: 'Иваново', industry: 'Оптовая торговля тканями', website: 'https://volgatex.example', owner: 'cis',
    profile: 'Российский дистрибьютор хлопчатобумажных тканей и постельного белья. Действующий контракт на поставки.',
    contacts: [{ full_name: 'Смирнов Андрей Петрович', position: 'Коммерческий директор', phone: '+7 4932 55-11-22', email: 'a.smirnov@volgatex.example' }] },
  { key: 'almatytex', name: 'ТОО «Алматы Текстиль Групп»', iso2: 'KZ', city: 'Алматы', industry: 'Пошив спецодежды', owner: 'cis',
    profile: 'Казахстанский производитель спецодежды. Закупает трикотажное полотно и ткани.',
    contacts: [{ full_name: 'Нурлан Ахметов', position: 'Генеральный директор', phone: '+7 727 555-30-40', email: 'n.akhmetov@almatytex.example' }] },
  { key: 'gulfhome', name: 'Gulf Home Textiles LLC', iso2: 'AE', city: 'Дубай', industry: 'Домашний текстиль', website: 'https://gulfhome.example', owner: 'me',
    profile: 'Дистрибьютор домашнего текстиля в странах Персидского залива. Сеть гипермаркетов в 6 странах.',
    contacts: [{ full_name: 'Ахмед Аль-Мансури', position: 'Директор по развитию', phone: '+971 4 555-99-00', email: 'a.almansouri@gulfhome.example' }] },
  { key: 'riyadhknit', name: 'Riyadh Knitwear Co.', iso2: 'SA', city: 'Эр-Рияд', industry: 'Трикотажные изделия', owner: 'me',
    profile: 'Производитель и импортёр трикотажа. Обсуждает инвестиции в швейное производство в Узбекистане.',
    contacts: [{ full_name: 'Халид Аль-Отайби', position: 'Управляющий партнёр', phone: '+966 11 555-44-33', email: 'k.alotaibi@riyadhknit.example' }] },
  { key: 'delhicotton', name: 'Delhi Cotton Mills Ltd.', iso2: 'IN', city: 'Нью-Дели', industry: 'Прядение и ткачество', website: 'https://delhicotton.example', owner: 'southasia',
    profile: 'Индийский производитель пряжи. Интерес к совместному предприятию по переработке хлопка.',
    contacts: [{ full_name: 'Раджеш Шарма', position: 'Исполнительный директор', phone: '+91 11 5555-2020', email: 'r.sharma@delhicotton.example' }] },
  { key: 'shandong', name: 'Shandong Silk Import & Export Co.', iso2: 'CN', city: 'Цзинань', industry: 'Импорт и экспорт шёлка', website: 'https://shandong-silk.example', owner: 'eastasia',
    profile: 'Китайская государственная внешнеторговая компания. Крупнейший покупатель шёлка-сырца в регионе.',
    contacts: [{ full_name: 'Ли Вэй', position: 'Заместитель генерального директора', phone: '+86 531 5555-6060', email: 'li.wei@shandong-silk.example' }] },
  { key: 'seoulfashion', name: 'Seoul Fashion Trading Inc.', iso2: 'KR', city: 'Сеул', industry: 'Модная одежда', owner: 'eastasia',
    profile: 'Корейский импортёр готовой одежды, работает с сетями массмаркета.',
    contacts: [{ full_name: 'Ким Мин Джун', position: 'Менеджер по закупкам', phone: '+82 2 5555-7788', email: 'mj.kim@seoulfashion.example' }] },
  { key: 'vietgarment', name: 'VietGarment JSC', iso2: 'VN', city: 'Хошимин', industry: 'Швейное производство', owner: 'apac',
    profile: 'Вьетнамская швейная компания, рассматривает поставки узбекской пряжи и полотна.',
    contacts: [{ full_name: 'Нгуен Ван Хунг', position: 'Директор по снабжению', phone: '+84 28 5555-1212', email: 'hung.nguyen@vietgarment.example' }] },
  { key: 'atlantic', name: 'Atlantic Apparel Group', iso2: 'US', city: 'Нью-Йорк', industry: 'Розничная торговля одеждой', website: 'https://atlanticapparel.example', owner: 'namerica',
    profile: 'Американская розничная сеть. Требует сертификацию по устойчивому производству хлопка.',
    contacts: [{ full_name: 'Джон Миллер', position: 'Вице-президент по закупкам', phone: '+1 212 555-0180', email: 'j.miller@atlanticapparel.example' }] },
  { key: 'saopaulo', name: 'São Paulo Têxtil Ltda.', iso2: 'BR', city: 'Сан-Паулу', industry: 'Домашний текстиль', owner: 'latam',
    profile: 'Бразильский импортёр постельного белья и махровых изделий.',
    contacts: [{ full_name: 'Карлос Оливейра', position: 'Директор по импорту', phone: '+55 11 5555-3030', email: 'c.oliveira@spTextil.example' }] },
  { key: 'cairotex', name: 'Cairo Textile Trading', iso2: 'EG', city: 'Каир', industry: 'Оптовая торговля', owner: 'africa',
    profile: 'Египетский оптовик. Реэкспорт в страны Северной Африки.',
    contacts: [{ full_name: 'Мохамед Хассан', position: 'Владелец', phone: '+20 2 5555-4040', email: 'm.hassan@cairotex.example' }] },
  { key: 'capeleather', name: 'Cape Leather Works (Pty) Ltd', iso2: 'ZA', city: 'Кейптаун', industry: 'Кожевенное производство', owner: 'africa',
    profile: 'Южноафриканский производитель кожгалантереи. Закупает выделанную кожу.',
    contacts: [{ full_name: 'Питер ван дер Мерве', position: 'Генеральный директор', phone: '+27 21 555-5050', email: 'p.vdmerwe@capeleather.example' }] },
];

const companies = {};
transaction(() => {
  for (const company of COMPANIES) {
    const ownerId = U(company.owner);
    const result = run(
      `INSERT INTO companies (name, country_id, city, website, industry, profile, responsible_user_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      company.name, countryId(company.iso2), company.city, company.website || '',
      company.industry, company.profile, ownerId, ownerId, ownerId
    );
    const companyId = Number(result.lastInsertRowid);
    companies[company.key] = companyId;
    for (const contact of company.contacts || []) {
      run(
        `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email)
         VALUES ('company', ?, ?, ?, ?, ?)`,
        companyId, contact.full_name, contact.position, contact.phone, contact.email
      );
    }
  }
});

// --------------------------------------------------------------------------
// Проекты и соглашения
// --------------------------------------------------------------------------
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const PROJECTS = [
  { company: 'textilhandel', owner: 'europe', type: 'contract', sector: 'textile', area: 'export', status: 'implementation',
    title: 'Поставка домашнего текстиля в розничную сеть Германии', amount: 4_200_000, currency: 'USD',
    description: 'Годовой контракт на поставку комплектов постельного белья и махровых изделий. Объём — 380 тыс. комплектов.',
    contacts: [{ full_name: 'Клаус Вебер', position: 'Директор по закупкам', phone: '+49 40 555-12-34', email: 'k.weber@textilhandel-nord.example' }],
    steps: [
      { title: 'Подписание годовой спецификации на 2026 год', due: -60, state: 'done' },
      { title: 'Первая отгрузка (120 тыс. комплектов)', due: -20, state: 'done' },
      { title: 'Вторая отгрузка (130 тыс. комплектов)', due: 12, state: 'in_progress' },
      { title: 'Согласование объёмов на 2027 год', due: 75, state: 'planned' },
    ] },
  { company: 'milanoseta', owner: 'europe', type: 'mou', sector: 'silk', area: 'export', status: 'mou_signed',
    title: 'Экспорт шёлка-сырца из Ферганской долины в Италию', amount: 1_850_000, currency: 'EUR',
    description: 'Меморандум о намерениях по поставкам шёлка-сырца сортов 3А и 4А для производства тканей премиального сегмента.',
    contacts: [{ full_name: 'Джулия Росси', position: 'Руководитель отдела снабжения', phone: '+39 031 555-880', email: 'g.rossi@milanoseta.example' }],
    steps: [
      { title: 'Отправка образцов шёлка-сырца (5 партий)', due: -35, state: 'done' },
      { title: 'Лабораторные испытания на стороне партнёра', due: -8, state: 'done' },
      { title: 'Согласование ценовой формулы и условий Incoterms', due: -3, state: 'in_progress' },
      { title: 'Подписание экспортного контракта', due: 40, state: 'planned' },
    ] },
  { company: 'anadolu', owner: 'europe', type: 'project', sector: 'textile', area: 'investment', status: 'negotiation',
    title: 'Совместное прядильное производство в Наманганской области', amount: 28_000_000, currency: 'USD',
    description: 'Инвестиционный проект: прядильная фабрика мощностью 12 000 тонн пряжи в год, около 600 рабочих мест.',
    contacts: [{ full_name: 'Мехмет Йылмаз', position: 'Член правления', phone: '+90 224 555-70-10', email: 'm.yilmaz@anadolu-tekstil.example' }],
    steps: [
      { title: 'Подготовка инвестиционного предложения и площадки', due: -15, state: 'done' },
      { title: 'Технический визит делегации инвестора', due: 18, state: 'planned' },
      { title: 'Подписание меморандума о намерениях', due: 55, state: 'planned' },
    ] },
  { company: 'volgatex', owner: 'cis', type: 'contract', sector: 'textile', area: 'export', status: 'implementation',
    title: 'Поставка хлопчатобумажных тканей в Российскую Федерацию', amount: 6_300_000, currency: 'USD',
    description: 'Действующий контракт: бязь, поплин, сатин. Ежемесячные отгрузки железнодорожным транспортом.',
    contacts: [{ full_name: 'Смирнов Андрей Петрович', position: 'Коммерческий директор', phone: '+7 4932 55-11-22', email: 'a.smirnov@volgatex.example' }],
    steps: [
      { title: 'Отгрузка партии за I квартал', due: -75, state: 'done' },
      { title: 'Отгрузка партии за II квартал', due: -12, state: 'done' },
      { title: 'Сверка взаиморасчётов за первое полугодие', due: -5, state: 'planned' },
      { title: 'Отгрузка партии за III квартал', due: 30, state: 'planned' },
    ] },
  { company: 'almatytex', owner: 'cis', type: 'agreement', sector: 'textile', area: 'export', status: 'agreement_signed',
    title: 'Поставка трикотажного полотна для производства спецодежды', amount: 970_000, currency: 'USD',
    description: 'Рамочное соглашение на поставку трикотажного полотна плотностью 180–240 г/м².',
    contacts: [{ full_name: 'Нурлан Ахметов', position: 'Генеральный директор', phone: '+7 727 555-30-40', email: 'n.akhmetov@almatytex.example' }],
    steps: [
      { title: 'Подписание рамочного соглашения', due: -40, state: 'done' },
      { title: 'Согласование графика поставок на полугодие', due: 8, state: 'in_progress' },
    ] },
  { company: 'gulfhome', owner: 'me', type: 'contract', sector: 'textile', area: 'export', status: 'implementation',
    title: 'Поставка домашнего текстиля в сети ОАЭ и стран Залива', amount: 3_400_000, currency: 'USD',
    description: 'Поставки в гипермаркеты шести стран Персидского залива. Требование — халяльная сертификация упаковки.',
    contacts: [{ full_name: 'Ахмед Аль-Мансури', position: 'Директор по развитию', phone: '+971 4 555-99-00', email: 'a.almansouri@gulfhome.example' }],
    steps: [
      { title: 'Получение сертификатов соответствия ОАЭ', due: -50, state: 'done' },
      { title: 'Пробная партия в 3 гипермаркета', due: -18, state: 'done' },
      { title: 'Расширение ассортимента до 40 позиций', due: 25, state: 'planned' },
    ] },
  { company: 'riyadhknit', owner: 'me', type: 'project', sector: 'textile', area: 'investment', status: 'negotiation',
    title: 'Швейное производство в Андижанской области', amount: 15_500_000, currency: 'USD',
    description: 'Инвестиционный проект по созданию швейного предприятия полного цикла на 900 рабочих мест.',
    contacts: [{ full_name: 'Халид Аль-Отайби', position: 'Управляющий партнёр', phone: '+966 11 555-44-33', email: 'k.alotaibi@riyadhknit.example' }],
    steps: [
      { title: 'Презентация инвестиционных условий и льгот СЭЗ', due: -22, state: 'done' },
      { title: 'Подготовка технико-экономического обоснования', due: -2, state: 'in_progress' },
      { title: 'Визит инвестора на площадку', due: 33, state: 'planned' },
    ] },
  { company: 'delhicotton', owner: 'southasia', type: 'mou', sector: 'textile', area: 'investment', status: 'mou_signed',
    title: 'Совместное предприятие по глубокой переработке хлопка', amount: 9_800_000, currency: 'USD',
    description: 'Меморандум о создании СП по переработке хлопкового волокна с индийским партнёром.',
    contacts: [{ full_name: 'Раджеш Шарма', position: 'Исполнительный директор', phone: '+91 11 5555-2020', email: 'r.sharma@delhicotton.example' }],
    steps: [
      { title: 'Подписание меморандума', due: -70, state: 'done' },
      { title: 'Определение доли сторон и структуры СП', due: -10, state: 'in_progress' },
      { title: 'Регистрация совместного предприятия', due: 60, state: 'planned' },
    ] },
  { company: 'shandong', owner: 'eastasia', type: 'contract', sector: 'silk', area: 'export', status: 'implementation',
    title: 'Экспорт шёлка-сырца в Китайскую Народную Республику', amount: 12_600_000, currency: 'USD',
    description: 'Крупнейший экспортный контракт по шёлку. Поставки коконов и шёлка-сырца.',
    contacts: [{ full_name: 'Ли Вэй', position: 'Заместитель генерального директора', phone: '+86 531 5555-6060', email: 'li.wei@shandong-silk.example' }],
    steps: [
      { title: 'Поставка первой партии (сезон весна)', due: -90, state: 'done' },
      { title: 'Инспекция качества представителями покупателя', due: -30, state: 'done' },
      { title: 'Поставка второй партии (сезон осень)', due: 20, state: 'planned' },
      { title: 'Переговоры о продлении контракта на 2027 год', due: 90, state: 'planned' },
    ] },
  { company: 'seoulfashion', owner: 'eastasia', type: 'agreement', sector: 'textile', area: 'export', status: 'agreement_signed',
    title: 'Поставка готовой одежды в Республику Корея', amount: 2_100_000, currency: 'USD',
    description: 'Соглашение о поставке трикотажных изделий под собственной торговой маркой покупателя.',
    contacts: [{ full_name: 'Ким Мин Джун', position: 'Менеджер по закупкам', phone: '+82 2 5555-7788', email: 'mj.kim@seoulfashion.example' }],
    steps: [
      { title: 'Утверждение образцов коллекции', due: -25, state: 'done' },
      { title: 'Запуск производства первой партии', due: 5, state: 'in_progress' },
    ] },
  { company: 'vietgarment', owner: 'apac', type: 'project', sector: 'textile', area: 'export', status: 'negotiation',
    title: 'Поставка пряжи и трикотажного полотна во Вьетнам', amount: 1_450_000, currency: 'USD',
    description: 'Проработка поставок пряжи Ne 30 и трикотажного полотна для швейных фабрик Вьетнама.',
    contacts: [{ full_name: 'Нгуен Ван Хунг', position: 'Директор по снабжению', phone: '+84 28 5555-1212', email: 'hung.nguyen@vietgarment.example' }],
    steps: [
      { title: 'Отправка образцов пряжи', due: -12, state: 'done' },
      { title: 'Согласование логистической схемы через Китай', due: 15, state: 'planned' },
    ] },
  { company: 'atlantic', owner: 'namerica', type: 'project', sector: 'textile', area: 'export', status: 'negotiation',
    title: 'Выход на розничный рынок США: сертификация устойчивого хлопка', amount: 5_600_000, currency: 'USD',
    description: 'Требуется подтверждение соответствия стандартам устойчивого производства и социального аудита.',
    contacts: [{ full_name: 'Джон Миллер', position: 'Вице-президент по закупкам', phone: '+1 212 555-0180', email: 'j.miller@atlanticapparel.example' }],
    steps: [
      { title: 'Подготовка пакета документов по социальному аудиту', due: -6, state: 'in_progress' },
      { title: 'Аудит производственных площадок', due: 45, state: 'planned' },
      { title: 'Пробная поставка', due: 110, state: 'planned' },
    ] },
  { company: 'saopaulo', owner: 'latam', type: 'mou', sector: 'textile', area: 'export', status: 'negotiation',
    title: 'Поставка махровых изделий в Бразилию', amount: 780_000, currency: 'USD',
    description: 'Проработка поставок махровых полотенец и халатов. Основной вопрос — логистика и таможенные пошлины.',
    contacts: [{ full_name: 'Карлос Оливейра', position: 'Директор по импорту', phone: '+55 11 5555-3030', email: 'c.oliveira@spTextil.example' }],
    steps: [
      { title: 'Расчёт стоимости логистики через порт Сантос', due: -3, state: 'planned' },
      { title: 'Отправка образцов', due: 28, state: 'planned' },
    ] },
  { company: 'cairotex', owner: 'africa', type: 'agreement', sector: 'textile', area: 'export', status: 'on_hold',
    title: 'Поставка тканей в Египет с реэкспортом в Северную Африку', amount: 640_000, currency: 'USD',
    description: 'Проект приостановлен до урегулирования вопросов валютных расчётов на стороне партнёра.',
    contacts: [{ full_name: 'Мохамед Хассан', position: 'Владелец', phone: '+20 2 5555-4040', email: 'm.hassan@cairotex.example' }],
    steps: [{ title: 'Ожидание решения по валютным расчётам', due: 20, state: 'planned' }] },
  { company: 'capeleather', owner: 'africa', type: 'contract', sector: 'leather', area: 'export', status: 'agreement_signed',
    title: 'Экспорт выделанной кожи в ЮАР', amount: 1_120_000, currency: 'USD',
    description: 'Контракт на поставку выделанной кожи КРС для производства кожгалантереи.',
    contacts: [{ full_name: 'Питер ван дер Мерве', position: 'Генеральный директор', phone: '+27 21 555-5050', email: 'p.vdmerwe@capeleather.example' }],
    steps: [
      { title: 'Подписание контракта', due: -30, state: 'done' },
      { title: 'Первая отгрузка (2 контейнера)', due: 10, state: 'planned' },
    ] },
];

const projectIds = {};
transaction(() => {
  for (const project of PROJECTS) {
    const ownerId = U(project.owner);
    const companyId = companies[project.company];
    const company = COMPANIES.find((c) => c.key === project.company);
    const code = nextCode('PRJ', 'projects');
    const createdOffset = -(30 + Math.floor(Math.random() * 120));
    const created = new Date(Date.now() + createdOffset * 86400000).toISOString().slice(0, 19).replace('T', ' ');

    const result = run(
      `INSERT INTO projects (code, record_type, sector_code, area, country_id, company_id, title, description,
         amount, currency, responsible_user_id, status_code, created_by, updated_by, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code, project.type, project.sector, project.area, countryId(company.iso2), companyId,
      project.title, project.description, project.amount, project.currency,
      ownerId, project.status, ownerId, ownerId, created, created,
      new Date(Date.now() - Math.floor(Math.random() * 25) * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    );
    const projectId = Number(result.lastInsertRowid);
    projectIds[project.company] = projectId;

    for (const contact of project.contacts) {
      run(
        `INSERT INTO contacts (entity_type, entity_id, full_name, position, phone, email)
         VALUES ('project', ?, ?, ?, ?, ?)`,
        projectId, contact.full_name, contact.position, contact.phone, contact.email
      );
    }
    run(
      'INSERT INTO project_status_history (project_id, from_status, to_status, comment, user_id, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
      projectId, project.status, 'Создание записи', ownerId, created
    );

    project.steps.forEach((step, index) => {
      const doneAt = step.state === 'done'
        ? new Date(Date.now() + (step.due - 1) * 86400000).toISOString().slice(0, 19).replace('T', ' ')
        : null;
      run(
        `INSERT INTO roadmap_steps (project_id, seq, title, due_date, responsible_user_id, state, done_at, done_by, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        projectId, index + 1, step.title, day(step.due), ownerId, step.state,
        doneAt, step.state === 'done' ? ownerId : null, ownerId, ownerId
      );
    });
  }
});

// --------------------------------------------------------------------------
// Визиты и встречи
// --------------------------------------------------------------------------
const VISITS = [
  { owner: 'europe', direction: 'outbound', iso2: 'DE', cities: 'Гамбург, Дюссельдорф', from: 14, to: 18, status: 'confirmed',
    goal: 'Участие в выставке Heimtextil и переговоры с действующими и потенциальными покупателями домашнего текстиля.',
    members: [
      { key: 'admin', organization: 'Министерство инвестиций, промышленности и торговли', position: 'Руководитель делегации' },
      { key: 'europe', organization: 'Проектный офис', position: 'Проектный менеджер' },
      { name: 'Шодиев Фаррух Абдуллаевич', organization: 'АО «Узбектекстиль»', position: 'Заместитель председателя правления' },
    ],
    meetings: [
      { company: 'textilhandel', date: 14, time: '10:00', venue: 'Офис компании, Гамбург', status: 'arranged', participants: 'К. Вебер, Д. Каримова', notes: 'Обсуждение объёмов на 2027 год.' },
      { company: null, name: 'Торгово-промышленная палата Гамбурга', date: 15, time: '14:30', venue: 'ТПП Гамбурга', status: 'arranged', participants: 'Делегация в полном составе' },
      { company: null, name: 'Heimtextil — деловая программа', date: 16, time: '09:00', venue: 'Выставочный центр, Дюссельдорф', status: 'tbc' },
      { company: null, name: 'Rheinland Home Collection GmbH', date: 17, time: '11:00', venue: 'Дюссельдорф', status: 'tbc', notes: 'Ожидается подтверждение от партнёра.' },
    ] },
  { owner: 'me', direction: 'outbound', iso2: 'AE', cities: 'Дубай, Абу-Даби', from: 4, to: 7, status: 'confirmed',
    goal: 'Переговоры с розничными сетями Персидского залива и презентация инвестиционных возможностей текстильной отрасли.',
    members: [
      { key: 'me', organization: 'Проектный офис', position: 'Руководитель делегации' },
      { name: 'Азимова Гулнора Рустамовна', organization: 'Торгпредство Республики Узбекистан в ОАЭ', position: 'Торговый представитель' },
    ],
    meetings: [
      { company: 'gulfhome', date: 4, time: '11:00', venue: 'Dubai Design District', status: 'arranged', participants: 'А. Аль-Мансури, С. Рахимов' },
      { company: null, name: 'Dubai Chamber of Commerce', date: 5, time: '15:00', venue: 'Дубай', status: 'arranged' },
      { company: null, name: 'Abu Dhabi Investment Office', date: 6, time: '10:30', venue: 'Абу-Даби', status: 'tbc', notes: 'Уточняется состав участников со стороны партнёра.' },
    ] },
  { owner: 'eastasia', direction: 'inbound', iso2: 'CN', cities: 'Ташкент, Маргилан', from: 26, to: 29, status: 'planned',
    goal: 'Приём делегации китайских покупателей шёлка: инспекция производств в Ферганской долине.',
    members: [
      { key: 'eastasia', organization: 'Проектный офис', position: 'Сопровождение делегации' },
      { key: 'admin', organization: 'Проектный офис', position: 'Руководитель Проектного офиса' },
    ],
    meetings: [
      { company: 'shandong', date: 26, time: '10:00', venue: 'Министерство, Ташкент', status: 'arranged', participants: 'Ли Вэй и делегация из 6 человек' },
      { company: null, name: 'Маргиланский шёлковый комбинат', date: 27, time: '11:00', venue: 'Маргилан', status: 'arranged' },
      { company: null, name: 'Шелководческие хозяйства Ферганской области', date: 28, time: '09:30', venue: 'Фергана', status: 'tbc' },
    ] },
  { owner: 'cis', direction: 'outbound', iso2: 'RU', cities: 'Москва, Иваново', from: -22, to: -18, status: 'completed',
    goal: 'Сверка взаиморасчётов с действующими покупателями и участие в отраслевой выставке «Текстильлегпром».',
    outcome: 'Подтверждены объёмы поставок на III квартал. Достигнута договорённость о расширении ассортимента на 12 позиций. Подписан протокол о намерениях с двумя новыми дистрибьюторами.',
    members: [
      { key: 'cis', organization: 'Проектный офис', position: 'Руководитель делегации' },
      { name: 'Юлдашев Азиз Каримович', organization: 'АО «Узбектекстиль»', position: 'Начальник отдела экспорта' },
    ],
    meetings: [
      { company: 'volgatex', date: -21, time: '10:00', venue: 'Иваново', status: 'held', participants: 'А. Смирнов, Б. Юсупов', notes: 'Сверка расчётов проведена, расхождений нет.' },
      { company: null, name: 'Выставка «Текстильлегпром»', date: -19, time: '10:00', venue: 'Москва, Экспоцентр', status: 'held' },
    ] },
  { owner: 'southasia', direction: 'outbound', iso2: 'IN', cities: 'Нью-Дели, Мумбаи', from: 40, to: 45, status: 'planned',
    goal: 'Согласование структуры совместного предприятия по глубокой переработке хлопка.',
    members: [{ key: 'southasia', organization: 'Проектный офис', position: 'Руководитель делегации' }],
    meetings: [
      { company: 'delhicotton', date: 41, time: '10:00', venue: 'Нью-Дели', status: 'tbc' },
      { company: null, name: 'Confederation of Indian Textile Industry', date: 43, time: '14:00', venue: 'Мумбаи', status: 'tbc' },
    ] },
];

transaction(() => {
  for (const visit of VISITS) {
    const ownerId = U(visit.owner);
    const code = nextCode('VIS', 'visits');
    const result = run(
      `INSERT INTO visits (code, direction, country_id, cities, date_from, date_to, status_code, goal, outcome,
         responsible_user_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      code, visit.direction, countryId(visit.iso2), visit.cities, day(visit.from), day(visit.to),
      visit.status, visit.goal, visit.outcome || '', ownerId, ownerId, ownerId
    );
    const visitId = Number(result.lastInsertRowid);

    for (const member of visit.members) {
      const userId = member.key ? U(member.key) : null;
      const fullName = userId ? get('SELECT full_name FROM users WHERE id = ?', userId).full_name : member.name;
      run(
        'INSERT INTO visit_members (visit_id, user_id, full_name, organization, position) VALUES (?, ?, ?, ?, ?)',
        visitId, userId, fullName, member.organization || '', member.position || ''
      );
    }

    for (const meeting of visit.meetings) {
      const companyId = meeting.company ? companies[meeting.company] : null;
      const companyName = companyId
        ? COMPANIES.find((c) => c.key === meeting.company).name
        : meeting.name;
      run(
        `INSERT INTO meetings (visit_id, company_id, company_name, project_id, meet_date, meet_time, venue,
           status_code, participants, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        visitId, companyId, companyName,
        meeting.company ? projectIds[meeting.company] ?? null : null,
        day(meeting.date), meeting.time || '', meeting.venue || '',
        meeting.status, meeting.participants || '', meeting.notes || '', ownerId, ownerId
      );
    }
  }
});

// --------------------------------------------------------------------------
// Комментарии, произвольное поле «голосование», заявка на исправление
// --------------------------------------------------------------------------
transaction(() => {
  const comments = [
    ['shandong', 'eastasia', 'Партнёр подтвердил приезд инспекционной группы. Готовим программу посещения комбината в Маргилане.'],
    ['shandong', 'admin', 'Прошу подготовить справку по объёмам за прошлый сезон к совещанию у заместителя министра.'],
    ['anadolu', 'europe', 'Инвестор запросил данные по стоимости электроэнергии и наличию подготовленных кадров в регионе. Направил запрос в хокимият.'],
    ['atlantic', 'namerica', 'Покупатель настаивает на аудите по стандарту SA8000. Уточняю у производителей готовность пройти сертификацию.'],
    ['milanoseta', 'europe', 'Результаты лабораторных испытаний положительные: сорт 4А полностью соответствует требованиям партнёра.'],
    ['volgatex', 'cis', 'Сверка расчётов за первое полугодие проведена во время визита, расхождений не выявлено.'],
  ];
  for (const [companyKey, userKey, body] of comments) {
    run(
      'INSERT INTO comments (entity_type, entity_id, user_id, body) VALUES (?, ?, ?, ?)',
      'project', projectIds[companyKey], U(userKey), body
    );
  }

  const pollResult = run(
    `INSERT INTO custom_fields (form, field_key, label_ru, label_uz, label_en, type, required, help_text, options_json, position, team_can_fill, created_by)
     VALUES ('project', 'priority_vote', 'Приоритет проекта (голосование офиса)', 'Loyiha ustuvorligi', 'Project priority (office vote)',
             'poll', 0, 'Сотрудники офиса оценивают приоритетность проекта для планирования ресурсов.',
             ?, 1, 1, ?)`,
    JSON.stringify(['Высокий', 'Средний', 'Низкий']), U('admin')
  );
  const pollFieldId = Number(pollResult.lastInsertRowid);
  const votes = [['anadolu', 'admin', 'Высокий'], ['anadolu', 'europe', 'Высокий'], ['anadolu', 'cis', 'Средний']];
  for (const [companyKey, userKey, option] of votes) {
    run(
      'INSERT INTO poll_votes (field_id, entity_type, entity_id, user_id, option) VALUES (?, ?, ?, ?, ?)',
      pollFieldId, 'project', projectIds[companyKey], U(userKey), option
    );
  }

  run(
    `INSERT INTO custom_fields (form, field_key, label_ru, label_uz, label_en, type, required, help_text, options_json, position, team_can_fill, created_by)
     VALUES ('project', 'support_measure', 'Мера государственной поддержки', 'Davlat qollab-quvvatlash chorasi', 'State support measure',
             'select', 0, 'Указывается, если по проекту предусмотрена мера поддержки.', ?, 2, 1, ?)`,
    JSON.stringify(['Не требуется', 'Экспортная субсидия', 'Льготный кредит', 'Налоговые преференции СЭЗ', 'Компенсация транспортных расходов']),
    U('admin')
  );

  run(
    `INSERT INTO correction_requests (entity_type, entity_id, entity_label, requested_by, reason, proposed_json)
     VALUES ('project', ?, ?, ?, ?, ?)`,
    projectIds.saopaulo, 'Поставка махровых изделий в Бразилию', U('latam'),
    'При создании записи ошибочно указана сумма 780 000 USD вместо 870 000 USD — опечатка в порядке цифр. Прошу исправить поле «Сумма».',
    JSON.stringify({ amount: 870000 })
  );

  run(
    `INSERT INTO saved_filters (user_id, entity, name, query_json, is_shared)
     VALUES (?, 'projects', 'Просроченные этапы', ?, 1)`,
    U('admin'), JSON.stringify({ overdue: '1' })
  );
  run(
    `INSERT INTO saved_filters (user_id, entity, name, query_json, is_shared)
     VALUES (?, 'projects', 'Инвестиции — в реализации', ?, 1)`,
    U('admin'), JSON.stringify({ area: 'investment', status: 'implementation' })
  );
});

const counts = {
  Пользователи: all('SELECT id FROM users').length,
  Компании: all('SELECT id FROM companies').length,
  Проекты: all('SELECT id FROM projects').length,
  'Этапы дорожных карт': all('SELECT id FROM roadmap_steps').length,
  Визиты: all('SELECT id FROM visits').length,
  Встречи: all('SELECT id FROM meetings').length,
};

console.log('\nДемонстрационные данные созданы:');
for (const [label, value] of Object.entries(counts)) console.log(`   ${label}: ${value}`);
console.log(`\n   Вход в систему: admin@textile.gov.uz / ${DEMO_PASSWORD}`);
console.log(`   Проектный менеджер: europe@textile.gov.uz / ${DEMO_PASSWORD}\n`);

'use strict';
/** Инициализация справочников и настроек по умолчанию (идемпотентно). */
const { run, get, all, transaction, getSetting, setSetting } = require('./db');
const { REGIONS, COUNTRIES } = require('./data/geo');

const DICTIONARIES = {
  sector: [
    { code: 'textile', name_ru: 'Текстиль',        name_uz: 'Toqimachilik', name_en: 'Textile', color: '#1f4e9e' },
    { code: 'silk',    name_ru: 'Шёлк',            name_uz: 'Ipak',         name_en: 'Silk',    color: '#8a5cf0' },
    { code: 'leather', name_ru: 'Кожа и обувь',    name_uz: 'Charm va poyabzal', name_en: 'Leather & Footwear', color: '#a5791f' },
  ],
  record_type: [
    { code: 'project',   name_ru: 'Проект',              name_uz: 'Loyiha',      name_en: 'Project' },
    { code: 'agreement', name_ru: 'Соглашение',          name_uz: 'Bitim',       name_en: 'Agreement' },
    { code: 'mou',       name_ru: 'Меморандум (MoU)',    name_uz: 'Memorandum',  name_en: 'Memorandum' },
    { code: 'contract',  name_ru: 'Контракт',            name_uz: 'Shartnoma',   name_en: 'Contract' },
  ],
  project_status: [
    { code: 'negotiation',      name_ru: 'Переговоры',              name_uz: 'Muzokaralar',       name_en: 'Negotiation',       color: '#6b7ba3' },
    { code: 'mou_signed',       name_ru: 'Подписан меморандум',     name_uz: 'Memorandum imzolandi', name_en: 'MoU signed',     color: '#8a5cf0' },
    { code: 'agreement_signed', name_ru: 'Подписано соглашение',    name_uz: 'Bitim imzolandi',   name_en: 'Agreement signed',  color: '#1f4e9e' },
    { code: 'implementation',   name_ru: 'В реализации',            name_uz: 'Amalga oshirilmoqda', name_en: 'In implementation', color: '#0f8a6a' },
    { code: 'completed',        name_ru: 'Завершён',                name_uz: 'Yakunlangan',       name_en: 'Completed',         color: '#2e7d4f' },
    { code: 'on_hold',          name_ru: 'Приостановлен',           name_uz: 'Toxtatilgan',       name_en: 'On hold',           color: '#b3661a' },
    { code: 'cancelled',        name_ru: 'Отменён',                 name_uz: 'Bekor qilingan',    name_en: 'Cancelled',         color: '#a33a3a' },
  ],
  visit_status: [
    { code: 'planned',     name_ru: 'Запланирован', name_uz: 'Rejalashtirilgan', name_en: 'Planned',     color: '#6b7ba3' },
    { code: 'confirmed',   name_ru: 'Подтверждён',  name_uz: 'Tasdiqlangan',     name_en: 'Confirmed',   color: '#1f4e9e' },
    { code: 'in_progress', name_ru: 'Идёт',         name_uz: 'Davom etmoqda',    name_en: 'In progress', color: '#0f8a6a' },
    { code: 'completed',   name_ru: 'Завершён',     name_uz: 'Yakunlangan',      name_en: 'Completed',   color: '#2e7d4f' },
    { code: 'postponed',   name_ru: 'Перенесён',    name_uz: 'Kochirilgan',      name_en: 'Postponed',   color: '#b3661a' },
    { code: 'cancelled',   name_ru: 'Отменён',      name_uz: 'Bekor qilingan',   name_en: 'Cancelled',   color: '#a33a3a' },
  ],
  meeting_status: [
    { code: 'tbc',       name_ru: 'Уточняется', name_uz: 'Aniqlanmoqda',   name_en: 'TBC',       color: '#b3661a' },
    { code: 'arranged',  name_ru: 'Согласована', name_uz: 'Kelishilgan',   name_en: 'Arranged',  color: '#1f4e9e' },
    { code: 'held',      name_ru: 'Проведена',   name_uz: 'Otkazilgan',    name_en: 'Held',      color: '#2e7d4f' },
    { code: 'cancelled', name_ru: 'Отменена',    name_uz: 'Bekor qilingan', name_en: 'Cancelled', color: '#a33a3a' },
  ],
  currency: [
    { code: 'USD', name_ru: 'Доллар США (USD)', name_uz: 'AQSh dollari', name_en: 'US Dollar' },
    { code: 'EUR', name_ru: 'Евро (EUR)',       name_uz: 'Yevro',        name_en: 'Euro' },
    { code: 'UZS', name_ru: 'Сум (UZS)',        name_uz: 'Som',          name_en: 'Uzbek Sum' },
    { code: 'RUB', name_ru: 'Рубль (RUB)',      name_uz: 'Rubl',         name_en: 'Rouble' },
    { code: 'CNY', name_ru: 'Юань (CNY)',       name_uz: 'Yuan',         name_en: 'Yuan' },
    { code: 'TRY', name_ru: 'Турецкая лира (TRY)', name_uz: 'Turk lirasi', name_en: 'Turkish Lira' },
    { code: 'AED', name_ru: 'Дирхам ОАЭ (AED)', name_uz: 'Dirham',       name_en: 'UAE Dirham' },
    { code: 'GBP', name_ru: 'Фунт стерлингов (GBP)', name_uz: 'Funt sterling', name_en: 'Pound Sterling' },
    { code: 'KRW', name_ru: 'Вона (KRW)',       name_uz: 'Vona',         name_en: 'Won' },
    { code: 'JPY', name_ru: 'Иена (JPY)',       name_uz: 'Iyena',        name_en: 'Yen' },
  ],
};

// Приблизительные курсы к доллару США для сводных сумм на дашборде.
// Администратор может изменить их в разделе «Настройки».
const DEFAULT_RATES = {
  USD: 1, EUR: 1.09, UZS: 0.000079, RUB: 0.011, CNY: 0.14,
  TRY: 0.029, AED: 0.272, GBP: 1.27, KRW: 0.00073, JPY: 0.0066,
};

const DEFAULT_SETTINGS = {
  'reminders.days_before': [7, 3, 1],
  'reminders.escalate_overdue': true,
  'reminders.digest_weekday': 1,          // понедельник
  'reminders.digest_hour': 8,             // 08:00 по Ташкенту
  'projects.stale_days': 30,
  'security.session_timeout_minutes': 30,
  'security.require_2fa': false,
  'recycle_bin.retention_days': 30,
  'attention.meeting_tbc_days': 7,
  'currency.rates_to_usd': DEFAULT_RATES,
  'org.name': 'Проектный офис заместителя министра по текстильной промышленности',
  'org.ministry': 'Министерство инвестиций, промышленности и торговли Республики Узбекистан',
};

function ensureReference() {
  transaction(() => {
    for (const region of REGIONS) {
      run(
        `INSERT INTO regions (code, name_ru, name_uz, name_en, sort) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name_ru = excluded.name_ru, name_uz = excluded.name_uz,
           name_en = excluded.name_en, sort = excluded.sort`,
        region.code, region.name_ru, region.name_uz, region.name_en, region.sort
      );
    }

    for (const [regionCode, list] of Object.entries(COUNTRIES)) {
      const region = get('SELECT id FROM regions WHERE code = ?', regionCode);
      if (!region) continue;
      for (const [iso2, ru, uz, en] of list) {
        run(
          `INSERT INTO countries (iso2, name_ru, name_uz, name_en, region_id) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(iso2) DO UPDATE SET name_ru = excluded.name_ru, name_uz = excluded.name_uz,
             name_en = excluded.name_en, region_id = excluded.region_id`,
          iso2, ru, uz, en, region.id
        );
      }
    }

    for (const [kind, items] of Object.entries(DICTIONARIES)) {
      items.forEach((item, index) => {
        run(
          `INSERT INTO dictionaries (kind, code, name_ru, name_uz, name_en, color, sort, is_system)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(kind, code) DO NOTHING`,
          kind, item.code, item.name_ru, item.name_uz || '', item.name_en || '', item.color || '', index + 1
        );
      });
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (getSetting(key, undefined) === undefined) setSetting(key, value);
    }
  });
}

const listRegions = () => all('SELECT * FROM regions ORDER BY sort');
const listCountries = () =>
  all(`SELECT c.*, r.code AS region_code, r.name_ru AS region_name
       FROM countries c JOIN regions r ON r.id = c.region_id
       WHERE c.is_active = 1 ORDER BY c.name_ru`);
const listDictionary = (kind, includeInactive = false) =>
  all(
    `SELECT * FROM dictionaries WHERE kind = ?${includeInactive ? '' : ' AND is_active = 1'} ORDER BY sort, id`,
    kind
  );

module.exports = { ensureReference, listRegions, listCountries, listDictionary, DICTIONARIES, DEFAULT_SETTINGS, DEFAULT_RATES };

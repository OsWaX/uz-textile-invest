# Модель данных

Схема описана стандартным SQL в файле `server/db.js` (константа `SCHEMA`) и
создаётся при первом запуске. Все определения выполняются с
`CREATE TABLE IF NOT EXISTS`, поэтому повторный запуск безопасен.

## Основные сущности

```
regions ──< countries ──< projects >── companies
                            │              │
                            │              └──< contacts (entity_type='company')
                            ├──< roadmap_steps
                            ├──< project_status_history
                            ├──< contacts (entity_type='project')
                            ├──< comments
                            ├──< attachments
                            └──< custom_values >── custom_fields

regions ──< countries ──< visits ──< visit_members
                             └──< meetings >── companies
                                      └────── projects

users ──< sessions
  ├──< notifications ──< notification_deliveries
  ├──< audit_log
  ├──< correction_requests
  ├──< saved_filters
  └──< poll_votes
```

## Таблицы

### Справочники

| Таблица | Назначение |
|---|---|
| `regions` | Девять регионов ответственности проектных менеджеров |
| `countries` | Страны с привязкой к региону; регион проекта выводится отсюда |
| `dictionaries` | Универсальный справочник: `kind` = `sector`, `record_type`, `project_status`, `visit_status`, `meeting_status`, `currency` |
| `settings` | Настройки в формате «ключ — значение JSON» |

### Пользователи и доступ

| Таблица | Ключевые поля |
|---|---|
| `users` | `role` (`admin`/`team`/`viewer`), `region_id`, `password_hash` + `password_salt` (scrypt), `totp_secret`, `failed_attempts`, `locked_until`, настройки каналов уведомлений |
| `sessions` | Идентификатор сессии, `last_seen_at` для тайм-аута бездействия, `revoked` |

Пароль в открытом виде не хранится нигде. Cookie сессии содержит только
идентификатор и подпись HMAC-SHA256.

### Проекты (раздел 3 ТЗ)

`projects` — поля P-01…P-15: `record_type`, `sector_code`, `area`
(`export`/`investment`), `country_id`, `company_id`, `title`, `amount` +
`currency`, `responsible_user_id`, `status_code`, системные поля создания и
изменения, `last_activity_at` для признака «замершего» проекта.

`roadmap_steps` — этапы дорожной карты: `seq`, `title`, `due_date`,
`responsible_user_id`, `state` (`planned`/`in_progress`/`done`), `done_at`,
`done_by`, `done_comment`.

> Состояние «просрочен» из ТЗ не хранится в базе, а вычисляется как
> `state <> 'done' AND due_date < текущая дата`. Это исключает расхождение между
> хранимым признаком и фактическим сроком.

`project_status_history` — история смены статусов с автором, временем и комментарием.

### Компании (раздел 4 ТЗ)

`companies` — карточка компании; `merged_into_id` указывает на основную запись
после объединения дубликатов. `contacts` — контактные лица компаний и проектов
(различаются полем `entity_type`).

### Визиты (раздел 5 ТЗ)

`visits` — поля V-01…V-10. `visit_members` — состав делегации: сотрудники
(`user_id`) и внешние участники (только `full_name`). `meetings` — встречи с
привязкой к компании (`company_id`) и, при необходимости, к проекту (`project_id`).

### Общие механизмы

| Таблица | Назначение |
|---|---|
| `comments` | Лента комментариев, только добавление; `mentions` — JSON с id упомянутых |
| `attachments` | Вложения с версионностью: `version`, `is_current`; файл на диске — `stored_name` |
| `custom_fields`, `custom_values` | Конструктор форм; значения хранятся как JSON |
| `poll_votes` | Голоса по полям типа «голосование», один голос на сотрудника |
| `correction_requests` | Заявки на исправление (п. 2.3 ТЗ) |
| `notifications`, `notification_deliveries` | Уведомления и результат доставки по каналам |
| `audit_log` | Журнал аудита; `changes_json` — массив `{field, label, from, to}` |
| `saved_filters` | Сохранённые выборки, личные и общие |

## Мягкое удаление

Записи проектов, компаний, визитов, встреч и этапов не удаляются физически:
устанавливается `is_deleted = 1` и `deleted_at`. Это и есть корзина, из которой
администратор восстанавливает записи. Окончательное удаление выполняется вручную
либо автоматически по истечении срока хранения при запуске приложения.

Все выборки содержат условие `is_deleted = 0`.

## Индексы

Индексы созданы по внешним ключам и полям фильтрации: статус, страна, компания,
ответственный, признак удаления, срок этапа, даты визитов, дата встречи, а также
по типу и идентификатору записи для комментариев, вложений и журнала аудита.
Этого достаточно для заявленной в ТЗ ёмкости — 10 000 проектов и 50 пользователей.

## Время

Все отметки времени хранятся в **UTC** (`datetime('now')` в SQLite). Отображение
и выгрузки приводятся ко времени Ташкента (UTC+5) — требование раздела 11 ТЗ.
Даты без времени (сроки этапов, даты визитов) хранятся строкой `ГГГГ-ММ-ДД`.

## Перенос на PostgreSQL

ТЗ рекомендует PostgreSQL. Схема написана переносимо; при переходе требуются
следующие замены:

| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY` | `BIGSERIAL PRIMARY KEY` |
| `TEXT NOT NULL DEFAULT (datetime('now'))` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `INTEGER` для логических значений | `BOOLEAN` |
| `REAL` для сумм | `NUMERIC(18,2)` |
| `date('now', '-30 day')` | `current_date - interval '30 day'` |
| `strftime('%Y-%m', x)` | `to_char(x, 'YYYY-MM')` |
| `julianday(a) - julianday(b)` | `(a::date - b::date)` |
| `COLLATE NOCASE` | `CITEXT` либо уникальный индекс по `lower(email)` |

Прикладной код обращается к базе через тонкий слой `server/db.js`
(`all`, `get`, `run`, `transaction`), поэтому при переходе меняется только этот
модуль и перечисленные выражения в SQL-запросах. Структура таблиц, связи и
логика прав остаются прежними.

Условный уникальный индекс `idx_notifications_dedupe` (`WHERE dedupe_key <> ''`)
поддерживается обеими СУБД.

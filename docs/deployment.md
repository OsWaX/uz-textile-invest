# Установка, эксплуатация и восстановление

Документ описывает развёртывание портала Проектного офиса, резервное копирование
и порядок восстановления. Требование раздела 11 ТЗ: система и её база данных
размещаются на серверах на территории Республики Узбекистан — в государственном
центре обработки данных либо у сертифицированного местного провайдера.

## 1. Требования к серверу

| Параметр | Минимум | Рекомендуется |
|---|---|---|
| Процессор | 2 ядра | 4 ядра |
| Оперативная память | 2 ГБ | 4 ГБ |
| Диск | 50 ГБ | 500 ГБ (расчёт по ТЗ: 100 000 файлов) |
| Операционная система | Linux с ядром 5.x | Ubuntu 22.04 LTS или Alma Linux 9 |
| Среда исполнения | Node.js 22.5+ либо Docker 24+ | Docker с docker compose |

Приложение не требует внешних пакетов из интернета: репозиторий содержит весь код.
Это позволяет устанавливать систему в закрытом контуре.

## 2. Установка через Docker (рекомендуется)

```bash
git clone https://github.com/OsWaX/uz-textile-invest.git
cd uz-textile-invest

cp .env.example .env
# Сформировать ключ подписи сессий:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Вписать его в SESSION_SECRET, задать ADMIN_PASSWORD и SECURE_COOKIES=1

docker compose up -d
docker compose logs -f portal
```

При первом запуске в журнале выводится пароль администратора, если
`ADMIN_PASSWORD` не был задан. Смените его при первом входе.

## 3. Установка без Docker

```bash
git clone https://github.com/OsWaX/uz-textile-invest.git /opt/uz-textile-portal
cd /opt/uz-textile-portal
cp .env.example .env    # заполнить SESSION_SECRET, SECURE_COOKIES=1
```

Служба systemd — файл `/etc/systemd/system/uz-textile-portal.service`:

```ini
[Unit]
Description=Портал Проектного офиса (текстильная промышленность)
After=network.target

[Service]
Type=simple
User=portal
WorkingDirectory=/opt/uz-textile-portal
Environment=NODE_ENV=production
Environment=TZ=Asia/Tashkent
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/uz-textile-portal/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/uz-textile-portal portal
sudo chown -R portal:portal /opt/uz-textile-portal
sudo systemctl daemon-reload
sudo systemctl enable --now uz-textile-portal
```

### Ввод в эксплуатацию: удаление демонстрационных данных

Если система разворачивалась из репозитория с демонстрационным наполнением
(`npm run seed`), перед началом реальной работы данные удаляются:

```bash
sudo systemctl stop uz-textile-portal
sudo -u portal npm run clean -- --all --yes
sudo systemctl start uz-textile-portal
```

Команда удаляет проекты, компании, визиты, встречи, контакты, файлы,
комментарии, уведомления, журнал аудита, поля конструктора форм и все учётные
записи, кроме одной учётной записи администратора. Справочники, настройки и
структура базы сохраняются. Перед удалением создаётся резервная копия
`data/portal-backup-<дата>.db` (отключается флагом `--no-backup`).

Если демонстрационные данные не загружались, ничего делать не нужно: при первом
запуске на пустой базе система сама создаёт схему, справочники и единственную
учётную запись администратора с паролем из `ADMIN_PASSWORD`.

### Развёртывание на облачных площадках

Порталу нужен постоянно работающий процесс и постоянный диск. Площадки, где
это возможно, запускают готовый `Dockerfile` из репозитория:

| Площадка | Файл настроек | Что учесть |
|---|---|---|
| Render | `render.yaml` | Диск доступен с платного плана; New → Blueprint |
| Fly.io | `fly.toml` | Том создаётся отдельной командой `fly volumes create` |
| Railway | настройка через интерфейс | Dockerfile определяется сам, том подключается вручную |

Обязательные переменные окружения на любой из них:

| Переменная | Значение |
|---|---|
| `SESSION_SECRET` | случайная строка не короче 32 символов |
| `ADMIN_PASSWORD` | пароль первой учётной записи администратора |
| `SECURE_COOKIES` | `1` — площадка отдаёт сайт по HTTPS |
| `PUBLIC_URL` | внешний адрес, например `https://portal.example.com` |
| `DB_PATH`, `UPLOAD_DIR` | пути внутри подключённого тома |

Экземпляр должен быть **ровно один**: база SQLite не рассчитана на запись из
нескольких процессов, а планировщик напоминаний работает внутри того же
процесса. Автоматическое масштабирование и «засыпание» контейнера отключаются.

Серверы всех перечисленных площадок расположены за пределами Узбекистана.
Раздел 11 ТЗ требует размещения системы и базы данных на территории
республики, поэтому облачные площадки пригодны для демонстрации и опытной
эксплуатации, а промышленная установка выполняется по разделам 2 и 3 выше.

### Площадки, на которых портал работать не будет

Vercel, Netlify, Cloudflare Pages и GitHub Pages рассчитаны на статические
сайты и короткоживущие функции. Портал на них не запускается, и обходного
пути нет:

- **нет постоянного диска.** База `data/portal.db` и загруженные документы
  хранятся в файловой системе. На таких площадках она доступна только для
  чтения, а временный каталог очищается и не общий для разных запросов —
  учётные записи, проекты и файлы исчезали бы между двумя нажатиями;
- **нет постоянного процесса.** Функция запускается на время одного запроса.
  Планировщик напоминаний (раздел 8 ТЗ) выполняться не будет;
- **раздел 11 ТЗ.** Размещение данных за пределами Узбекистана недопустимо
  для промышленной эксплуатации.

Попытка развернуть репозиторий на Vercel заканчивается ошибкой 404: сборка
не находит статического сайта, потому что его здесь нет — есть серверное
приложение. Для публичного адреса используйте Render, Fly.io, Railway или
собственный сервер; для быстрой демонстрации без развёртывания — GitHub
Codespaces (см. README).

## 4. HTTPS

Приложение работает по HTTP и рассчитано на обратный прокси, завершающий TLS.
Требование ТЗ — HTTPS на всех страницах. Пример конфигурации nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name portal.textile.gov.uz;

    ssl_certificate     /etc/ssl/certs/portal.crt;
    ssl_certificate_key /etc/ssl/private/portal.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 30m;      # запас к пределу вложения в 25 МБ

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name portal.textile.gov.uz;
    return 301 https://$host$request_uri;
}
```

В `.env` задайте `SECURE_COOKIES=1` и `PUBLIC_URL=https://portal.textile.gov.uz` —
иначе ссылки в письмах и сообщениях Telegram будут вести на localhost.

## 5. Резервное копирование

Требование ТЗ: ежедневные копии базы данных с хранением не менее 30 дней и
еженедельные полные копии с хранением не менее 6 месяцев.

При запуске через `docker compose` ежедневное копирование выполняет служба
`backup`; копии складываются в каталог `./backups`.

Ручное копирование (безопасно на работающей системе — используется команда
`.backup` SQLite, а не копирование файла):

```bash
STAMP=$(date +%Y-%m-%d_%H%M)
sqlite3 /opt/uz-textile-portal/data/portal.db ".backup '/backup/portal-$STAMP.db'"
tar -czf /backup/uploads-$STAMP.tar.gz -C /opt/uz-textile-portal/data uploads
```

Еженедельная полная копия и очистка устаревших — `/etc/cron.d/portal-backup`:

```cron
# ежедневно в 01:30 по Ташкенту
30 1 * * * portal sqlite3 /opt/uz-textile-portal/data/portal.db ".backup '/backup/daily/portal-$(date +\%F).db'" && find /backup/daily -mtime +30 -delete
# еженедельно в воскресенье в 02:00 — полная копия
0 2 * * 0 portal tar -czf /backup/weekly/full-$(date +\%F).tar.gz -C /opt/uz-textile-portal data && find /backup/weekly -mtime +190 -delete
```

## 6. Восстановление из копии

Порядок демонстрируется на тестовой среде во время приёмки (сценарий 9 ТЗ).

```bash
# 1. Остановить приложение
sudo systemctl stop uz-textile-portal      # или: docker compose stop portal

# 2. Сохранить текущее состояние на случай отката
mv /opt/uz-textile-portal/data/portal.db /opt/uz-textile-portal/data/portal.db.before-restore

# 3. Восстановить базу и вложения
cp /backup/daily/portal-2026-08-29.db /opt/uz-textile-portal/data/portal.db
tar -xzf /backup/uploads-2026-08-29.tar.gz -C /opt/uz-textile-portal/data

# 4. Проверить целостность базы
sqlite3 /opt/uz-textile-portal/data/portal.db "PRAGMA integrity_check;"   # ожидается: ok
sqlite3 /opt/uz-textile-portal/data/portal.db "SELECT COUNT(*) FROM projects;"

# 5. Восстановить права и запустить
sudo chown -R portal:portal /opt/uz-textile-portal/data
sudo systemctl start uz-textile-portal
```

После запуска войдите в систему и убедитесь, что число проектов и последние
записи журнала аудита соответствуют дате копии.

## 7. Обновление версии

```bash
cd /opt/uz-textile-portal
sqlite3 data/portal.db ".backup 'data/before-update.db'"   # копия перед обновлением
git pull
sudo systemctl restart uz-textile-portal
```

Схема базы данных обновляется автоматически при запуске: все определения таблиц
выполняются с `CREATE TABLE IF NOT EXISTS`, существующие данные не затрагиваются.

## 8. Наблюдение за работой

- Журнал приложения: `journalctl -u uz-textile-portal -f` или `docker compose logs -f portal`.
- Проверка доступности: HTTP-запрос `GET /` должен возвращать код 200.
- Ошибки доставки уведомлений фиксируются в таблице `notification_deliveries`.
- Действия пользователей — в журнале аудита (Администрирование → Журнал аудита).

## 9. Настройка каналов уведомлений

**Электронная почта.** Заполните `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`. Параметр `SMTP_SECURE` принимает значения
`starttls` (по умолчанию, порт 587), `tls` (порт 465) и `none`.

**Telegram.** Создайте бота через @BotFather, впишите токен в `TELEGRAM_BOT_TOKEN`
и перезапустите приложение. Каждый сотрудник указывает свой `chat_id` в профиле;
получить его можно, написав боту и открыв
`https://api.telegram.org/bot<ТОКЕН>/getUpdates`.

Если переменные не заданы, соответствующий канал отключается, а уведомления
продолжают поступать в центр уведомлений внутри системы.

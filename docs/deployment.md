# Установка, эксплуатация и восстановление

Документ описывает развёртывание портала Проектного офиса с PostgreSQL,
резервное копирование и порядок восстановления. Требование раздела 11 ТЗ:
система и её база данных размещаются на серверах на территории Республики
Узбекистан — в государственном центре обработки данных либо у сертифицированного
местного провайдера.

## 1. Требования к серверу

| Параметр | Минимум | Рекомендуется |
|---|---|---|
| Процессор | 2 ядра | 4 ядра |
| Оперативная память | 2 ГБ | 4 ГБ |
| Диск | 50 ГБ | 500 ГБ (расчёт по ТЗ: 100 000 файлов) |
| Операционная система | Ubuntu 22.04/24.04 LTS или Alma Linux 9 | Ubuntu 24.04 LTS |
| Среда исполнения | Node.js 22.5+ и PostgreSQL 14+ | Docker 24+ с docker compose |

## 2. Установка через Docker

Рекомендуемый вариант для VPS: приложение, PostgreSQL и ежедневный backup
запускаются через `docker compose`.

```bash
git clone https://github.com/OsWaX/uz-textile-invest.git
cd uz-textile-invest
cp .env.example .env
```

В `.env` задайте:

```env
POSTGRES_DB=uz_textile_portal
POSTGRES_USER=portal
POSTGRES_PASSWORD=<сложный пароль>
DATABASE_URL=postgres://portal:<сложный пароль>@postgres:5432/uz_textile_portal

SESSION_SECRET=<случайная строка 32+ символа>
ADMIN_EMAIL=admin@textile.gov.uz
ADMIN_PASSWORD=<первичный пароль администратора>

BIND_ADDR=127.0.0.1
HOST_PORT=8081
PUBLIC_URL=http://10.13.13.50
SECURE_COOKIES=0
```

Сгенерировать `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Запуск:

```bash
docker compose up -d --build
docker compose logs -f portal
```

Если нужна пустая рабочая база, `npm run seed` запускать не нужно. При первом
старте приложение создаст схему, справочники и одну учётную запись администратора
из `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Демо-данные можно загрузить вручную:

```bash
docker compose exec portal npm run seed
```

## 3. Nginx до включения DNS

Пока домен не резолвится, можно проксировать по IP:

```nginx
server {
    listen 80;
    server_name 10.13.13.50 87.192.227.52;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Проверка и перезапуск:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Когда DNS для `projectoffice.adli.uz` заработает, замените `server_name` на домен,
в `.env` поставьте:

```env
PUBLIC_URL=https://projectoffice.adli.uz
SECURE_COOKIES=1
```

Затем выпустите сертификат:

```bash
sudo certbot --nginx -d projectoffice.adli.uz
docker compose restart portal
```

## 4. Установка без Docker

```bash
sudo apt update
sudo apt install -y postgresql postgresql-client git nginx

sudo -u postgres psql
```

В `psql`:

```sql
CREATE USER portal WITH PASSWORD '<сложный пароль>';
CREATE DATABASE uz_textile_portal OWNER portal;
\q
```

Node.js 22 можно поставить через `nvm` для пользователя `portal` или через
системный пакетный репозиторий. После установки:

```bash
git clone https://github.com/OsWaX/uz-textile-invest.git /var/www/uz-textile-invest
cd /var/www/uz-textile-invest
cp .env.example .env
npm install
```

В `.env` для запуска без Docker:

```env
DATABASE_URL=postgres://portal:<сложный пароль>@127.0.0.1:5432/uz_textile_portal
PORT=8081
HOST=127.0.0.1
PUBLIC_URL=http://10.13.13.50
SECURE_COOKIES=0
SESSION_SECRET=<случайная строка 32+ символа>
ADMIN_PASSWORD=<первичный пароль администратора>
UPLOAD_DIR=/var/www/uz-textile-invest/data/uploads
BACKUP_DIR=/var/www/uz-textile-invest/backups
```

Служба systemd — файл `/etc/systemd/system/uz-textile-portal.service`:

```ini
[Unit]
Description=Портал Проектного офиса
After=network.target postgresql.service

[Service]
Type=simple
User=portal
WorkingDirectory=/var/www/uz-textile-invest
Environment=NODE_ENV=production
Environment=TZ=Asia/Tashkent
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/www/uz-textile-invest/data /var/www/uz-textile-invest/backups

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/www/uz-textile-invest portal || true
sudo chown -R portal:portal /var/www/uz-textile-invest
sudo systemctl daemon-reload
sudo systemctl enable --now uz-textile-portal
sudo journalctl -u uz-textile-portal -f
```

## 5. Очистка демонстрационных данных

Если загружались демо-данные, перед реальной эксплуатацией:

```bash
docker compose exec portal npm run clean -- --all --yes
```

Без Docker:

```bash
sudo systemctl stop uz-textile-portal
sudo -u portal npm run clean -- --all --yes
sudo systemctl start uz-textile-portal
```

Команда сохраняет справочники, настройки и структуру базы. Перед удалением
создаётся PostgreSQL dump в `backups/`; флаг `--no-backup` отключает копию.

## 6. Резервное копирование

При запуске через `docker compose` служба `backup` ежедневно создаёт:

- `backups/portal-YYYY-MM-DD_HHMM.dump` — PostgreSQL dump в custom-формате;
- `backups/uploads-YYYY-MM-DD_HHMM.tar.gz` — архив вложений.

Ручной backup:

```bash
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p /var/www/uz-textile-invest/backups
pg_dump --dbname "$DATABASE_URL" --format=custom \
  --file "/var/www/uz-textile-invest/backups/portal-$STAMP.dump"
tar -czf "/var/www/uz-textile-invest/backups/uploads-$STAMP.tar.gz" \
  -C /var/www/uz-textile-invest/data/uploads .
```

Для cron без Docker:

```cron
30 1 * * * portal cd /var/www/uz-textile-invest && . ./.env && pg_dump --dbname "$DATABASE_URL" --format=custom --file "backups/portal-$(date +\%F_\%H\%M).dump" && find backups -name 'portal-*.dump' -mtime +30 -delete
35 1 * * * portal tar -czf /var/www/uz-textile-invest/backups/uploads-$(date +\%F_\%H\%M).tar.gz -C /var/www/uz-textile-invest/data/uploads . && find /var/www/uz-textile-invest/backups -name 'uploads-*.tar.gz' -mtime +30 -delete
```

## 7. Восстановление

```bash
# 1. Остановить приложение
docker compose stop portal
# или: sudo systemctl stop uz-textile-portal

# 2. Восстановить базу
pg_restore --dbname "$DATABASE_URL" --clean --if-exists backups/portal-2026-08-29_0130.dump

# 3. Восстановить вложения
rm -rf data/uploads/*
tar -xzf backups/uploads-2026-08-29_0130.tar.gz -C data/uploads

# 4. Запустить приложение
docker compose start portal
# или: sudo systemctl start uz-textile-portal
```

После запуска войдите в систему и проверьте число проектов и последние записи
журнала аудита.

## 8. Обновление версии

```bash
cd /var/www/uz-textile-invest
docker compose exec postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/before-update.dump
docker cp uz-textile-postgres:/tmp/before-update.dump backups/before-update.dump
git pull
docker compose up -d --build
```

Без Docker используйте `pg_dump --dbname "$DATABASE_URL" --format=custom`
перед `git pull`.

Схема базы данных создаётся автоматически при запуске. Для пустой базы достаточно
задать `DATABASE_URL`; отдельные миграции вручную запускать не нужно.

## 9. Наблюдение за работой

- Журнал приложения: `docker compose logs -f portal` или `journalctl -u uz-textile-portal -f`.
- Проверка доступности: HTTP-запрос `GET /` должен возвращать код 200.
- Ошибки доставки уведомлений фиксируются в таблице `notification_deliveries`.
- Действия пользователей — в журнале аудита (Администрирование → Журнал аудита).

## 10. Каналы уведомлений

**Электронная почта.** Заполните `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`. Параметр `SMTP_SECURE` принимает значения
`starttls` (по умолчанию, порт 587), `tls` (порт 465) и `none`.

**Telegram.** Создайте бота через @BotFather, впишите токен в
`TELEGRAM_BOT_TOKEN` и перезапустите приложение. Каждый сотрудник указывает свой
`chat_id` в профиле; получить его можно через метод Telegram Bot API
`getUpdates`.

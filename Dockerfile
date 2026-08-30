# =============================================================================
#  Портал Проектного офиса — образ для развёртывания
#  Сборка:  docker build -t uz-textile-portal .
#  Запуск:  docker run -p 3000:3000 --env-file .env -v portal-data:/app/data uz-textile-portal
# =============================================================================
FROM node:22-alpine

# Часовой пояс Ташкента — время в интерфейсе и в планировщике напоминаний
RUN apk add --no-cache tzdata wget && \
    cp /usr/share/zoneinfo/Asia/Tashkent /etc/localtime && \
    echo "Asia/Tashkent" > /etc/timezone

WORKDIR /app

# Приложение не использует внешних зависимостей: package.json нужен только
# для метаданных и команд запуска.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && \
    addgroup -S portal && adduser -S portal -G portal && \
    chown -R portal:portal /app
USER portal

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/portal.db \
    UPLOAD_DIR=/app/data/uploads

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]

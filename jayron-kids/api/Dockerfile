# =============================================================================
#  Jayron Kids — сервер интернет-магазина
#  Сборка:  docker build -t jayron-kids-api .
#  Запуск:  docker compose up -d   (из папки jayron-kids)
# =============================================================================
FROM node:22-alpine

# Часовой пояс Ташкента — время заказов в журнале и уведомлениях
RUN apk add --no-cache tzdata wget && \
    cp /usr/share/zoneinfo/Asia/Tashkent /etc/localtime && \
    echo "Asia/Tashkent" > /etc/timezone

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data/uploads && \
    addgroup -S shop && adduser -S shop -G shop && \
    chown -R shop:shop /app
USER shop

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/app/data/uploads

EXPOSE 4000
VOLUME ["/app/data/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:4000/health || exit 1

CMD ["node", "src/index.js"]

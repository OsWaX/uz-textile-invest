/**
 * Снимок каталога для демо-версии приложения (EXPO_PUBLIC_DEMO=1).
 * Берёт данные у запущенного сервера магазина, чтобы демо показывало
 * тот же каталог, что и настоящий сервер.
 *
 *   cd ../api && npm run reset && npm start      # сервер со стартовым каталогом
 *   node scripts/demo-snapshot.js [адрес сервера] # по умолчанию http://localhost:4000
 */
const fs = require('node:fs');
const path = require('node:path');

const { PROMO_CODES } = require('../../api/src/seed-data');

const base = (process.argv[2] || 'http://localhost:4000').replace(/\/+$/, '');
const out = path.join(__dirname, '..', 'src', 'lib', 'demo', 'catalog.json');

async function get(url) {
  const response = await fetch(base + url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

(async () => {
  const [config, categories, regions, list] = await Promise.all([
    get('/api/config'),
    get('/api/categories'),
    get('/api/regions'),
    get('/api/products?limit=100'),
  ]);
  const ids = list.items.map((p) => p.id).sort((a, b) => a - b);
  const products = [];
  for (const id of ids) {
    const summary = list.items.find((p) => p.id === id);
    products.push(await get(`/api/products/${encodeURIComponent(summary.slug)}`));
  }
  const snapshot = {
    config: { ...config, paymentMethods: ['cash', 'payme', 'click'], demoPayments: true },
    categories,
    regions,
    products,
    promoCodes: PROMO_CODES,
  };
  fs.writeFileSync(out, `${JSON.stringify(snapshot)}\n`);
  console.log(`Сохранено: ${path.relative(process.cwd(), out)} — товаров ${products.length}, категорий ${categories.length}`);
})().catch((error) => {
  console.error('Не удалось снять каталог:', error.message);
  process.exitCode = 1;
});

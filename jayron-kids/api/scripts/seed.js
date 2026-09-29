'use strict';
/**
 * Наполнение базы стартовым каталогом Jayron Kids.
 *   npm run seed   — создать схему и заполнить пустую базу
 *   npm run reset  — удалить все данные магазина и заполнить заново
 */
const db = require('../src/db');
const { seed } = require('../src/seed');

const reset = process.argv.includes('--reset');

seed({ reset })
  .then(async () => {
    const { products } = await db.get('SELECT COUNT(*)::int AS products FROM products');
    console.log(`${reset ? 'База пересоздана' : 'База готова'}: товаров в каталоге — ${products}.`);
  })
  .catch((error) => {
    console.error('Ошибка наполнения базы:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());

'use strict';
/** Наполнение базы стартовым каталогом, регионами доставки и промокодами. */
const db = require('./db');
const { COLORS, CATEGORIES, PRODUCTS, MATERIALS, REGIONS, PROMO_CODES } = require('./seed-data');

const TABLES = [
  'payment_transactions', 'order_history', 'order_items', 'orders', 'sessions', 'otp_codes',
  'customers', 'promo_codes', 'regions', 'product_variants', 'products', 'categories',
];

async function dropAll() {
  await db.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
}

async function seedRegions() {
  for (const [index, r] of REGIONS.entries()) {
    await db.run(
      `INSERT INTO regions (code, name_uz, name_ru, courier_price, post_price, post_days, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET name_uz = EXCLUDED.name_uz, name_ru = EXCLUDED.name_ru, sort = EXCLUDED.sort`,
      [r.code, r.uz, r.ru, r.courier, r.post, r.days, index],
    );
  }
}

async function seedCatalog() {
  const categoryIds = {};
  for (const [index, c] of CATEGORIES.entries()) {
    const { row } = await db.run(
      `INSERT INTO categories (slug, name_uz, name_ru, color, kind, sort)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [c.slug, c.uz, c.ru, c.color, c.kind, index],
    );
    categoryIds[c.slug] = row.id;
  }

  for (const [pIndex, p] of PRODUCTS.entries()) {
    const material = MATERIALS[p.material];
    const { row } = await db.run(
      `INSERT INTO products (slug, category_id, name_uz, name_ru, description_uz, description_ru,
         material_uz, material_ru, gender, kind, price, old_price, is_new, is_hit, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [
        p.slug, categoryIds[p.category], p.uz, p.ru, p.descUz, p.descRu,
        material.uz, material.ru, p.gender, p.kind, p.price, p.oldPrice || null,
        Boolean(p.isNew), Boolean(p.isHit), pIndex,
      ],
    );
    for (const [cIndex, colorCode] of p.colors.entries()) {
      const color = COLORS[colorCode];
      for (const [sIndex, size] of p.sizes.entries()) {
        // Детерминированные остатки: часть размеров намеренно распродана
        const stock = (pIndex * 7 + cIndex * 3 + sIndex * 5) % 13;
        const sku = `JK-${String(pIndex + 1).padStart(3, '0')}-${colorCode.toUpperCase()}-${size}`;
        await db.run(
          `INSERT INTO product_variants (product_id, sku, size, color_code, color_hex, color_name_uz, color_name_ru, stock)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.id, sku, size, colorCode, color.hex, color.uz, color.ru, stock],
        );
      }
    }
  }
}

async function seedPromoCodes() {
  for (const p of PROMO_CODES) {
    await db.run(
      `INSERT INTO promo_codes (code, kind, value, min_total) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [p.code, p.kind, p.value, p.minTotal],
    );
  }
}

/** Создаёт схему и наполняет пустую базу. С reset: true всё удаляется и создаётся заново. */
async function seed({ reset = false } = {}) {
  if (reset) await dropAll();
  await db.init(reset);
  await db.transaction(async () => {
    await seedRegions();
    const { count } = await db.get('SELECT COUNT(*)::int AS count FROM products');
    if (count === 0) {
      await db.query('DELETE FROM categories');
      await seedCatalog();
    }
    await seedPromoCodes();
  });
}

/** Регионы нужны для расчёта доставки — создаются при первом запуске сервера. */
async function ensureRegions() {
  const { count } = await db.get('SELECT COUNT(*)::int AS count FROM regions');
  if (count === 0) await seedRegions();
}

module.exports = { seed, ensureRegions, dropAll, TABLES };

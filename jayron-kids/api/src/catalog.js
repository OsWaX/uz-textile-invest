'use strict';
/** Каталог: категории, товары с вариантами (цвет × размер), регионы доставки. */
const db = require('./db');
const { badRequest, notFound } = require('./http');

const PRODUCT_COLUMNS = `
  p.id, p.slug, p.category_id, c.slug AS category_slug, p.name_uz, p.name_ru, p.kind, p.gender,
  p.price, p.old_price, p.images, p.is_new, p.is_hit, p.is_active,
  COALESCE(
    json_agg(json_build_object(
      'id', v.id, 'sku', v.sku, 'size', v.size, 'colorCode', v.color_code, 'colorHex', v.color_hex,
      'colorNameUz', v.color_name_uz, 'colorNameRu', v.color_name_ru, 'stock', v.stock
    ) ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL),
    '[]'
  ) AS variants`;

const bySize = (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b));

function formatProduct(row, { full = false } = {}) {
  const colors = [];
  const sizes = new Set();
  for (const v of row.variants) {
    if (!colors.some((c) => c.code === v.colorCode)) {
      colors.push({ code: v.colorCode, hex: v.colorHex, name: { uz: v.colorNameUz, ru: v.colorNameRu } });
    }
    sizes.add(v.size);
  }
  const product = {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    name: { uz: row.name_uz, ru: row.name_ru },
    kind: row.kind,
    gender: row.gender,
    price: row.price,
    oldPrice: row.old_price,
    images: row.images,
    isNew: row.is_new,
    isHit: row.is_hit,
    colors,
    sizes: [...sizes].sort(bySize),
    inStock: row.variants.some((v) => v.stock > 0),
  };
  if (full) {
    product.description = { uz: row.description_uz, ru: row.description_ru };
    product.material = { uz: row.material_uz, ru: row.material_ru };
    product.variants = row.variants.map((v) => ({
      id: v.id, sku: v.sku, size: v.size, colorCode: v.colorCode, stock: v.stock,
    }));
  }
  return product;
}

async function listCategories() {
  const rows = await db.all(
    `SELECT c.id, c.slug, c.name_uz, c.name_ru, c.color, c.kind,
            COUNT(p.id) FILTER (WHERE p.is_active)::int AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
      WHERE c.is_active
      GROUP BY c.id ORDER BY c.sort, c.id`,
  );
  return rows.map((c) => ({
    id: c.id, slug: c.slug, name: { uz: c.name_uz, ru: c.name_ru },
    color: c.color, kind: c.kind, productCount: c.product_count,
  }));
}

const SORTS = {
  popular: 'p.is_hit DESC, p.sort, p.id',
  new: 'p.is_new DESC, p.created_at DESC, p.id DESC',
  price_asc: 'p.price, p.id',
  price_desc: 'p.price DESC, p.id',
};

/** Список товаров с фильтрами из строки запроса. */
async function listProducts(query) {
  const where = ['p.is_active', 'c.is_active'];
  const params = [];
  const param = (value) => { params.push(value); return `$${params.length}`; };

  if (query.category) where.push(`c.slug = ${param(String(query.category))}`);
  if (query.gender === 'boy' || query.gender === 'girl') where.push(`p.gender IN (${param(query.gender)}, 'unisex')`);
  if (query.new === '1') where.push('p.is_new');
  if (query.hit === '1') where.push('p.is_hit');
  if (query.sale === '1') where.push('p.old_price IS NOT NULL');
  if (query.size) {
    where.push(`EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.size = ${param(String(query.size))} AND sv.stock > 0)`);
  }
  if (query.q) {
    const term = `%${String(query.q).trim().slice(0, 60).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const t = param(term);
    where.push(`(p.name_uz ILIKE ${t} OR p.name_ru ILIKE ${t} OR c.name_uz ILIKE ${t} OR c.name_ru ILIKE ${t})`);
  }
  if (query.ids) {
    const ids = String(query.ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    if (!ids.length) return { items: [], total: 0 };
    where.push(`p.id = ANY(${param(ids)}::int[])`);
  }

  const sort = SORTS[query.sort] || SORTS.popular;
  const limit = Math.min(Math.max(Number(query.limit) || 40, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const whereSql = where.join(' AND ');
  const { total } = await db.get(
    `SELECT COUNT(*)::int AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE ${whereSql}`,
    params,
  );
  const rows = await db.all(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE ${whereSql}
      GROUP BY p.id, c.slug
      ORDER BY ${sort}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map((r) => formatProduct(r)), total };
}

async function getProduct(slugOrId, { includeInactive = false } = {}) {
  const isId = /^\d+$/.test(String(slugOrId));
  const row = await db.get(
    `SELECT ${PRODUCT_COLUMNS}, p.description_uz, p.description_ru, p.material_uz, p.material_ru,
            p.mxik, p.package_code, p.sort
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE ${isId ? 'p.id = $1' : 'p.slug = $1'} ${includeInactive ? '' : 'AND p.is_active AND c.is_active'}
      GROUP BY p.id, c.slug`,
    [isId ? Number(slugOrId) : String(slugOrId)],
  );
  if (!row) throw notFound('product_not_found');
  const product = formatProduct(row, { full: true });
  if (includeInactive) {
    Object.assign(product, { isActive: row.is_active, mxik: row.mxik, packageCode: row.package_code, sort: row.sort });
  }
  return product;
}

async function listRegions() {
  const rows = await db.all('SELECT * FROM regions ORDER BY sort, code');
  return rows.map((r) => ({
    code: r.code,
    name: { uz: r.name_uz, ru: r.name_ru },
    courierPrice: r.courier_price,
    postPrice: r.post_price,
    postDays: r.post_days,
  }));
}

function requireSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw badRequest('invalid_slug');
  return slug;
}

module.exports = { listCategories, listProducts, getProduct, listRegions, formatProduct, requireSlug };

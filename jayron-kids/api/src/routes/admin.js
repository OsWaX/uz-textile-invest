'use strict';
/** Маршруты панели управления магазином: заказы, товары, остатки, промокоды, доставка. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const catalog = require('../catalog');
const orders = require('../orders');
const { formatPhone } = require('../auth');
const { Router, sendJson, readJson, readBody, badRequest, notFound, conflict } = require('../http');

const router = new Router();

/** Все маршруты, кроме входа, доступны только администратору. */
const admin = (handler) => async (req, res, ctx) => {
  await auth.requireAdmin(req);
  return handler(req, res, ctx);
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const money = (value, { nullable = false } = {}) => {
  if (nullable && (value === null || value === '' || value === undefined)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 1e10) throw badRequest('invalid_price');
  return n;
};

router.post('/api/admin/login', async (req, res, { ip }) => {
  const body = await readJson(req);
  sendJson(res, 200, { token: await auth.adminLogin(body.password, ip) });
});

router.post('/api/admin/logout', admin(async (req, res) => {
  await auth.logout(req);
  sendJson(res, 200, { ok: true });
}));

router.get('/api/admin/summary', admin(async (req, res) => {
  const counts = await db.get(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'new')::int AS new_orders,
       COUNT(*) FILTER (WHERE status IN ('confirmed', 'shipped'))::int AS in_progress,
       COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND paid_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'), 0)::bigint AS paid_today,
       COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND paid_at >= now() - interval '30 days'), 0)::bigint AS paid_30d
     FROM orders`,
  );
  const lowStock = await db.all(
    `SELECT v.id, v.sku, v.size, v.color_name_ru, v.stock, p.id AS product_id, p.name_ru
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.is_active AND v.stock <= 2
      ORDER BY v.stock, p.name_ru, v.size LIMIT 30`,
  );
  sendJson(res, 200, {
    newOrders: counts.new_orders,
    inProgress: counts.in_progress,
    paidToday: counts.paid_today,
    paid30d: counts.paid_30d,
    lowStock: lowStock.map((v) => ({
      variantId: v.id, sku: v.sku, size: v.size, color: v.color_name_ru, stock: v.stock,
      productId: v.product_id, productName: v.name_ru,
    })),
  });
}));

// ---------------------------------------------------------------- заказы
router.get('/api/admin/orders', admin(async (req, res, { query }) => {
  const where = [];
  const params = [];
  if (orders.STATUSES.includes(query.status)) {
    params.push(query.status);
    where.push(`o.status = $${params.length}`);
  }
  if (query.q) {
    const digits = String(query.q).replace(/\D/g, '');
    if (digits) {
      params.push(Number(digits) <= 2 ** 31 - 1 ? Number(digits) : 0, `%${digits}%`);
      where.push(`(o.id = $${params.length - 1} OR o.recipient_phone LIKE $${params.length} OR c.phone LIKE $${params.length})`);
    }
  }
  const rows = await db.all(
    `SELECT o.*, c.phone AS customer_phone,
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o JOIN customers c ON c.id = o.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.created_at DESC, o.id DESC LIMIT 200`,
    params,
  );
  sendJson(res, 200, rows.map((o) => ({
    ...orders.formatOrder(o),
    customerPhone: formatPhone(o.customer_phone),
    itemCount: o.item_count,
  })));
}));

router.get('/api/admin/orders/:id', admin(async (req, res, { params }) => {
  const { order, items, history } = await orders.loadOrder(Number(params.id) || 0);
  const customer = await db.get('SELECT phone, name FROM customers WHERE id = $1', [order.customer_id]);
  const region = order.region_code ? await db.get('SELECT name_ru FROM regions WHERE code = $1', [order.region_code]) : null;
  const payments = await db.all(
    'SELECT provider, external_id, amount, state, create_time, perform_time, cancel_time FROM payment_transactions WHERE order_id = $1 ORDER BY id',
    [order.id],
  );
  sendJson(res, 200, {
    ...orders.formatOrder(order, items, history),
    customer: { phone: formatPhone(customer.phone), name: customer.name },
    regionName: region?.name_ru ?? null,
    transitions: orders.TRANSITIONS[order.status],
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) / 100 })),
  });
}));

router.patch('/api/admin/orders/:id', admin(async (req, res, { params }) => {
  const body = await readJson(req);
  sendJson(res, 200, await orders.setStatus(params.id, String(body.status ?? ''), body.note));
}));

// ---------------------------------------------------------------- товары
router.get('/api/admin/categories', admin(async (req, res) => {
  sendJson(res, 200, await db.all('SELECT id, slug, name_uz, name_ru FROM categories ORDER BY sort, id'));
}));

router.get('/api/admin/products', admin(async (req, res) => {
  const rows = await db.all(
    `SELECT p.id, p.slug, p.name_ru, p.name_uz, p.kind, p.price, p.old_price, p.is_active, p.is_new, p.is_hit,
            p.images, p.mxik, c.name_ru AS category,
            COALESCE(SUM(v.stock), 0)::int AS stock, COUNT(v.id)::int AS variant_count
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants v ON v.product_id = p.id
      GROUP BY p.id, c.name_ru, c.sort
      ORDER BY c.sort, p.sort, p.id`,
  );
  sendJson(res, 200, rows);
}));

router.get('/api/admin/products/:id', admin(async (req, res, { params }) => {
  const product = await catalog.getProduct(Number(params.id) || 0, { includeInactive: true });
  const variants = await db.all('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id', [product.id]);
  sendJson(res, 200, { ...product, variantRows: variants });
}));

const GENDERS = ['boy', 'girl', 'unisex'];
const KINDS = ['bodysuit', 'romper', 'tshirt', 'sweatshirt', 'hoodie', 'set', 'pants', 'shorts', 'dress', 'pajama', 'jacket', 'cap'];

/** Поля товара из тела запроса. Для partial учитываются только переданные поля. */
async function productFields(body, partial) {
  const out = {};
  const has = (key) => !partial || body[key] !== undefined;
  if (has('slug')) out.slug = catalog.requireSlug(body.slug);
  if (has('categoryId')) {
    const category = await db.get('SELECT id FROM categories WHERE id = $1', [Number(body.categoryId) || 0]);
    if (!category) throw badRequest('invalid_category');
    out.category_id = category.id;
  }
  for (const [key, column, max] of [
    ['nameUz', 'name_uz', 120], ['nameRu', 'name_ru', 120],
    ['descriptionUz', 'description_uz', 2000], ['descriptionRu', 'description_ru', 2000],
    ['materialUz', 'material_uz', 300], ['materialRu', 'material_ru', 300],
    ['mxik', 'mxik', 20], ['packageCode', 'package_code', 20],
  ]) {
    if (has(key)) out[column] = text(body[key], max);
  }
  if ((has('nameUz') && !out.name_uz) || (has('nameRu') && !out.name_ru)) throw badRequest('name_required');
  if (out.mxik && !/^\d{17}$/.test(out.mxik)) throw badRequest('invalid_mxik');
  if (has('gender')) {
    if (!GENDERS.includes(body.gender)) throw badRequest('invalid_gender');
    out.gender = body.gender;
  }
  if (has('kind')) {
    if (!KINDS.includes(body.kind)) throw badRequest('invalid_kind');
    out.kind = body.kind;
  }
  if (has('price')) out.price = money(body.price);
  if (has('oldPrice')) out.old_price = money(body.oldPrice, { nullable: true });
  for (const [key, column] of [['isNew', 'is_new'], ['isHit', 'is_hit'], ['isActive', 'is_active']]) {
    if (body[key] !== undefined) out[column] = Boolean(body[key]);
  }
  if (body.sort !== undefined) out.sort = Number(body.sort) || 0;
  return out;
}

async function saveProduct(id, fields) {
  const columns = Object.keys(fields);
  if (!columns.length) return;
  try {
    if (id) {
      await db.run(
        `UPDATE products SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
        [id, ...columns.map((c) => fields[c])],
      );
      return id;
    }
    const { row } = await db.run(
      `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      columns.map((c) => fields[c]),
    );
    return row.id;
  } catch (error) {
    if (error.code === '23505') throw conflict('slug_taken');
    throw error;
  }
}

router.post('/api/admin/products', admin(async (req, res) => {
  const body = await readJson(req);
  const id = await saveProduct(null, await productFields(body, false));
  sendJson(res, 201, await catalog.getProduct(id, { includeInactive: true }));
}));

router.patch('/api/admin/products/:id', admin(async (req, res, { params }) => {
  const id = Number(params.id) || 0;
  if (!await db.get('SELECT 1 FROM products WHERE id = $1', [id])) throw notFound('product_not_found');
  const body = await readJson(req);
  await saveProduct(id, await productFields(body, true));
  sendJson(res, 200, await catalog.getProduct(id, { includeInactive: true }));
}));

/**
 * Замена списка вариантов товара. Варианты, которых нет в списке, удаляются;
 * если такой вариант уже заказывали, его остаток обнуляется.
 */
router.put('/api/admin/products/:id/variants', admin(async (req, res, { params }) => {
  const id = Number(params.id) || 0;
  const body = await readJson(req);
  if (!Array.isArray(body.variants)) throw badRequest('invalid_variants');

  await db.transaction(async () => {
    const product = await db.get('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!product) throw notFound('product_not_found');
    const keep = [];
    for (const raw of body.variants) {
      const v = {
        size: text(raw.size, 10),
        colorCode: text(raw.colorCode, 30).toLowerCase(),
        colorHex: text(raw.colorHex, 7),
        colorNameUz: text(raw.colorNameUz, 60),
        colorNameRu: text(raw.colorNameRu, 60),
        stock: Number(raw.stock),
      };
      if (!v.size || !/^[a-z0-9-]+$/.test(v.colorCode) || !/^#[0-9A-Fa-f]{6}$/.test(v.colorHex)
        || !v.colorNameUz || !v.colorNameRu || !Number.isInteger(v.stock) || v.stock < 0) {
        throw badRequest('invalid_variant', { variant: raw });
      }
      const sku = text(raw.sku, 60) || `JK-${id}-${v.colorCode.toUpperCase()}-${v.size}`;
      const { row } = await db.run(
        `INSERT INTO product_variants (product_id, sku, size, color_code, color_hex, color_name_uz, color_name_ru, stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (product_id, color_code, size) DO UPDATE SET
           color_hex = EXCLUDED.color_hex, color_name_uz = EXCLUDED.color_name_uz,
           color_name_ru = EXCLUDED.color_name_ru, stock = EXCLUDED.stock
         RETURNING id`,
        [id, sku, v.size, v.colorCode, v.colorHex, v.colorNameUz, v.colorNameRu, v.stock],
      ).catch((error) => {
        if (error.code === '23505') throw conflict('sku_taken', { sku });
        throw error;
      });
      keep.push(row.id);
    }
    await db.run(
      `DELETE FROM product_variants v WHERE v.product_id = $1 AND NOT (v.id = ANY($2::int[]))
         AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.variant_id = v.id)`,
      [id, keep],
    );
    await db.run(
      'UPDATE product_variants SET stock = 0 WHERE product_id = $1 AND NOT (id = ANY($2::int[]))',
      [id, keep],
    );
  });
  sendJson(res, 200, await catalog.getProduct(id, { includeInactive: true }));
}));

// ---------------------------------------------------------------- фотографии
const IMAGE_TYPES = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

router.post('/api/admin/products/:id/images', admin(async (req, res, { params }) => {
  const id = Number(params.id) || 0;
  const type = IMAGE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
  if (!type) throw badRequest('invalid_image_type');
  const data = await readBody(req, config.maxImageBytes);
  if (data.length < 12 || !type.magic(data)) throw badRequest('invalid_image');
  if (!await db.get('SELECT 1 FROM products WHERE id = $1', [id])) throw notFound('product_not_found');

  const name = `${id}-${crypto.randomBytes(8).toString('hex')}${type.ext}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, name), data);
  const url = `/uploads/${name}`;
  await db.run(
    "UPDATE products SET images = images || jsonb_build_array($2::text), updated_at = now() WHERE id = $1",
    [id, url],
  );
  sendJson(res, 201, await catalog.getProduct(id, { includeInactive: true }));
}));

router.delete('/api/admin/products/:id/images', admin(async (req, res, { params, query }) => {
  const id = Number(params.id) || 0;
  const url = String(query.url || '');
  const product = await db.get('SELECT images FROM products WHERE id = $1', [id]);
  if (!product) throw notFound('product_not_found');
  if (!product.images.includes(url)) throw notFound('image_not_found');
  await db.run(
    `UPDATE products SET images = COALESCE(
       (SELECT jsonb_agg(value) FROM jsonb_array_elements(images) WHERE value <> to_jsonb($2::text)), '[]'::jsonb),
       updated_at = now() WHERE id = $1`,
    [id, url],
  );
  // Файл удаляем, только если он лежит в нашей папке загрузок и больше нигде не используется
  const file = path.join(config.uploadDir, path.basename(url));
  const stillUsed = await db.get('SELECT 1 FROM products WHERE images @> jsonb_build_array($1::text)', [url]);
  if (url.startsWith('/uploads/') && !stillUsed && fs.existsSync(file)) fs.unlinkSync(file);
  sendJson(res, 200, await catalog.getProduct(id, { includeInactive: true }));
}));

// ---------------------------------------------------------------- промокоды
const formatPromo = (p) => ({
  code: p.code, kind: p.kind, value: p.value, minTotal: p.min_total, maxUses: p.max_uses,
  usedCount: p.used_count, endsAt: p.ends_at, isActive: p.is_active,
});

function promoFields(body) {
  const kind = body.kind === 'fixed' ? 'fixed' : 'percent';
  const value = Number(body.value);
  if (!Number.isInteger(value) || value <= 0 || (kind === 'percent' && value > 90)) throw badRequest('invalid_promo_value');
  const minTotal = Number(body.minTotal || 0);
  if (!Number.isInteger(minTotal) || minTotal < 0) throw badRequest('invalid_min_total');
  const maxUses = body.maxUses === null || body.maxUses === '' || body.maxUses === undefined ? null : Number(body.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) throw badRequest('invalid_max_uses');
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) throw badRequest('invalid_date');
  return { kind, value, minTotal, maxUses, endsAt, isActive: body.isActive !== false };
}

router.get('/api/admin/promo-codes', admin(async (req, res) => {
  const rows = await db.all('SELECT * FROM promo_codes ORDER BY is_active DESC, code');
  sendJson(res, 200, rows.map(formatPromo));
}));

router.post('/api/admin/promo-codes', admin(async (req, res) => {
  const body = await readJson(req);
  const code = text(body.code, 30).toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw badRequest('invalid_promo_code');
  const f = promoFields(body);
  const { row } = await db.run(
    `INSERT INTO promo_codes (code, kind, value, min_total, max_uses, ends_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING RETURNING *`,
    [code, f.kind, f.value, f.minTotal, f.maxUses, f.endsAt, f.isActive],
  );
  if (!row) throw conflict('promo_exists');
  sendJson(res, 201, formatPromo(row));
}));

router.patch('/api/admin/promo-codes/:code', admin(async (req, res, { params }) => {
  const body = await readJson(req);
  const current = await db.get('SELECT * FROM promo_codes WHERE code = $1', [params.code]);
  if (!current) throw notFound('promo_not_found');
  const f = promoFields({ ...formatPromo(current), ...body });
  const { row } = await db.run(
    `UPDATE promo_codes SET kind = $2, value = $3, min_total = $4, max_uses = $5, ends_at = $6, is_active = $7
      WHERE code = $1 RETURNING *`,
    [current.code, f.kind, f.value, f.minTotal, f.maxUses, f.endsAt, f.isActive],
  );
  sendJson(res, 200, formatPromo(row));
}));

// ---------------------------------------------------------------- доставка
router.get('/api/admin/regions', admin(async (req, res) => {
  sendJson(res, 200, await catalog.listRegions());
}));

router.patch('/api/admin/regions/:code', admin(async (req, res, { params }) => {
  const body = await readJson(req);
  const courierPrice = body.courierPrice === null || body.courierPrice === '' ? null : Number(body.courierPrice);
  const postPrice = Number(body.postPrice);
  if ((courierPrice !== null && (!Number.isInteger(courierPrice) || courierPrice < 0))
    || !Number.isInteger(postPrice) || postPrice < 0) {
    throw badRequest('invalid_price');
  }
  const postDays = text(body.postDays, 10) || '2-4';
  const { changes } = await db.run(
    'UPDATE regions SET courier_price = $2, post_price = $3, post_days = $4 WHERE code = $1',
    [params.code, courierPrice, postPrice, postDays],
  );
  if (!changes) throw notFound('region_not_found');
  sendJson(res, 200, await catalog.listRegions());
}));

module.exports = router;

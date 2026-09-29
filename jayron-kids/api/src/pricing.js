'use strict';
/**
 * Расчёт корзины: наличие, промокод, доставка, итог.
 * Все суммы считаются на сервере — клиент получает готовый расчёт.
 */
const config = require('./config');
const db = require('./db');
const { badRequest } = require('./http');

const DELIVERY_METHODS = ['courier', 'post', 'pickup'];
const MAX_LINES = 50;
const MAX_QUANTITY = 20;

/** Проверяет и объединяет позиции корзины: [{ variantId, quantity }]. */
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest('cart_empty');
  if (items.length > MAX_LINES) throw badRequest('cart_too_large');
  const merged = new Map();
  for (const item of items) {
    const variantId = Number(item?.variantId);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest('invalid_item');
    if (!Number.isInteger(quantity) || quantity <= 0) throw badRequest('invalid_quantity');
    merged.set(variantId, Math.min((merged.get(variantId) || 0) + quantity, MAX_QUANTITY));
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

function computeDiscount(promo, subtotal) {
  if (promo.kind === 'percent') return Math.floor((subtotal * Math.min(promo.value, 100)) / 100);
  return Math.min(promo.value, subtotal);
}

async function findPromo(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) return { code: '', row: null };
  const row = await db.get(
    `SELECT * FROM promo_codes
      WHERE code = $1 AND is_active AND (ends_at IS NULL OR ends_at > now())
        AND (max_uses IS NULL OR used_count < max_uses)`,
    [code],
  );
  return { code, row };
}

/**
 * Считает корзину. С lock: true строки вариантов блокируются до конца транзакции —
 * так два одновременных заказа не продадут один и тот же последний размер.
 */
async function buildQuote(input, { lock = false } = {}) {
  const items = normalizeItems(input.items);
  const deliveryMethod = DELIVERY_METHODS.includes(input.deliveryMethod) ? input.deliveryMethod : 'courier';
  const problems = [];

  const rows = await db.all(
    `SELECT v.id AS variant_id, v.size, v.color_hex, v.color_name_uz, v.color_name_ru, v.stock,
            p.id AS product_id, p.slug, p.name_uz, p.name_ru, p.kind, p.price, p.images,
            p.mxik, p.package_code, (p.is_active AND c.is_active) AS available
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE v.id = ANY($1::int[])
      ${lock ? 'FOR UPDATE OF v' : ''}`,
    [items.map((i) => i.variantId)],
  );
  const byId = new Map(rows.map((r) => [r.variant_id, r]));

  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const row = byId.get(item.variantId);
    if (!row || !row.available) {
      problems.push({ code: 'unavailable', variantId: item.variantId });
      continue;
    }
    if (row.stock < item.quantity) {
      problems.push({ code: 'out_of_stock', variantId: item.variantId, available: row.stock });
    }
    const lineTotal = row.price * item.quantity;
    subtotal += lineTotal;
    lines.push({
      variantId: row.variant_id,
      productId: row.product_id,
      slug: row.slug,
      name: { uz: row.name_uz, ru: row.name_ru },
      kind: row.kind,
      size: row.size,
      color: { hex: row.color_hex, name: { uz: row.color_name_uz, ru: row.color_name_ru } },
      image: row.images[0] || null,
      price: row.price,
      quantity: item.quantity,
      available: row.stock,
      lineTotal,
      mxik: row.mxik,
      packageCode: row.package_code,
    });
  }

  if (subtotal < config.shop.minOrderTotal) {
    problems.push({ code: 'min_order', minTotal: config.shop.minOrderTotal });
  }

  // Промокод
  let discount = 0;
  const promo = { code: '', applied: false, error: null, minTotal: null };
  if (input.promoCode) {
    const { code, row } = await findPromo(input.promoCode);
    promo.code = code;
    if (!row) {
      promo.error = 'promo_not_found';
    } else if (subtotal < row.min_total) {
      promo.error = 'promo_min_total';
      promo.minTotal = row.min_total;
    } else {
      discount = computeDiscount(row, subtotal);
      promo.applied = true;
    }
  }

  // Доставка
  let delivery = 0;
  let region = null;
  if (deliveryMethod !== 'pickup') {
    if (input.regionCode) {
      region = await db.get('SELECT * FROM regions WHERE code = $1', [String(input.regionCode)]);
    }
    if (!region) {
      problems.push({ code: 'region_required' });
    } else if (deliveryMethod === 'courier' && region.courier_price === null) {
      problems.push({ code: 'courier_unavailable' });
    } else {
      delivery = deliveryMethod === 'courier' ? region.courier_price : region.post_price;
    }
    if (subtotal - discount >= config.shop.freeDeliveryFrom) delivery = 0;
  }

  return {
    lines,
    subtotal,
    discount,
    delivery,
    total: subtotal - discount + delivery,
    deliveryMethod,
    regionCode: region ? region.code : null,
    promo,
    problems,
    freeDeliveryFrom: config.shop.freeDeliveryFrom,
    minOrderTotal: config.shop.minOrderTotal,
  };
}

/** Расчёт для ответа клиенту — без служебных полей для чека. */
function publicQuote(quote) {
  return {
    ...quote,
    lines: quote.lines.map(({ mxik, packageCode, ...line }) => line),
  };
}

module.exports = { buildQuote, publicQuote, normalizeItems, computeDiscount, DELIVERY_METHODS };

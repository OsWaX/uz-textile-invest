'use strict';
/**
 * Заказы: оформление с резервом товара, статусы, оплата, отмена с возвратом на склад.
 */
const config = require('./config');
const db = require('./db');
const notify = require('./notify');
const { buildQuote, publicQuote } = require('./pricing');
const { normalizePhone, formatPhone } = require('./auth');
const { availableMethods, paymentUrl } = require('./payments/links');
const { badRequest, notFound, conflict } = require('./http');

const STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// Разрешённые переходы статусов для менеджера магазина
const TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);

function formatOrder(order, items = [], history = []) {
  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    paymentUrl: paymentUrl(order),
    deliveryMethod: order.delivery_method,
    regionCode: order.region_code,
    city: order.city,
    address: order.address,
    comment: order.comment,
    recipientName: order.recipient_name,
    recipientPhone: order.recipient_phone,
    recipientPhoneFormatted: formatPhone(order.recipient_phone),
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryPrice: order.delivery_price,
    total: order.total,
    promoCode: order.promo_code,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    canCancel: order.status === 'new' && order.payment_status !== 'paid',
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      name: { uz: i.name_uz, ru: i.name_ru },
      kind: i.kind,
      size: i.size,
      color: { hex: i.color_hex, name: { uz: i.color_name_uz, ru: i.color_name_ru } },
      image: i.image,
      price: i.price,
      quantity: i.quantity,
    })),
    history: history.map((h) => ({ status: h.status, note: h.note, at: h.created_at })),
  };
}

async function loadOrder(id) {
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) throw notFound('order_not_found');
  const items = await db.all('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  const history = await db.all('SELECT * FROM order_history WHERE order_id = $1 ORDER BY id', [id]);
  return { order, items, history };
}

const addHistory = (orderId, status, note = '') =>
  db.run('INSERT INTO order_history (order_id, status, note) VALUES ($1, $2, $3)', [orderId, status, note]);

/** Проверка полей оформления заказа. */
function validateCheckout(body) {
  const recipientName = text(body.recipientName, 100);
  if (recipientName.length < 2) throw badRequest('invalid_name');
  const recipientPhone = normalizePhone(body.recipientPhone);
  if (!recipientPhone) throw badRequest('invalid_phone');
  const paymentMethod = String(body.paymentMethod ?? '');
  if (!availableMethods().includes(paymentMethod)) throw badRequest('invalid_payment_method');
  const deliveryMethod = String(body.deliveryMethod ?? '');
  if (!['courier', 'post', 'pickup'].includes(deliveryMethod)) throw badRequest('invalid_delivery_method');
  const city = text(body.city, 100);
  const address = text(body.address, 300);
  if (deliveryMethod !== 'pickup' && (city.length < 2 || address.length < 5)) throw badRequest('invalid_address');
  return {
    recipientName,
    recipientPhone,
    paymentMethod,
    deliveryMethod,
    regionCode: deliveryMethod === 'pickup' ? null : text(body.regionCode, 40),
    city: deliveryMethod === 'pickup' ? '' : city,
    address: deliveryMethod === 'pickup' ? '' : address,
    comment: text(body.comment, 500),
    language: body.language === 'ru' ? 'ru' : 'uz',
    promoCode: text(body.promoCode, 40),
  };
}

async function createOrder(customerId, body) {
  const input = validateCheckout(body);

  const { order, items, regionName } = await db.transaction(async () => {
    const quote = await buildQuote({ ...input, items: body.items }, { lock: true });
    if (quote.problems.length) throw conflict('cart_problems', { problems: quote.problems, quote: publicQuote(quote) });
    if (input.promoCode && !quote.promo.applied) {
      throw conflict('promo_invalid', { promo: quote.promo, quote: publicQuote(quote) });
    }

    const { row: created } = await db.run(
      `INSERT INTO orders (customer_id, payment_method, delivery_method, region_code, city, address, comment,
         recipient_name, recipient_phone, subtotal, discount, delivery_price, total, promo_code, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        customerId, input.paymentMethod, input.deliveryMethod, quote.regionCode, input.city, input.address,
        input.comment, input.recipientName, input.recipientPhone, quote.subtotal, quote.discount,
        quote.delivery, quote.total, quote.promo.applied ? quote.promo.code : null, input.language,
      ],
    );

    const orderItems = [];
    for (const line of quote.lines) {
      const { row: item } = await db.run(
        `INSERT INTO order_items (order_id, product_id, variant_id, name_uz, name_ru, kind, size, color_hex,
           color_name_uz, color_name_ru, image, price, quantity, mxik, package_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [
          created.id, line.productId, line.variantId, line.name.uz, line.name.ru, line.kind, line.size,
          line.color.hex, line.color.name.uz, line.color.name.ru, line.image, line.price, line.quantity,
          line.mxik, line.packageCode,
        ],
      );
      orderItems.push(item);
      await db.run('UPDATE product_variants SET stock = stock - $2 WHERE id = $1', [line.variantId, line.quantity]);
    }

    if (quote.promo.applied) {
      const used = await db.run(
        `UPDATE promo_codes SET used_count = used_count + 1
          WHERE code = $1 AND (max_uses IS NULL OR used_count < max_uses)`,
        [quote.promo.code],
      );
      if (!used.changes) throw conflict('promo_invalid', { promo: { ...quote.promo, applied: false, error: 'promo_not_found' } });
    }

    await addHistory(created.id, 'new');
    await db.run(
      `UPDATE customers SET name = CASE WHEN name = '' THEN $2 ELSE name END, language = $3, last_address = $4
        WHERE id = $1`,
      [
        customerId, input.recipientName, input.language,
        input.deliveryMethod === 'pickup' ? null : { regionCode: quote.regionCode, city: input.city, address: input.address },
      ],
    );

    const region = quote.regionCode
      ? await db.get('SELECT name_ru FROM regions WHERE code = $1', [quote.regionCode])
      : null;
    return { order: created, items: orderItems, regionName: region?.name_ru };
  });

  notify.newOrder(order, items, regionName);
  return formatOrder(order, items, [{ status: 'new', note: '', created_at: order.created_at }]);
}

async function listCustomerOrders(customerId) {
  const orders = await db.all(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
    [customerId],
  );
  if (!orders.length) return [];
  const items = await db.all(
    'SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id',
    [orders.map((o) => o.id)],
  );
  return orders.map((o) => formatOrder(o, items.filter((i) => i.order_id === o.id)));
}

async function getCustomerOrder(customerId, id) {
  const { order, items, history } = await loadOrder(Number(id) || 0);
  if (order.customer_id !== customerId) throw notFound('order_not_found');
  return formatOrder(order, items, history);
}

/** Возвращает товары заказа на склад (один раз за жизнь заказа). */
async function releaseStock(orderId) {
  const released = await db.run(
    'UPDATE orders SET stock_released = TRUE WHERE id = $1 AND NOT stock_released',
    [orderId],
  );
  if (!released.changes) return;
  await db.run(
    `UPDATE product_variants v SET stock = v.stock + s.quantity
       FROM (SELECT variant_id, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = $1 GROUP BY variant_id) s
      WHERE v.id = s.variant_id`,
    [orderId],
  );
}

/** Отмена заказа внутри транзакции: статус, возврат на склад, история. */
async function cancelInTx(orderId, note, paymentStatus = null) {
  const { row } = await db.run(
    `UPDATE orders SET status = 'cancelled', updated_at = now(),
            payment_status = COALESCE($2::text, CASE WHEN payment_status = 'pending' THEN 'cancelled' ELSE payment_status END)
      WHERE id = $1 AND status NOT IN ('cancelled', 'delivered') RETURNING *`,
    [orderId, paymentStatus],
  );
  if (!row) return null;
  await releaseStock(orderId);
  await addHistory(orderId, 'cancelled', note);
  return row;
}

async function cancelByCustomer(customerId, id) {
  const orderId = Number(id) || 0;
  const cancelled = await db.transaction(async () => {
    const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order || order.customer_id !== customerId) throw notFound('order_not_found');
    if (order.status !== 'new' || order.payment_status === 'paid') throw conflict('cannot_cancel');
    const active = await db.get(
      'SELECT 1 FROM payment_transactions WHERE order_id = $1 AND state = 1',
      [orderId],
    );
    if (active) throw conflict('payment_in_progress');
    return cancelInTx(orderId, 'customer');
  });
  if (cancelled) notify.orderCancelled(cancelled, 'покупателем в приложении');
  return getCustomerOrder(customerId, orderId);
}

/** Смена статуса менеджером. Доставленный заказ с оплатой наличными считается оплаченным. */
async function setStatus(id, status, note = '') {
  if (!STATUSES.includes(status)) throw badRequest('invalid_status');
  const orderId = Number(id) || 0;
  const cancelled = await db.transaction(async () => {
    const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order) throw notFound('order_not_found');
    if (!TRANSITIONS[order.status].includes(status)) throw conflict('invalid_transition');
    if (status === 'cancelled') return cancelInTx(orderId, text(note, 300));

    await db.run('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [orderId, status]);
    await addHistory(orderId, status, text(note, 300));
    if (status === 'delivered' && order.payment_method === 'cash' && order.payment_status === 'pending') {
      await db.run("UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1", [orderId]);
      await addHistory(orderId, 'paid', 'cash');
    }
    return null;
  });
  if (cancelled) notify.orderCancelled(cancelled, note);
  const { order, items, history } = await loadOrder(orderId);
  return formatOrder(order, items, history);
}

/** Отметка об оплате от платёжной системы. Вызывается внутри её транзакции. */
async function markPaid(orderId, provider) {
  const { row } = await db.run(
    `UPDATE orders SET payment_status = 'paid', paid_at = now(), updated_at = now()
      WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
    [orderId],
  );
  if (row) {
    await addHistory(orderId, 'paid', provider);
    notify.orderPaid(row, provider);
  }
  return row;
}

/**
 * Возврат оплаты платёжной системой: заказ отменяется, товар возвращается на склад.
 * Отмена транзакции до списания денег заказ не трогает — покупатель может
 * оплатить снова, а неоплаченный заказ позже отменит cancelUnpaidOrders.
 */
async function markRefunded(orderId, provider) {
  const order = await cancelInTx(orderId, provider, 'refunded');
  if (order) {
    notify.orderCancelled(order, `возврат оплаты в ${provider}`);
  } else {
    await db.run("UPDATE orders SET payment_status = 'refunded', updated_at = now() WHERE id = $1", [orderId]);
  }
}

/** Отменяет онлайн-заказы, которые не оплатили вовремя, и возвращает товар на склад. */
async function cancelUnpaidOrders() {
  const stale = await db.all(
    `SELECT id FROM orders o
      WHERE o.payment_method IN ('payme', 'click') AND o.payment_status = 'pending' AND o.status = 'new'
        AND o.created_at < now() - make_interval(mins => $1)
        AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.order_id = o.id AND t.state = 1)`,
    [config.shop.unpaidOrderTtlMinutes],
  );
  let count = 0;
  for (const { id } of stale) {
    const cancelled = await db.transaction(async () => {
      const order = await db.get("SELECT * FROM orders WHERE id = $1 AND payment_status = 'pending' AND status = 'new' FOR UPDATE", [id]);
      if (!order) return null;
      return cancelInTx(id, 'unpaid');
    });
    if (cancelled) count += 1;
  }
  return count;
}

module.exports = {
  STATUSES, TRANSITIONS,
  createOrder, listCustomerOrders, getCustomerOrder, cancelByCustomer,
  setStatus, markPaid, markRefunded, cancelUnpaidOrders,
  loadOrder, formatOrder, releaseStock,
};

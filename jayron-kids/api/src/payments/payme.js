'use strict';
/**
 * Payme Merchant API. Payme вызывает адрес магазина методом JSON-RPC:
 * CheckPerformTransaction, CreateTransaction, PerformTransaction,
 * CancelTransaction, CheckTransaction, GetStatement, SetFiscalData.
 * Ответ всегда HTTP 200; ошибки — в поле error. Суммы — в тийинах.
 */
const crypto = require('node:crypto');

const config = require('../config');
const db = require('../db');
const orders = require('../orders');
const { readBody, sendJson } = require('../http');

// Транзакция в состоянии «создана» живёт 12 часов, затем отменяется с причиной 4
const TX_TIMEOUT_MS = 12 * 60 * 60 * 1000;

const STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER_PERFORM: -2 };

const ERRORS = {
  [-32504]: { ru: 'Недостаточно привилегий', uz: 'Ruxsat yetarli emas', en: 'Insufficient privileges' },
  [-32700]: { ru: 'Ошибка разбора JSON', uz: 'JSON xatosi', en: 'Parse error' },
  [-32600]: { ru: 'Неверный запрос', uz: 'Noto‘g‘ri so‘rov', en: 'Invalid request' },
  [-32601]: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' },
  [-32400]: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' },
  [-31001]: { ru: 'Неверная сумма', uz: 'Noto‘g‘ri summa', en: 'Invalid amount' },
  [-31003]: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' },
  [-31007]: { ru: 'Заказ выполнен, отмена невозможна', uz: 'Buyurtma bajarilgan, bekor qilib bo‘lmaydi', en: 'Order completed, cannot cancel' },
  [-31008]: { ru: 'Невозможно выполнить операцию', uz: 'Amalni bajarib bo‘lmaydi', en: 'Unable to perform operation' },
  [-31050]: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' },
  [-31051]: { ru: 'Заказ уже оплачен или отменён', uz: 'Buyurtma to‘langan yoki bekor qilingan', en: 'Order already paid or cancelled' },
  [-31099]: { ru: 'Заказ ожидает оплаты другой транзакцией', uz: 'Buyurtma boshqa tranzaksiya bilan to‘lanmoqda', en: 'Order is awaiting another payment' },
};

class PaymeError extends Error {
  constructor(code, data) {
    super(ERRORS[code]?.en || 'Error');
    this.code = code;
    this.data = data;
  }
}

function isAuthorized(req) {
  if (!config.payme.enabled) return false;
  const match = /^Basic\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const expected = `Paycom:${config.payme.key}`;
  const a = crypto.createHash('sha256').update(decoded).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Распределяет скидку по строкам чека пропорционально сумме (метод наибольшего остатка). */
function allocateDiscount(discount, lineTotals) {
  const total = lineTotals.reduce((s, v) => s + v, 0);
  if (!discount || !total) return lineTotals.map(() => 0);
  const exact = lineTotals.map((v) => (discount * v) / total);
  const shares = exact.map(Math.floor);
  let rest = discount - shares.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    shares[i] += 1;
    rest -= 1;
  }
  return shares;
}

/**
 * Данные для фискального чека. Передаются, только когда у всех товаров
 * заполнены ИКПУ (MXIK) и код упаковки — иначе Payme отклонит чек.
 */
async function receiptDetail(order) {
  const items = await db.all('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]);
  if (!items.length || items.some((i) => !i.mxik || !i.package_code)) return undefined;
  const discounts = allocateDiscount(order.discount, items.map((i) => i.price * i.quantity));
  const ru = order.language === 'ru';
  const detail = {
    receipt_type: 0,
    items: items.map((i, index) => ({
      title: `${ru ? i.name_ru : i.name_uz}, ${i.size}`,
      price: i.price * 100,
      count: i.quantity,
      code: i.mxik,
      package_code: i.package_code,
      vat_percent: config.shop.vatPercent,
      discount: discounts[index] * 100,
    })),
  };
  if (order.delivery_price > 0) {
    detail.shipping = { title: ru ? 'Доставка' : 'Yetkazib berish', price: order.delivery_price * 100 };
  }
  return detail;
}

async function findOrder(account, { lock = false } = {}) {
  const id = Number(account?.order_id);
  if (!Number.isInteger(id) || id <= 0) throw new PaymeError(-31050, 'order_id');
  const order = await db.get(`SELECT * FROM orders WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!order) throw new PaymeError(-31050, 'order_id');
  return order;
}

function checkPayable(order, amount) {
  if (order.status === 'cancelled' || order.payment_status !== 'pending') throw new PaymeError(-31051, 'order_id');
  if (Number(amount) !== order.total * 100) throw new PaymeError(-31001);
}

const getTx = (externalId) =>
  db.get("SELECT * FROM payment_transactions WHERE provider = 'payme' AND external_id = $1 FOR UPDATE", [String(externalId)]);

const txId = (tx) => String(tx.id);

async function cancelTx(tx, state, reason) {
  const now = Date.now();
  await db.run('UPDATE payment_transactions SET state = $2, reason = $3, cancel_time = $4 WHERE id = $1', [tx.id, state, reason, now]);
  return { ...tx, state, reason, cancel_time: now };
}

const isExpired = (tx) => Date.now() - Number(tx.create_time) > TX_TIMEOUT_MS;

/**
 * Выполняет fn в транзакции БД. Ошибка Payme, возвращённая (а не брошенная) из fn,
 * пробрасывается после COMMIT — так сохраняется, например, отмена просроченной транзакции.
 */
async function inTx(fn) {
  const result = await db.transaction(fn);
  if (result instanceof PaymeError) throw result;
  return result;
}

const methods = {
  async CheckPerformTransaction(params) {
    const order = await findOrder(params.account);
    checkPayable(order, params.amount);
    const detail = await receiptDetail(order);
    return detail ? { allow: true, detail } : { allow: true };
  },

  async CreateTransaction(params) {
    if (!params.id || !Number.isFinite(Number(params.time))) throw new PaymeError(-32600);
    return inTx(async () => {
      const existing = await getTx(params.id);
      if (existing) {
        if (existing.state !== STATE.CREATED) return new PaymeError(-31008);
        if (isExpired(existing)) {
          await cancelTx(existing, STATE.CANCELLED, 4);
          return new PaymeError(-31008);
        }
        return { create_time: Number(existing.create_time), transaction: txId(existing), state: existing.state };
      }

      const order = await findOrder(params.account, { lock: true });
      checkPayable(order, params.amount);
      const busy = await db.get('SELECT 1 FROM payment_transactions WHERE order_id = $1 AND state = $2', [order.id, STATE.CREATED]);
      if (busy) throw new PaymeError(-31099, 'order_id');

      const createTime = Date.now();
      const { row } = await db.run(
        `INSERT INTO payment_transactions (provider, external_id, order_id, amount, state, provider_time, create_time)
         VALUES ('payme', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [String(params.id), order.id, Number(params.amount), STATE.CREATED, Number(params.time), createTime],
      );
      return { create_time: createTime, transaction: String(row.id), state: STATE.CREATED };
    });
  },

  async PerformTransaction(params) {
    return inTx(async () => {
      const tx = await getTx(params.id);
      if (!tx) throw new PaymeError(-31003);
      if (tx.state === STATE.PERFORMED) {
        return { transaction: txId(tx), perform_time: Number(tx.perform_time), state: tx.state };
      }
      if (tx.state !== STATE.CREATED) throw new PaymeError(-31008);
      if (isExpired(tx)) {
        await cancelTx(tx, STATE.CANCELLED, 4);
        return new PaymeError(-31008);
      }
      const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [tx.order_id]);
      if (!order || order.status === 'cancelled' || order.payment_status !== 'pending') throw new PaymeError(-31008);

      const performTime = Date.now();
      await db.run('UPDATE payment_transactions SET state = $2, perform_time = $3 WHERE id = $1', [tx.id, STATE.PERFORMED, performTime]);
      await orders.markPaid(order.id, 'payme');
      return { transaction: txId(tx), perform_time: performTime, state: STATE.PERFORMED };
    });
  },

  async CancelTransaction(params) {
    return inTx(async () => {
      let tx = await getTx(params.id);
      if (!tx) throw new PaymeError(-31003);
      const reason = Number.isInteger(Number(params.reason)) ? Number(params.reason) : null;
      if (tx.state === STATE.CREATED) {
        tx = await cancelTx(tx, STATE.CANCELLED, reason);
      } else if (tx.state === STATE.PERFORMED) {
        const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [tx.order_id]);
        if (order && order.status === 'delivered') throw new PaymeError(-31007);
        tx = await cancelTx(tx, STATE.CANCELLED_AFTER_PERFORM, reason);
        await orders.markRefunded(tx.order_id, 'payme');
      }
      return { transaction: txId(tx), cancel_time: Number(tx.cancel_time), state: tx.state };
    });
  },

  async CheckTransaction(params) {
    const tx = await db.get("SELECT * FROM payment_transactions WHERE provider = 'payme' AND external_id = $1", [String(params.id)]);
    if (!tx) throw new PaymeError(-31003);
    return {
      create_time: Number(tx.create_time),
      perform_time: Number(tx.perform_time),
      cancel_time: Number(tx.cancel_time),
      transaction: txId(tx),
      state: tx.state,
      reason: tx.reason,
    };
  },

  async GetStatement(params) {
    const rows = await db.all(
      `SELECT * FROM payment_transactions
        WHERE provider = 'payme' AND provider_time BETWEEN $1 AND $2 ORDER BY provider_time`,
      [Number(params.from) || 0, Number(params.to) || 0],
    );
    return {
      transactions: rows.map((tx) => ({
        id: tx.external_id,
        time: Number(tx.provider_time),
        amount: Number(tx.amount),
        account: { order_id: String(tx.order_id) },
        create_time: Number(tx.create_time),
        perform_time: Number(tx.perform_time),
        cancel_time: Number(tx.cancel_time),
        transaction: txId(tx),
        state: tx.state,
        reason: tx.reason,
      })),
    };
  },

  async SetFiscalData(params) {
    const { changes } = await db.run(
      `UPDATE payment_transactions
          SET fiscal_data = COALESCE(fiscal_data, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)
        WHERE provider = 'payme' AND external_id = $1`,
      [String(params.id), String(params.type || 'PERFORM'), JSON.stringify(params.fiscal_data ?? null)],
    );
    if (!changes) throw new PaymeError(-31003);
    return { success: true };
  },
};

function errorResponse(id, code, data) {
  const error = { code, message: ERRORS[code] || ERRORS[-32400] };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

async function handle(req, res) {
  let request;
  try {
    request = JSON.parse((await readBody(req)).toString('utf8'));
  } catch {
    sendJson(res, 200, errorResponse(null, -32700));
    return;
  }
  const id = request?.id ?? null;
  if (!isAuthorized(req)) {
    sendJson(res, 200, errorResponse(id, -32504));
    return;
  }
  const method = methods[request?.method];
  if (!method || !Object.hasOwn(methods, request.method)) {
    sendJson(res, 200, errorResponse(id, -32601, request?.method));
    return;
  }
  try {
    const result = await method(request.params || {});
    sendJson(res, 200, { jsonrpc: '2.0', id, result });
  } catch (error) {
    if (error instanceof PaymeError) {
      sendJson(res, 200, errorResponse(id, error.code, error.data));
      return;
    }
    console.error('Payme:', error);
    sendJson(res, 200, errorResponse(id, -32400));
  }
}

module.exports = { handle, allocateDiscount, TX_TIMEOUT_MS, STATE };

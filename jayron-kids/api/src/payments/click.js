'use strict';
/**
 * Click SHOP API. Click вызывает два адреса магазина:
 *   Prepare  (action=0) — проверка заказа перед списанием;
 *   Complete (action=1) — подтверждение оплаты.
 * Подпись: md5 от полей запроса и секретного ключа сервиса. Суммы — в сумах.
 */
const crypto = require('node:crypto');

const config = require('../config');
const db = require('../db');
const orders = require('../orders');
const { readForm, sendJson } = require('../http');

const ERRORS = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'User does not exist',
  [-6]: 'Transaction does not exist',
  [-7]: 'Failed to update user',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
};

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

function signatureValid(p, withPrepareId) {
  const source = [
    p.click_trans_id, p.service_id, config.click.secretKey, p.merchant_trans_id,
    withPrepareId ? p.merchant_prepare_id : '', p.amount, p.action, p.sign_time,
  ].join('');
  const expected = Buffer.from(md5(source));
  const actual = Buffer.from(String(p.sign_string || '').toLowerCase());
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const REQUIRED = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];

const amountMatches = (order, amount) => Math.abs(Number(amount) - order.total) < 0.01;

class ClickError extends Error {
  constructor(code) {
    super(ERRORS[code]);
    this.code = code;
  }
}

async function prepare(p) {
  if (String(p.action) !== '0') throw new ClickError(-3);
  return db.transaction(async () => {
    const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [Number(p.merchant_trans_id) || 0]);
    if (!order) throw new ClickError(-5);
    if (order.payment_status === 'paid') throw new ClickError(-4);
    if (order.status === 'cancelled' || order.payment_status !== 'pending') throw new ClickError(-9);
    if (!amountMatches(order, p.amount)) throw new ClickError(-2);

    const existing = await db.get(
      "SELECT * FROM payment_transactions WHERE provider = 'click' AND external_id = $1",
      [String(p.click_trans_id)],
    );
    if (existing) {
      if (existing.state < 0) throw new ClickError(-9);
      return { merchant_prepare_id: existing.id };
    }
    const busy = await db.get('SELECT 1 FROM payment_transactions WHERE order_id = $1 AND state = 1', [order.id]);
    if (busy) throw new ClickError(-4);

    const { row } = await db.run(
      `INSERT INTO payment_transactions (provider, external_id, order_id, amount, state, create_time)
       VALUES ('click', $1, $2, $3, 1, $4) RETURNING id`,
      [String(p.click_trans_id), order.id, Math.round(Number(p.amount) * 100), Date.now()],
    );
    return { merchant_prepare_id: row.id };
  });
}

async function complete(p) {
  if (String(p.action) !== '1') throw new ClickError(-3);
  const outcome = await db.transaction(async () => {
    const tx = await db.get(
      `SELECT * FROM payment_transactions
        WHERE id = $1 AND provider = 'click' AND external_id = $2 FOR UPDATE`,
      [Number(p.merchant_prepare_id) || 0, String(p.click_trans_id)],
    );
    if (!tx) return new ClickError(-6);
    const order = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [tx.order_id]);
    if (!order || String(order.id) !== String(p.merchant_trans_id)) return new ClickError(-5);
    if (tx.state === 2) return new ClickError(-4);
    if (tx.state < 0) return new ClickError(-9);
    if (!amountMatches(order, p.amount)) return new ClickError(-2);

    const cancel = () => db.run('UPDATE payment_transactions SET state = -1, cancel_time = $2 WHERE id = $1', [tx.id, Date.now()]);
    // Click сообщает об ошибке списания отрицательным error — транзакция отменяется
    if (Number(p.error) < 0) {
      await cancel();
      return new ClickError(-9);
    }
    if (order.payment_status === 'paid') {
      await cancel();
      return new ClickError(-4);
    }
    if (order.status === 'cancelled') {
      await cancel();
      return new ClickError(-9);
    }

    await db.run('UPDATE payment_transactions SET state = 2, perform_time = $2 WHERE id = $1', [tx.id, Date.now()]);
    await orders.markPaid(order.id, 'click');
    return { merchant_confirm_id: tx.id };
  });
  if (outcome instanceof ClickError) throw outcome;
  return outcome;
}

function handler(action) {
  return async (req, res) => {
    const p = await readForm(req);
    const base = { click_trans_id: p.click_trans_id ?? null, merchant_trans_id: p.merchant_trans_id ?? null };
    const reply = (code, extra = {}) => sendJson(res, 200, { ...base, ...extra, error: code, error_note: ERRORS[code] });
    try {
      const withPrepareId = action === 'complete';
      const required = withPrepareId ? [...REQUIRED, 'merchant_prepare_id'] : REQUIRED;
      if (!config.click.enabled || required.some((key) => p[key] === undefined || p[key] === '')) {
        reply(-8);
        return;
      }
      if (String(p.service_id) !== String(config.click.serviceId) || !signatureValid(p, withPrepareId)) {
        reply(-1);
        return;
      }
      const result = action === 'prepare' ? await prepare(p) : await complete(p);
      reply(0, result);
    } catch (error) {
      if (error instanceof ClickError) {
        reply(error.code);
        return;
      }
      console.error('Click:', error);
      reply(-7);
    }
  };
}

module.exports = { prepare: handler('prepare'), complete: handler('complete'), md5 };

'use strict';
/** Payme Merchant API и Click SHOP API: сценарии из песочниц платёжных систем. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, startServer, stopServer, request, loginCustomer, variantWithStock, checkout } = require('./helpers');
const { md5 } = require('../src/payments/click');
const { allocateDiscount, TX_TIMEOUT_MS } = require('../src/payments/payme');

test.before(startServer);
test.after(stopServer);

const paymeAuth = (key = 'test-payme-key') => ({ authorization: `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}` });

let rpcId = 0;
async function payme(method, params, headers = paymeAuth()) {
  const { status, data } = await request('POST', '/api/payments/payme', {
    body: { method, params, id: (rpcId += 1) }, headers,
  });
  assert.equal(status, 200, 'Payme всегда получает HTTP 200');
  return data;
}

async function newOrder(paymentMethod, quantity = 1) {
  const { token } = await loginCustomer();
  const variant = await variantWithStock(quantity);
  const { status, data } = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity }], { paymentMethod }),
  });
  assert.equal(status, 201, JSON.stringify(data));
  return { order: data, token, variant };
}

test('распределение скидки по строкам чека сохраняет сумму', () => {
  assert.deepEqual(allocateDiscount(0, [100, 200]), [0, 0]);
  assert.deepEqual(allocateDiscount(100, [100, 100, 100]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(allocateDiscount(30000, [69000, 138000]), [10000, 20000]);
});

test('Payme: авторизация и ошибки запроса', async () => {
  const { order } = await newOrder('payme');
  const denied = await payme('CheckPerformTransaction', { amount: order.total * 100, account: { order_id: order.id } }, paymeAuth('wrong'));
  assert.equal(denied.error.code, -32504);
  const noAuth = await payme('CheckPerformTransaction', {}, {});
  assert.equal(noAuth.error.code, -32504);

  const unknown = await payme('DropTables', {});
  assert.equal(unknown.error.code, -32601);
  const proto = await payme('toString', {});
  assert.equal(proto.error.code, -32601);

  const broken = await request('POST', '/api/payments/payme', { body: '{oops', headers: paymeAuth() });
  assert.equal(broken.data.error.code, -32700);

  const notFound = await payme('CheckPerformTransaction', { amount: 100, account: { order_id: 999999 } });
  assert.equal(notFound.error.code, -31050);
  assert.equal(notFound.error.data, 'order_id');
  assert.ok(notFound.error.message.ru && notFound.error.message.uz && notFound.error.message.en);

  const wrongAmount = await payme('CheckPerformTransaction', { amount: order.total, account: { order_id: order.id } });
  assert.equal(wrongAmount.error.code, -31001);
});

test('Payme: создание, проведение, проверка, отмена с возвратом на склад', async () => {
  const { order, token, variant } = await newOrder('payme');
  const amount = order.total * 100;
  const account = { order_id: String(order.id) };

  const check = await payme('CheckPerformTransaction', { amount, account });
  assert.deepEqual(check.result, { allow: true }, 'без ИКПУ данные чека не передаются');

  const txId = `payme-${Date.now()}`;
  const created = await payme('CreateTransaction', { id: txId, time: Date.now(), amount, account });
  assert.equal(created.result.state, 1);
  assert.ok(created.result.create_time > 0);

  // Повторный вызов с тем же id возвращает ту же транзакцию
  const again = await payme('CreateTransaction', { id: txId, time: Date.now(), amount, account });
  assert.deepEqual(again.result, created.result);

  // Вторая транзакция на тот же заказ не создаётся
  const busy = await payme('CreateTransaction', { id: `${txId}-2`, time: Date.now(), amount, account });
  assert.equal(busy.error.code, -31099);

  // Покупатель не может отменить заказ, пока идёт оплата
  assert.equal((await request('POST', `/api/orders/${order.id}/cancel`, { token })).data.error, 'payment_in_progress');

  const performed = await payme('PerformTransaction', { id: txId });
  assert.equal(performed.result.state, 2);
  assert.equal(performed.result.transaction, created.result.transaction);
  const repeat = await payme('PerformTransaction', { id: txId });
  assert.deepEqual(repeat.result, performed.result);

  const { data: paid } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.paymentUrl, null);
  assert.ok(paid.history.some((h) => h.status === 'paid' && h.note === 'payme'));

  // Оплаченный заказ больше нельзя оплатить
  const recheck = await payme('CheckPerformTransaction', { amount, account });
  assert.equal(recheck.error.code, -31051);

  const status = await payme('CheckTransaction', { id: txId });
  assert.equal(status.result.state, 2);
  assert.equal(status.result.perform_time, performed.result.perform_time);
  assert.equal(status.result.cancel_time, 0);
  assert.equal(status.result.reason, null);

  const stockBefore = (await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id])).stock;
  const cancelled = await payme('CancelTransaction', { id: txId, reason: 5 });
  assert.equal(cancelled.result.state, -2);
  const cancelledAgain = await payme('CancelTransaction', { id: txId, reason: 5 });
  assert.deepEqual(cancelledAgain.result, cancelled.result);

  const { data: refunded } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(refunded.status, 'cancelled');
  assert.equal(refunded.paymentStatus, 'refunded');
  assert.equal((await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id])).stock, stockBefore + 1);

  const statement = await payme('GetStatement', { from: 0, to: Date.now() + 1000 });
  const entry = statement.result.transactions.find((t) => t.id === txId);
  assert.equal(entry.state, -2);
  assert.equal(entry.reason, 5);
  assert.deepEqual(entry.account, { order_id: String(order.id) });

  assert.equal((await payme('CheckTransaction', { id: 'missing' })).error.code, -31003);
  assert.equal((await payme('PerformTransaction', { id: 'missing' })).error.code, -31003);
});

test('Payme: отмена до проведения оставляет заказ ожидающим оплаты', async () => {
  const { order, token } = await newOrder('payme');
  const params = { time: Date.now(), amount: order.total * 100, account: { order_id: order.id } };
  await payme('CreateTransaction', { id: 'tx-cancel-1', ...params });
  const cancelled = await payme('CancelTransaction', { id: 'tx-cancel-1', reason: 3 });
  assert.equal(cancelled.result.state, -1);
  assert.equal((await payme('PerformTransaction', { id: 'tx-cancel-1' })).error.code, -31008);

  const { data } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(data.status, 'new');
  assert.equal(data.paymentStatus, 'pending');

  // Покупатель может попробовать оплатить снова
  const retry = await payme('CreateTransaction', { id: 'tx-cancel-2', ...params });
  assert.equal(retry.result.state, 1);
});

test('Payme: просроченная транзакция отменяется с причиной 4', async () => {
  const { order } = await newOrder('payme');
  await payme('CreateTransaction', { id: 'tx-old', time: Date.now(), amount: order.total * 100, account: { order_id: order.id } });
  await db.run("UPDATE payment_transactions SET create_time = create_time - $1 WHERE external_id = 'tx-old'", [TX_TIMEOUT_MS + 1000]);
  const performed = await payme('PerformTransaction', { id: 'tx-old' });
  assert.equal(performed.error.code, -31008);
  const status = await payme('CheckTransaction', { id: 'tx-old' });
  assert.equal(status.result.state, -1);
  assert.equal(status.result.reason, 4);
});

test('Payme: доставленный заказ нельзя вернуть; фискальные данные чека', async () => {
  const { order } = await newOrder('payme', 2);
  await db.run("UPDATE order_items SET mxik = '06109001001000000', package_code = '1502828' WHERE order_id = $1", [order.id]);
  const amount = order.total * 100;
  const check = await payme('CheckPerformTransaction', { amount, account: { order_id: order.id } });
  const { detail } = check.result;
  assert.equal(detail.receipt_type, 0);
  assert.equal(detail.items[0].code, '06109001001000000');
  assert.equal(detail.items[0].count, 2);
  assert.equal(detail.shipping.price, order.deliveryPrice * 100);
  const sum = detail.items.reduce((s, i) => s + i.price * i.count - i.discount, 0) + detail.shipping.price;
  assert.equal(sum, amount, 'сумма чека совпадает с суммой платежа');

  await payme('CreateTransaction', { id: 'tx-delivered', time: Date.now(), amount, account: { order_id: order.id } });
  await payme('PerformTransaction', { id: 'tx-delivered' });
  await db.run("UPDATE orders SET status = 'delivered' WHERE id = $1", [order.id]);
  assert.equal((await payme('CancelTransaction', { id: 'tx-delivered', reason: 5 })).error.code, -31007);

  const fiscal = await payme('SetFiscalData', { id: 'tx-delivered', type: 'PERFORM', fiscal_data: { receipt_id: 1, qr_code_url: 'https://ofd.soliq.uz/check?t=1' } });
  assert.deepEqual(fiscal.result, { success: true });
  const saved = await db.get("SELECT fiscal_data FROM payment_transactions WHERE external_id = 'tx-delivered'");
  assert.equal(saved.fiscal_data.PERFORM.receipt_id, 1);
});

// ---------------------------------------------------------------- Click
function clickParams(order, action, extra = {}) {
  const p = {
    click_trans_id: extra.click_trans_id || String(Date.now()),
    service_id: '1001',
    click_paydoc_id: '555',
    merchant_trans_id: String(order.id),
    amount: extra.amount || `${order.total}.00`,
    action: String(action),
    error: extra.error || '0',
    error_note: 'Success',
    sign_time: '2026-09-29 12:00:00',
    ...(action === 1 ? { merchant_prepare_id: String(extra.merchant_prepare_id) } : {}),
  };
  p.sign_string = md5(
    p.click_trans_id + p.service_id + 'test-click-secret' + p.merchant_trans_id
    + (action === 1 ? p.merchant_prepare_id : '') + p.amount + p.action + p.sign_time,
  );
  return p;
}

async function click(path, params) {
  const { status, data } = await request('POST', `/api/payments/click/${path}`, {
    body: new URLSearchParams(params).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(status, 200);
  return data;
}

test('Click: prepare и complete переводят заказ в оплаченные', async () => {
  const { order, token } = await newOrder('click');
  assert.match(order.paymentUrl, /^https:\/\/my\.click\.uz\/services\/pay\?/);
  assert.match(order.paymentUrl, new RegExp(`transaction_param=${order.id}`));

  const prepared = await click('prepare', clickParams(order, 0, { click_trans_id: '9001' }));
  assert.equal(prepared.error, 0, JSON.stringify(prepared));
  assert.ok(prepared.merchant_prepare_id > 0);
  assert.equal(prepared.click_trans_id, '9001');

  const completed = await click('complete', clickParams(order, 1, { click_trans_id: '9001', merchant_prepare_id: prepared.merchant_prepare_id }));
  assert.equal(completed.error, 0, JSON.stringify(completed));
  assert.equal(completed.merchant_confirm_id, prepared.merchant_prepare_id);

  const { data } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(data.paymentStatus, 'paid');

  const twice = await click('complete', clickParams(order, 1, { click_trans_id: '9001', merchant_prepare_id: prepared.merchant_prepare_id }));
  assert.equal(twice.error, -4);
  assert.equal((await click('prepare', clickParams(order, 0, { click_trans_id: '9002' }))).error, -4);
});

test('Click: подпись, сумма, отказ списания', async () => {
  const { order, token } = await newOrder('click');

  const forged = { ...clickParams(order, 0), sign_string: 'deadbeef' };
  assert.equal((await click('prepare', forged)).error, -1);
  assert.equal((await click('prepare', clickParams(order, 0, { amount: '1000' }))).error, -2);
  assert.equal((await click('prepare', clickParams({ ...order, id: 999999 }, 0))).error, -5);
  assert.equal((await click('prepare', { action: '0' })).error, -8);
  const wrongAction = { ...clickParams(order, 0), action: '1' };
  wrongAction.sign_string = md5(
    wrongAction.click_trans_id + wrongAction.service_id + 'test-click-secret' + wrongAction.merchant_trans_id
    + wrongAction.amount + wrongAction.action + wrongAction.sign_time,
  );
  assert.equal((await click('prepare', wrongAction)).error, -3);

  const prepared = await click('prepare', clickParams(order, 0, { click_trans_id: '9100' }));
  assert.equal(prepared.error, 0);
  const failed = await click('complete', clickParams(order, 1, {
    click_trans_id: '9100', merchant_prepare_id: prepared.merchant_prepare_id, error: '-5017',
  }));
  assert.equal(failed.error, -9);
  const { data } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(data.paymentStatus, 'pending');

  const missing = await click('complete', clickParams(order, 1, { click_trans_id: '9100', merchant_prepare_id: 424242 }));
  assert.equal(missing.error, -6);
});

test('учебная оплата: страница, оплата, возврат в приложение', async () => {
  const { demoUrl } = require('../src/payments/links');
  const { order, token } = await newOrder('payme');
  const path = demoUrl(order.id).replace('https://shop.example.uz', '');

  assert.equal((await request('GET', `/pay/demo/${order.id}?sig=forged`)).status, 403);
  const page = await request('GET', path);
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(`№${order.id}`));

  const paid = await fetch(`${require('./helpers').baseUrl}${path}`, { method: 'POST', redirect: 'manual' });
  assert.equal(paid.status, 303);
  assert.equal(paid.headers.get('location'), `/pay/return/${order.id}`);

  const { data } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(data.paymentStatus, 'paid');
  const back = await request('GET', `/pay/return/${order.id}`);
  assert.match(back.data, /To‘lov qabul qilindi/);
  assert.match(back.data, new RegExp(`jayronkids://orders/${order.id}`));
});

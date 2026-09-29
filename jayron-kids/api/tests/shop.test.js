'use strict';
/** Каталог, вход по SMS, корзина и заказы глазами покупателя. */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  db, startServer, stopServer, request, loginCustomer, loginAdmin, variantWithStock, checkout,
} = require('./helpers');
const { outbox } = require('../src/sms');
const orders = require('../src/orders');

test.before(startServer);
test.after(stopServer);

test('каталог: категории, фильтры, карточка товара', async () => {
  const categories = await request('GET', '/api/categories');
  assert.equal(categories.status, 200);
  assert.equal(categories.data.length, 9);
  assert.deepEqual(categories.data[0].name, { uz: 'Chaqaloqlar uchun', ru: 'Для малышей' });

  const all = await request('GET', '/api/products');
  assert.equal(all.data.total, 16);

  const girls = await request('GET', '/api/products?gender=girl');
  assert.ok(girls.data.items.every((p) => p.gender === 'girl' || p.gender === 'unisex'));
  assert.ok(girls.data.items.some((p) => p.gender === 'girl'));

  const dresses = await request('GET', '/api/products?category=koylaklar');
  assert.equal(dresses.data.total, 2);

  const cheap = await request('GET', '/api/products?sort=price_asc&limit=3');
  const prices = cheap.data.items.map((p) => p.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const search = await request('GET', `/api/products?q=${encodeURIComponent('пижама')}`);
  assert.equal(search.data.items[0].slug, 'pijama-oy');

  // Спецсимволы LIKE не ломают поиск
  const special = await request('GET', `/api/products?q=${encodeURIComponent('100%_')}`);
  assert.equal(special.status, 200);
  assert.equal(special.data.total, 0);

  const byIds = await request('GET', '/api/products?ids=1,3');
  assert.deepEqual(byIds.data.items.map((p) => p.id).sort(), [1, 3]);

  const product = await request('GET', '/api/products/kostyum-sarguzasht');
  assert.equal(product.status, 200);
  assert.equal(product.data.colors.length, 3);
  assert.deepEqual(product.data.sizes, ['92', '98', '104', '110', '116', '122', '128', '134']);
  assert.equal(product.data.variants.length, 24);
  assert.ok(product.data.description.ru.length > 10);

  assert.equal((await request('GET', '/api/products/net-takogo')).status, 404);
});

test('вход по SMS: код, неверные попытки, повторная отправка', async () => {
  const phone = '+998 (93) 555-12-34';
  const sent = await request('POST', '/api/auth/request-code', { body: { phone, language: 'ru' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.phone, '998935551234');
  assert.match(sent.data.debugCode, /^\d{5}$/);
  assert.match(outbox.at(-1).message, new RegExp(sent.data.debugCode));
  assert.match(outbox.at(-1).message, /код для входа/);

  const tooSoon = await request('POST', '/api/auth/request-code', { body: { phone } });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.data.error, 'otp_too_soon');

  const wrongCode = sent.data.debugCode === '00000' ? '11111' : '00000';
  const wrong = await request('POST', '/api/auth/verify', { body: { phone, code: wrongCode } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, 'otp_invalid');
  assert.equal(wrong.data.details.attemptsLeft, 4);

  const ok = await request('POST', '/api/auth/verify', { body: { phone, code: sent.data.debugCode } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.customer.phoneFormatted, '+998 93 555 12 34');

  // Код одноразовый
  const reused = await request('POST', '/api/auth/verify', { body: { phone, code: sent.data.debugCode } });
  assert.equal(reused.data.error, 'otp_expired');

  const me = await request('GET', '/api/me', { token: ok.data.token });
  assert.equal(me.data.phone, '998935551234');
  const renamed = await request('PATCH', '/api/me', { token: ok.data.token, body: { name: 'Aziz', language: 'ru' } });
  assert.equal(renamed.data.name, 'Aziz');
  assert.equal(renamed.data.language, 'ru');

  await request('POST', '/api/auth/logout', { token: ok.data.token });
  assert.equal((await request('GET', '/api/me', { token: ok.data.token })).status, 401);

  assert.equal((await request('POST', '/api/auth/request-code', { body: { phone: '+7 999 123 45 67' } })).data.error, 'invalid_phone');
});

test('перебор кода блокируется после пяти попыток', async () => {
  const phone = '998971112233';
  const sent = await request('POST', '/api/auth/request-code', { body: { phone } });
  const wrongCode = sent.data.debugCode === '00000' ? '11111' : '00000';
  for (let i = 0; i < 5; i += 1) {
    await request('POST', '/api/auth/verify', { body: { phone, code: wrongCode } });
  }
  const blocked = await request('POST', '/api/auth/verify', { body: { phone, code: sent.data.debugCode } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, 'otp_attempts');
});

test('расчёт корзины: доставка, промокод, бесплатная доставка, минимальная сумма', async () => {
  const variant = await variantWithStock(3);

  const courier = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'courier', regionCode: 'tashkent_city' },
  });
  assert.equal(courier.status, 200);
  assert.equal(courier.data.subtotal, variant.price);
  assert.equal(courier.data.delivery, 25000);
  assert.equal(courier.data.total, variant.price + 25000);
  assert.equal(courier.data.lines[0].mxik, undefined, 'служебные поля чека не уходят клиенту');

  const noCourier = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'courier', regionCode: 'khorezm' },
  });
  assert.ok(noCourier.data.problems.some((p) => p.code === 'courier_unavailable'));

  const post = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'post', regionCode: 'khorezm' },
  });
  assert.equal(post.data.delivery, 40000);

  const big = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 3 }], deliveryMethod: 'post', regionCode: 'andijan', promoCode: 'salom10' },
  });
  const subtotal = variant.price * 3;
  assert.equal(big.data.promo.applied, subtotal >= 200000);
  if (subtotal >= 200000) assert.equal(big.data.discount, Math.floor(subtotal / 10));
  if (subtotal - big.data.discount >= 500000) assert.equal(big.data.delivery, 0);

  const unknownPromo = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 1 }], promoCode: 'NOPE' },
  });
  assert.equal(unknownPromo.data.promo.error, 'promo_not_found');

  const cheap = await db.get("SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.price < 50000 LIMIT 1");
  if (cheap) {
    const small = await request('POST', '/api/cart/quote', { body: { items: [{ variantId: cheap.id, quantity: 1 }] } });
    assert.ok(small.data.problems.some((p) => p.code === 'min_order'));
  }

  const pickup = await request('POST', '/api/cart/quote', {
    body: { items: [{ variantId: variant.id, quantity: 1 }], deliveryMethod: 'pickup' },
  });
  assert.equal(pickup.data.delivery, 0);
  assert.deepEqual(pickup.data.problems, []);

  assert.equal((await request('POST', '/api/cart/quote', { body: { items: [] } })).data.error, 'cart_empty');
});

test('заказ: резерв на складе, история, чужой заказ недоступен, отмена возвращает товар', async () => {
  const { token, customer } = await loginCustomer();
  const variant = await variantWithStock(2);

  const created = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 2 }], { comment: 'Qo‘ng‘iroq qiling' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, 'new');
  assert.equal(created.data.paymentStatus, 'pending');
  assert.equal(created.data.paymentUrl, null, 'для оплаты наличными ссылки нет');
  assert.equal(created.data.items[0].quantity, 2);
  assert.ok(created.data.id >= 1001);

  const after = await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id]);
  assert.equal(after.stock, variant.stock - 2);

  const saved = await db.get('SELECT name, last_address FROM customers WHERE id = $1', [customer.id]);
  assert.equal(saved.name, 'Dilnoza Karimova');
  assert.equal(saved.last_address.regionCode, 'tashkent_city');

  const list = await request('GET', '/api/orders', { token });
  assert.equal(list.data[0].id, created.data.id);

  const stranger = await loginCustomer();
  assert.equal((await request('GET', `/api/orders/${created.data.id}`, { token: stranger.token })).status, 404);
  assert.equal((await request('POST', `/api/orders/${created.data.id}/cancel`, { token: stranger.token })).status, 404);
  assert.equal((await request('GET', '/api/orders')).status, 401);

  const cancelled = await request('POST', `/api/orders/${created.data.id}/cancel`, { token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.deepEqual(cancelled.data.history.map((h) => h.status), ['new', 'cancelled']);
  const restored = await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id]);
  assert.equal(restored.stock, variant.stock);

  // Повторная отмена не возвращает товар второй раз
  assert.equal((await request('POST', `/api/orders/${created.data.id}/cancel`, { token })).status, 409);
  assert.equal((await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id])).stock, variant.stock);
});

test('заказ: проверка полей и нехватка товара', async () => {
  const { token } = await loginCustomer();
  const variant = await variantWithStock(1);

  const badAddress = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { address: '' }),
  });
  assert.equal(badAddress.data.error, 'invalid_address');

  const badPhone = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { recipientPhone: '12345' }),
  });
  assert.equal(badPhone.data.error, 'invalid_phone');

  const tooMany = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: variant.stock + 1 }]),
  });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.data.error, 'cart_problems');
  assert.equal(tooMany.data.details.problems[0].code, 'out_of_stock');
  assert.equal(tooMany.data.details.problems[0].available, variant.stock);

  const badPromo = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { promoCode: 'NOPE' }),
  });
  assert.equal(badPromo.data.error, 'promo_invalid');

  // Самовывоз не требует адреса
  const pickup = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { deliveryMethod: 'pickup', address: '', city: '' }),
  });
  assert.equal(pickup.status, 201, JSON.stringify(pickup.data));
  assert.equal(pickup.data.deliveryPrice, 0);
  assert.equal(pickup.data.regionCode, null);
});

test('последний размер не продаётся дважды при одновременных заказах', async () => {
  const variant = await variantWithStock(1);
  await db.run('UPDATE product_variants SET stock = 1 WHERE id = $1', [variant.id]);
  const buyers = await Promise.all([loginCustomer(), loginCustomer(), loginCustomer()]);
  const results = await Promise.all(buyers.map(({ token }) => request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }]),
  })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.equal((await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id])).stock, 0);
});

test('промокод с лимитом использований', async () => {
  await db.run("INSERT INTO promo_codes (code, kind, value, max_uses) VALUES ('ONCE', 'fixed', 10000, 1)");
  const { token } = await loginCustomer();
  const variant = await variantWithStock(2);
  const first = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { promoCode: 'once' }),
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.discount, 10000);
  assert.equal(first.data.promoCode, 'ONCE');
  const second = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { promoCode: 'ONCE' }),
  });
  assert.equal(second.data.error, 'promo_invalid');
});

test('статусы заказа: переходы менеджера, оплата наличными при вручении', async () => {
  const { token } = await loginCustomer();
  const adminToken = await loginAdmin();
  const variant = await variantWithStock(1);
  const { data: order } = await request('POST', '/api/orders', { token, body: checkout([{ variantId: variant.id, quantity: 1 }]) });

  const skip = await request('PATCH', `/api/admin/orders/${order.id}`, { token: adminToken, body: { status: 'delivered' } });
  assert.equal(skip.data.error, 'invalid_transition');

  for (const status of ['confirmed', 'shipped', 'delivered']) {
    const step = await request('PATCH', `/api/admin/orders/${order.id}`, { token: adminToken, body: { status } });
    assert.equal(step.status, 200, JSON.stringify(step.data));
    assert.equal(step.data.status, status);
  }
  const { data: final } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(final.paymentStatus, 'paid');
  assert.deepEqual(final.history.map((h) => h.status), ['new', 'confirmed', 'shipped', 'delivered', 'paid']);
  assert.equal(final.canCancel, false);

  const late = await request('PATCH', `/api/admin/orders/${order.id}`, { token: adminToken, body: { status: 'cancelled' } });
  assert.equal(late.data.error, 'invalid_transition');
});

test('неоплаченный онлайн-заказ отменяется по истечении срока', async () => {
  const { token } = await loginCustomer();
  const variant = await variantWithStock(1);
  const { data: order } = await request('POST', '/api/orders', {
    token, body: checkout([{ variantId: variant.id, quantity: 1 }], { paymentMethod: 'payme' }),
  });
  assert.match(order.paymentUrl, /^https:\/\/checkout\.test\.paycom\.uz\//);
  const decoded = Buffer.from(order.paymentUrl.split('/').pop(), 'base64').toString();
  assert.match(decoded, new RegExp(`ac.order_id=${order.id};a=${order.total * 100};`));

  assert.equal(await orders.cancelUnpaidOrders(), 0, 'свежий заказ не трогаем');
  await db.run("UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1", [order.id]);
  assert.equal(await orders.cancelUnpaidOrders(), 1);

  const { data: after } = await request('GET', `/api/orders/${order.id}`, { token });
  assert.equal(after.status, 'cancelled');
  assert.equal(after.paymentStatus, 'cancelled');
  assert.equal(after.paymentUrl, null);
  assert.equal((await db.get('SELECT stock FROM product_variants WHERE id = $1', [variant.id])).stock, variant.stock);
});

test('удаление аккаунта: нельзя при активном заказе, после удаления вход — как новый покупатель', async () => {
  const phone = '998881234567';
  const { token, customer } = await loginCustomer(phone);
  const adminToken = await loginAdmin();
  const variant = await variantWithStock(1);
  const { data: order } = await request('POST', '/api/orders', { token, body: checkout([{ variantId: variant.id, quantity: 1 }]) });

  const blocked = await request('DELETE', '/api/me', { token });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'active_orders');

  await request('PATCH', `/api/admin/orders/${order.id}`, { token: adminToken, body: { status: 'cancelled' } });
  assert.equal((await request('DELETE', '/api/me', { token })).status, 200);
  assert.equal((await request('GET', '/api/me', { token })).status, 401);

  const erased = await db.get('SELECT phone, name, last_address FROM customers WHERE id = $1', [customer.id]);
  assert.equal(erased.phone, `deleted-${customer.id}`);
  assert.equal(erased.name, '');
  assert.equal(erased.last_address, null);
  // Заказ остаётся в учёте магазина
  assert.ok(await db.get('SELECT 1 FROM orders WHERE id = $1', [order.id]));

  const again = await loginCustomer(phone);
  assert.notEqual(again.customer.id, customer.id);
  assert.deepEqual((await request('GET', '/api/orders', { token: again.token })).data, []);
});

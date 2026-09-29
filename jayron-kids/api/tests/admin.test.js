'use strict';
/** Панель управления: вход, товары, варианты, фотографии, промокоды, доставка. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer, stopServer, request, loginAdmin, loginCustomer, variantWithStock, checkout } = require('./helpers');

test.before(startServer);
test.after(stopServer);

// Минимальный PNG 1×1
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db40000000049454e44ae426082',
  'hex',
);

test('вход администратора и защита маршрутов', async () => {
  assert.equal((await request('GET', '/api/admin/orders')).status, 401);
  assert.equal((await request('POST', '/api/admin/login', { body: { password: 'nope' } })).status, 401);

  // Токен покупателя не открывает панель
  const { token: customerToken } = await loginCustomer();
  assert.equal((await request('GET', '/api/admin/orders', { token: customerToken })).status, 401);

  const token = await loginAdmin();
  const summary = await request('GET', '/api/admin/summary', { token });
  assert.equal(summary.status, 200);
  assert.ok(Array.isArray(summary.data.lowStock));

  await request('POST', '/api/admin/logout', { token });
  assert.equal((await request('GET', '/api/admin/summary', { token })).status, 401);
});

test('панель управления отдаётся с политикой безопасности', async () => {
  const page = await request('GET', '/admin/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.data, /Jayron Kids/);
  assert.equal((await request('GET', '/admin/../src/config.js')).status, 404);
});

test('товар: создание, изменение, варианты, фотографии', async () => {
  const token = await loginAdmin();
  const { data: categories } = await request('GET', '/api/admin/categories', { token });

  const invalid = await request('POST', '/api/admin/products', { token, body: { slug: 'Bad Slug' } });
  assert.equal(invalid.data.error, 'invalid_slug');

  const created = await request('POST', '/api/admin/products', {
    token,
    body: {
      slug: 'svitshot-test', categoryId: categories[2].id, nameUz: 'Svitshot test', nameRu: 'Свитшот тест',
      gender: 'unisex', kind: 'sweatshirt', price: 150000, isActive: false,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;

  const duplicate = await request('POST', '/api/admin/products', {
    token,
    body: { slug: 'svitshot-test', categoryId: categories[2].id, nameUz: 'X', nameRu: 'X', gender: 'unisex', kind: 'hoodie', price: 1 },
  });
  assert.equal(duplicate.data.error, 'slug_taken');

  // Скрытый товар не виден в приложении
  assert.equal((await request('GET', '/api/products/svitshot-test')).status, 404);

  const badMxik = await request('PATCH', `/api/admin/products/${id}`, { token, body: { mxik: '123' } });
  assert.equal(badMxik.data.error, 'invalid_mxik');

  const updated = await request('PATCH', `/api/admin/products/${id}`, {
    token, body: { isActive: true, oldPrice: 180000, mxik: '06110001001000000', packageCode: '1502828' },
  });
  assert.equal(updated.data.isActive, true);
  assert.equal(updated.data.oldPrice, 180000);

  const variants = await request('PUT', `/api/admin/products/${id}/variants`, {
    token,
    body: {
      variants: [
        { size: '104', colorCode: 'sky', colorHex: '#4FB6F2', colorNameUz: 'Osmon rang', colorNameRu: 'Голубой', stock: 5 },
        { size: '110', colorCode: 'sky', colorHex: '#4FB6F2', colorNameUz: 'Osmon rang', colorNameRu: 'Голубой', stock: 0 },
      ],
    },
  });
  assert.equal(variants.status, 200, JSON.stringify(variants.data));
  assert.deepEqual(variants.data.sizes, ['104', '110']);

  const visible = await request('GET', '/api/products/svitshot-test');
  assert.equal(visible.status, 200);
  assert.equal(visible.data.inStock, true);

  // Заказанный вариант при удалении из списка обнуляется, а не удаляется
  const { token: buyer } = await loginCustomer();
  const v104 = visible.data.variants.find((v) => v.size === '104');
  const order = await request('POST', '/api/orders', { token: buyer, body: checkout([{ variantId: v104.id, quantity: 1 }]) });
  assert.equal(order.status, 201);
  const replaced = await request('PUT', `/api/admin/products/${id}/variants`, {
    token,
    body: { variants: [{ size: '116', colorCode: 'leaf', colorHex: '#8BC34A', colorNameUz: 'Yashil', colorNameRu: 'Зелёный', stock: 3 }] },
  });
  assert.deepEqual(replaced.data.sizes, ['104', '116']);
  assert.equal(replaced.data.variants.find((v) => v.size === '104').stock, 0);

  const badVariant = await request('PUT', `/api/admin/products/${id}/variants`, {
    token, body: { variants: [{ size: '98', colorCode: 'x', colorHex: 'red', colorNameUz: 'a', colorNameRu: 'b', stock: 1 }] },
  });
  assert.equal(badVariant.data.error, 'invalid_variant');

  // Фотографии
  const fake = await request('POST', `/api/admin/products/${id}/images`, {
    token, body: Buffer.from('not an image at all'), headers: { 'content-type': 'image/png' },
  });
  assert.equal(fake.data.error, 'invalid_image');
  const uploaded = await request('POST', `/api/admin/products/${id}/images`, {
    token, body: PNG, headers: { 'content-type': 'image/png' },
  });
  assert.equal(uploaded.status, 201);
  const [url] = uploaded.data.images;
  assert.match(url, /^\/uploads\/\d+-[0-9a-f]{16}\.png$/);
  const image = await fetch(`${require('./helpers').baseUrl}${url}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');

  const removed = await request('DELETE', `/api/admin/products/${id}/images?url=${encodeURIComponent(url)}`, { token });
  assert.deepEqual(removed.data.images, []);
  assert.equal((await fetch(`${require('./helpers').baseUrl}${url}`)).status, 404);
});

test('заказы в панели: список, поиск по телефону, карточка', async () => {
  const token = await loginAdmin();
  const { token: buyer } = await loginCustomer('998991234567');
  const variant = await variantWithStock(1);
  const { data: order } = await request('POST', '/api/orders', {
    token: buyer, body: checkout([{ variantId: variant.id, quantity: 1 }], { recipientPhone: '998991234567' }),
  });

  const list = await request('GET', '/api/admin/orders?status=new', { token });
  assert.ok(list.data.some((o) => o.id === order.id));
  const found = await request('GET', '/api/admin/orders?q=99%20123', { token });
  assert.ok(found.data.some((o) => o.id === order.id));
  const byId = await request('GET', `/api/admin/orders?q=${order.id}`, { token });
  assert.equal(byId.data[0].id, order.id);

  const card = await request('GET', `/api/admin/orders/${order.id}`, { token });
  assert.deepEqual(card.data.transitions, ['confirmed', 'cancelled']);
  assert.equal(card.data.customer.phone, '+998 99 123 45 67');

  const cancelled = await request('PATCH', `/api/admin/orders/${order.id}`, { token, body: { status: 'cancelled', note: 'Mijoz rad etdi' } });
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal(cancelled.data.history.at(-1).note, 'Mijoz rad etdi');
});

test('промокоды и цены доставки', async () => {
  const token = await loginAdmin();
  const created = await request('POST', '/api/admin/promo-codes', {
    token, body: { code: 'bolajon', kind: 'percent', value: 15, minTotal: 100000, maxUses: 50 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.code, 'BOLAJON');
  assert.equal((await request('POST', '/api/admin/promo-codes', { token, body: { code: 'BOLAJON', value: 5 } })).data.error, 'promo_exists');
  assert.equal((await request('POST', '/api/admin/promo-codes', { token, body: { code: 'MUCH', value: 95 } })).data.error, 'invalid_promo_value');

  const disabled = await request('PATCH', '/api/admin/promo-codes/BOLAJON', { token, body: { isActive: false } });
  assert.equal(disabled.data.isActive, false);
  assert.equal(disabled.data.value, 15);

  const regions = await request('PATCH', '/api/admin/regions/samarkand', {
    token, body: { courierPrice: 30000, postPrice: 28000, postDays: '1-2' },
  });
  const samarkand = regions.data.find((r) => r.code === 'samarkand');
  assert.equal(samarkand.courierPrice, 30000);
  assert.equal(samarkand.postPrice, 28000);
});

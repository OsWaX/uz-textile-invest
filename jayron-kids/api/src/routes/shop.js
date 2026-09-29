'use strict';
/** Маршруты для мобильного приложения: каталог, вход, профиль, корзина, заказы. */
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const catalog = require('../catalog');
const orders = require('../orders');
const { buildQuote, publicQuote } = require('../pricing');
const { availableMethods } = require('../payments/links');
const { Router, sendJson, readJson, conflict } = require('../http');

const router = new Router();

router.get('/api/config', async (req, res) => {
  const { shop } = config;
  sendJson(res, 200, {
    name: shop.name,
    supportPhone: shop.supportPhone,
    telegram: shop.telegram,
    instagram: shop.instagram,
    pickupAddress: shop.pickupAddress,
    freeDeliveryFrom: shop.freeDeliveryFrom,
    minOrderTotal: shop.minOrderTotal,
    paymentMethods: availableMethods(),
    demoPayments: config.demoPayments,
  });
});

router.get('/api/categories', async (req, res) => {
  sendJson(res, 200, await catalog.listCategories());
});

router.get('/api/products', async (req, res, { query }) => {
  sendJson(res, 200, await catalog.listProducts(query));
});

router.get('/api/products/:slug', async (req, res, { params }) => {
  sendJson(res, 200, await catalog.getProduct(params.slug));
});

router.get('/api/regions', async (req, res) => {
  sendJson(res, 200, await catalog.listRegions());
});

// ---------------------------------------------------------------- вход
router.post('/api/auth/request-code', async (req, res, { ip }) => {
  const body = await readJson(req);
  sendJson(res, 200, await auth.requestCode(body.phone, body.language, ip));
});

router.post('/api/auth/verify', async (req, res) => {
  const body = await readJson(req);
  sendJson(res, 200, await auth.verifyCode(body.phone, body.code, body.language));
});

router.post('/api/auth/logout', async (req, res) => {
  await auth.logout(req);
  sendJson(res, 200, { ok: true });
});

router.get('/api/me', async (req, res) => {
  const customerId = await auth.requireCustomer(req);
  const customer = await db.get('SELECT * FROM customers WHERE id = $1', [customerId]);
  sendJson(res, 200, auth.formatCustomer(customer));
});

router.patch('/api/me', async (req, res) => {
  const customerId = await auth.requireCustomer(req);
  const body = await readJson(req);
  const name = body.name === undefined ? null : String(body.name).trim().slice(0, 100);
  const language = body.language === 'ru' || body.language === 'uz' ? body.language : null;
  const { row } = await db.run(
    `UPDATE customers SET name = COALESCE($2, name), language = COALESCE($3, language)
      WHERE id = $1 RETURNING *`,
    [customerId, name, language],
  );
  sendJson(res, 200, auth.formatCustomer(row));
});

/**
 * Удаление аккаунта (требование App Store и Google Play). Имя, телефон и адрес
 * покупателя стираются, сессии закрываются. Заказы остаются в учёте магазина.
 * Пока есть незавершённые заказы, удаление невозможно.
 */
router.delete('/api/me', async (req, res) => {
  const customerId = await auth.requireCustomer(req);
  await db.transaction(async () => {
    const active = await db.get(
      "SELECT 1 FROM orders WHERE customer_id = $1 AND status IN ('new', 'confirmed', 'shipped')",
      [customerId],
    );
    if (active) throw conflict('active_orders');
    const customer = await db.get('SELECT phone FROM customers WHERE id = $1', [customerId]);
    await db.run('DELETE FROM otp_codes WHERE phone = $1', [customer.phone]);
    await db.run(
      "UPDATE customers SET phone = 'deleted-' || id, name = '', last_address = NULL WHERE id = $1",
      [customerId],
    );
    await db.run('DELETE FROM sessions WHERE customer_id = $1', [customerId]);
  });
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------- заказы
router.post('/api/cart/quote', async (req, res) => {
  const body = await readJson(req);
  sendJson(res, 200, publicQuote(await buildQuote(body)));
});

router.get('/api/orders', async (req, res) => {
  const customerId = await auth.requireCustomer(req);
  sendJson(res, 200, await orders.listCustomerOrders(customerId));
});

router.post('/api/orders', async (req, res) => {
  const customerId = await auth.requireCustomer(req);
  const body = await readJson(req);
  sendJson(res, 201, await orders.createOrder(customerId, body));
});

router.get('/api/orders/:id', async (req, res, { params }) => {
  const customerId = await auth.requireCustomer(req);
  sendJson(res, 200, await orders.getCustomerOrder(customerId, params.id));
});

router.post('/api/orders/:id/cancel', async (req, res, { params }) => {
  const customerId = await auth.requireCustomer(req);
  sendJson(res, 200, await orders.cancelByCustomer(customerId, params.id));
});

module.exports = router;

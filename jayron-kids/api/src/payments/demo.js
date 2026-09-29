'use strict';
/**
 * Учебная страница оплаты (только вне продакшена, пока не подключены Payme и Click)
 * и страница возврата покупателя в приложение после оплаты.
 */
const config = require('../config');
const db = require('../db');
const orders = require('../orders');
const { formatSum } = require('../notify');
const { verifyDemoSignature } = require('./links');
const { sendHtml, notFound, HttpError } = require('../http');

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #FFF7E6; color: #4A2A14; }
  main { max-width: 420px; margin: 0 auto; padding: 32px 16px; text-align: center; }
  .card { background: #fff; border-radius: 24px; padding: 28px 20px; box-shadow: 0 8px 24px rgba(74, 42, 20, .08); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 8px 0; line-height: 1.5; }
  .sum { font-size: 30px; font-weight: 800; margin: 16px 0; }
  .note { font-size: 13px; color: #7A5A44; }
  button, .btn { display: block; width: 100%; box-sizing: border-box; border: 0; border-radius: 16px; padding: 16px;
    font-size: 17px; font-weight: 700; cursor: pointer; text-decoration: none; margin-top: 12px; }
  .primary { background: #007F75; color: #fff; }
  .ghost { background: #F2E8D5; color: #4A2A14; }
</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
}

async function loadDemoOrder(req, params) {
  if (!config.demoPayments) throw notFound();
  const id = Number(params.id) || 0;
  const url = new URL(req.url, 'http://localhost');
  if (!verifyDemoSignature(id, url.searchParams.get('sig'))) throw new HttpError(403, 'forbidden');
  const order = await db.get('SELECT * FROM orders WHERE id = $1', [id]);
  if (!order) throw notFound('order_not_found');
  return { order, sig: url.searchParams.get('sig') };
}

async function showDemo(req, res, { params }) {
  const { order, sig } = await loadDemoOrder(req, params);
  const provider = order.payment_method === 'click' ? 'Click' : 'Payme';
  const payable = order.payment_status === 'pending' && order.status !== 'cancelled';
  sendHtml(res, 200, page(`${provider} — demo`, `
    <h1>${provider} · demo</h1>
    <p>Buyurtma / Заказ №${order.id}</p>
    <div class="sum">${escapeHtml(formatSum(order.total).replace('сум', 'so‘m'))}</div>
    ${payable ? `
    <form method="post" action="/pay/demo/${order.id}?sig=${encodeURIComponent(sig)}">
      <button class="primary" type="submit">To‘lash / Оплатить</button>
    </form>
    <a class="btn ghost" href="/pay/return/${order.id}">Bekor qilish / Отмена</a>`
    : '<p>Buyurtma to‘lovga yaroqsiz / Заказ нельзя оплатить</p>'}
    <p class="note">Bu o‘quv to‘lov sahifasi: pul yechilmaydi. Payme va Click ulangandan so‘ng
    xaridor haqiqiy to‘lov sahifasiga o‘tadi.<br>Учебная страница оплаты: деньги не списываются.
    После подключения Payme и Click покупатель попадёт на настоящую страницу оплаты.</p>`));
}

async function payDemo(req, res, { params }) {
  const { order } = await loadDemoOrder(req, params);
  await db.transaction(async () => {
    const locked = await db.get('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
    if (locked.payment_status !== 'pending' || locked.status === 'cancelled') return;
    const now = Date.now();
    await db.run(
      `INSERT INTO payment_transactions (provider, external_id, order_id, amount, state, create_time, perform_time)
       VALUES ('demo', $1, $2, $3, 2, $4, $4)`,
      [`demo-${order.id}-${now}`, order.id, order.total * 100, now],
    );
    await orders.markPaid(order.id, order.payment_method);
  });
  res.writeHead(303, { Location: `/pay/return/${order.id}` });
  res.end();
}

/** Payme и Click возвращают покупателя сюда; кнопка открывает заказ в приложении. */
async function showReturn(req, res, { params }) {
  const id = Number(params.id) || 0;
  const order = await db.get('SELECT id, payment_status FROM orders WHERE id = $1', [id]);
  if (!order) throw notFound('order_not_found');
  const paid = order.payment_status === 'paid';
  sendHtml(res, 200, page('Jayron Kids', `
    <h1>${paid ? 'Rahmat! To‘lov qabul qilindi' : 'To‘lov yakunlanmadi'}</h1>
    <p>${paid ? 'Спасибо! Оплата получена.' : 'Оплата не завершена.'}</p>
    <p>Buyurtma / Заказ №${order.id}</p>
    <a class="btn primary" href="jayronkids://orders/${order.id}">Ilovaga qaytish / Вернуться в приложение</a>
    <p class="note">Agar ilova ochilmasa, ushbu oynani yoping. / Если приложение не открылось, просто закройте это окно.</p>`));
}

module.exports = { showDemo, payDemo, showReturn };

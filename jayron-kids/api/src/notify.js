'use strict';
/**
 * Уведомления магазину в Telegram: новый заказ, оплата, отмена.
 * Бот пишет в чат TELEGRAM_CHAT_ID (например, в группу менеджеров).
 */
const config = require('./config');

const escapeHtml = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatSum = (value) => `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} сум`;

const DELIVERY = { courier: 'курьер', post: 'почта / BTS', pickup: 'самовывоз' };
const PAYMENT = { cash: 'наличными при получении', payme: 'Payme', click: 'Click' };

async function sendTelegram(text) {
  if (!config.telegram.enabled) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegram.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Telegram API: ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Отправка в фоне: ошибка уведомления не должна ломать заказ. */
function fireAndForget(text) {
  sendTelegram(text).catch((error) => console.error('Telegram:', error.message));
}

function newOrder(order, items, regionName) {
  const lines = items.map(
    (i) => `• ${escapeHtml(i.name_ru)} — ${escapeHtml(i.color_name_ru)}, ${escapeHtml(i.size)} × ${i.quantity} = ${formatSum(i.price * i.quantity)}`,
  );
  const where = order.delivery_method === 'pickup'
    ? 'самовывоз из магазина'
    : `${escapeHtml(regionName || '')}, ${escapeHtml(order.city)}, ${escapeHtml(order.address)}`;
  fireAndForget([
    `🛍 <b>Новый заказ №${order.id}</b>`,
    `Сумма: <b>${formatSum(order.total)}</b> (${PAYMENT[order.payment_method]})`,
    `Получатель: ${escapeHtml(order.recipient_name)}, +${escapeHtml(order.recipient_phone)}`,
    `Доставка: ${DELIVERY[order.delivery_method]} — ${where}`,
    ...(order.comment ? [`Комментарий: ${escapeHtml(order.comment)}`] : []),
    '',
    ...lines,
  ].join('\n'));
}

function orderPaid(order, provider) {
  fireAndForget(`✅ Заказ №${order.id} оплачен через ${PAYMENT[provider] || provider}: ${formatSum(order.total)}`);
}

function orderCancelled(order, note) {
  fireAndForget(`❌ Заказ №${order.id} отменён${note ? `: ${escapeHtml(note)}` : ''}`);
}

module.exports = { newOrder, orderPaid, orderCancelled, formatSum, sendTelegram };

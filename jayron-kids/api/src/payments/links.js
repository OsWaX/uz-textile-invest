'use strict';
/**
 * Ссылки на страницы оплаты Payme и Click.
 * Без договора с платёжной системой (и вне продакшена) ссылка ведёт на учебную
 * страницу оплаты этого сервера — так можно проверить весь путь покупателя.
 */
const crypto = require('node:crypto');
const config = require('../config');

// Ключ подписи учебных ссылок живёт до перезапуска процесса
const demoKey = crypto.randomBytes(32);

const demoSignature = (orderId) =>
  crypto.createHmac('sha256', demoKey).update(`demo:${orderId}`).digest('base64url');

function verifyDemoSignature(orderId, signature) {
  const expected = Buffer.from(demoSignature(orderId));
  const actual = Buffer.from(String(signature ?? ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const returnUrl = (orderId) => `${config.publicUrl}/pay/return/${orderId}`;
const demoUrl = (orderId) => `${config.publicUrl}/pay/demo/${orderId}?sig=${demoSignature(orderId)}`;

function paymeUrl(order) {
  const params = [
    `m=${config.payme.merchantId}`,
    `ac.order_id=${order.id}`,
    `a=${order.total * 100}`, // в тийинах
    `c=${returnUrl(order.id)}`,
    `l=${order.language === 'ru' ? 'ru' : 'uz'}`,
  ].join(';');
  return `${config.payme.checkoutUrl}/${Buffer.from(params, 'utf8').toString('base64')}`;
}

function clickUrl(order) {
  const query = new URLSearchParams({
    service_id: config.click.serviceId,
    merchant_id: config.click.merchantId,
    amount: String(order.total),
    transaction_param: String(order.id),
    return_url: returnUrl(order.id),
  });
  return `https://my.click.uz/services/pay?${query}`;
}

const isLive = (provider) => config[provider]?.enabled === true;

/** Способы оплаты, доступные покупателю. */
function availableMethods() {
  const methods = ['cash'];
  for (const provider of ['payme', 'click']) {
    if (isLive(provider) || config.demoPayments) methods.push(provider);
  }
  return methods;
}

/** Ссылка на оплату неоплаченного онлайн-заказа или null. */
function paymentUrl(order) {
  if (order.payment_status !== 'pending' || order.status === 'cancelled') return null;
  const provider = order.payment_method;
  if (provider === 'cash') return null;
  if (isLive(provider)) return provider === 'payme' ? paymeUrl(order) : clickUrl(order);
  return config.demoPayments ? demoUrl(order.id) : null;
}

module.exports = { availableMethods, paymentUrl, verifyDemoSignature, demoUrl, paymeUrl, clickUrl };

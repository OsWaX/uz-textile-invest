'use strict';
/**
 * Отправка SMS. Рабочий провайдер — Eskiz (notify.eskiz.uz), самый распространённый
 * SMS-шлюз в Узбекистане. Текст сообщения должен совпадать с шаблоном,
 * согласованным в личном кабинете Eskiz.
 * В разработке (SMS_PROVIDER=console) код выводится в журнал сервера.
 */
const config = require('./config');

const ESKIZ_API = 'https://notify.eskiz.uz/api';
let eskizToken = null;
let eskizTokenAt = 0;

async function eskizRequest(path, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ESKIZ_API}${path}`, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function eskizLogin() {
  const body = new URLSearchParams({ email: config.sms.eskizEmail, password: config.sms.eskizPassword });
  const { response, payload } = await eskizRequest('/auth/login', { method: 'POST', body });
  const token = payload?.data?.token;
  if (!response.ok || !token) throw new Error(`Eskiz: не удалось войти (${response.status})`);
  eskizToken = token;
  eskizTokenAt = Date.now();
  return token;
}

async function sendEskiz(phone, message) {
  // Токен Eskiz действует 30 дней; обновляем заранее
  if (!eskizToken || Date.now() - eskizTokenAt > 25 * 24 * 3600 * 1000) await eskizLogin();
  const send = () => {
    const body = new URLSearchParams({ mobile_phone: phone, message, from: config.sms.eskizFrom });
    return eskizRequest('/message/sms/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${eskizToken}` },
      body,
    });
  };
  let { response, payload } = await send();
  if (response.status === 401) {
    await eskizLogin();
    ({ response, payload } = await send());
  }
  if (!response.ok) throw new Error(`Eskiz: ошибка отправки (${response.status}) ${payload?.message || ''}`);
}

/** Сообщения, отправленные в режиме console, — для тестов и разработки. */
const outbox = [];

async function sendSms(phone, message) {
  if (config.sms.provider === 'eskiz') {
    await sendEskiz(phone, message);
    return;
  }
  outbox.push({ phone, message, at: new Date() });
  if (outbox.length > 100) outbox.shift();
  if (process.env.NODE_ENV !== 'test') console.log(`[SMS → +${phone}] ${message}`);
}

module.exports = { sendSms, outbox };

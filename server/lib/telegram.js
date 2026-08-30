'use strict';
/** Отправка уведомлений через Telegram Bot API. */

const escapeHtml = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendTelegramMessage(token, chatId, text, options = {}) {
  if (!token) throw new Error('Telegram-бот не настроен');
  if (!chatId) throw new Error('У пользователя не указан Telegram chat_id');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(`Telegram API: ${payload.description || response.status}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendTelegramMessage, escapeHtml };

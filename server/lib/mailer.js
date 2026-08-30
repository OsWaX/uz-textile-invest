'use strict';
/**
 * Компактный SMTP-клиент (без внешних зависимостей): PLAIN-аутентификация,
 * STARTTLS и SMTPS. Используется каналом уведомлений «электронная почта».
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const NUL = String.fromCharCode(0);
const PRINTABLE_ASCII = new RegExp('^[\\u0020-\\u007e]*$');

class SmtpError extends Error {}

function createConnection({ host, port, secure }) {
  return secure === 'tls' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
}

/** Диалог с SMTP-сервером: последовательность команд и ожидаемых кодов ответа. */
function smtpSession(socket, steps, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let index = -1; // -1 — ожидаем приветствие сервера
    let settled = false;
    let currentSocket = socket;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { currentSocket.destroy(); } catch { /* сокет уже закрыт */ }
      if (err) reject(err); else resolve();
    };

    const timer = setTimeout(() => finish(new SmtpError('Тайм-аут соединения с SMTP-сервером')), timeoutMs);

    function attach(sock) {
      currentSocket = sock;
      sock.setEncoding('utf8');
      sock.on('data', onData);
      sock.on('error', finish);
      sock.on('close', () => {
        if (!settled && index < steps.length) finish(new SmtpError('SMTP-сервер закрыл соединение'));
      });
    }

    function onData(chunk) {
      buffer += chunk;
      // Ответ полон, когда последняя строка имеет вид "250 ..." (пробел, а не дефис).
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const response = buffer;
      buffer = '';
      const code = Number(last.slice(0, 3));

      if (index >= 0) {
        const step = steps[index];
        if (step.expect && !step.expect.includes(code)) {
          finish(new SmtpError(`SMTP ${code}: ${response.trim()}`));
          return;
        }
        if (step.upgrade) {
          currentSocket.removeAllListeners('data');
          const upgraded = tls.connect({ socket: currentSocket, servername: step.upgrade });
          upgraded.once('secureConnect', () => { attach(upgraded); index += 1; sendNext(); });
          upgraded.once('error', finish);
          return;
        }
      } else if (code !== 220) {
        finish(new SmtpError(`SMTP приветствие ${code}: ${response.trim()}`));
        return;
      }

      index += 1;
      sendNext();
    }

    function sendNext() {
      if (index >= steps.length) { finish(null); return; }
      currentSocket.write(steps[index].send);
    }

    attach(socket);
  });
}

/** Кодирование заголовка по RFC 2047 — необходимо для кириллицы в теме письма. */
const encodeHeader = (value) =>
  PRINTABLE_ASCII.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const base64Lines = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

function buildMessage({ from, to, subject, text, html }) {
  const boundary = `b_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@portal.textile.gov.uz>`,
    'MIME-Version: 1.0',
  ];

  if (!html) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${base64Lines(text)}`;
  }

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

/** Экранирование точки в начале строки согласно RFC 5321. */
const dotStuff = (body) => body.replace(/\r?\n\./g, '\r\n..');

const bareAddress = (value) => {
  const m = /<([^>]+)>/.exec(value);
  return m ? m[1] : value.trim();
};

/**
 * @param {object} smtpConfig — конфигурация из config.smtp
 * @param {{to:string,subject:string,text:string,html?:string}} message
 */
async function sendMail(smtpConfig, message) {
  if (!smtpConfig.host) throw new SmtpError('SMTP не настроен');
  const raw = buildMessage({ ...message, from: smtpConfig.from });
  const socket = createConnection(smtpConfig);
  const hostname = 'portal.textile.gov.uz';
  const steps = [{ send: `EHLO ${hostname}\r\n`, expect: [250] }];

  if (smtpConfig.secure === 'starttls') {
    steps.push({ send: 'STARTTLS\r\n', expect: [220], upgrade: smtpConfig.host });
    steps.push({ send: `EHLO ${hostname}\r\n`, expect: [250] });
  }
  if (smtpConfig.user) {
    const token = Buffer.from(NUL + smtpConfig.user + NUL + smtpConfig.password, 'utf8').toString('base64');
    steps.push({ send: `AUTH PLAIN ${token}\r\n`, expect: [235] });
  }
  steps.push({ send: `MAIL FROM:<${bareAddress(smtpConfig.from)}>\r\n`, expect: [250] });
  steps.push({ send: `RCPT TO:<${bareAddress(message.to)}>\r\n`, expect: [250, 251] });
  steps.push({ send: 'DATA\r\n', expect: [354] });
  steps.push({ send: `${dotStuff(raw)}\r\n.\r\n`, expect: [250] });
  steps.push({ send: 'QUIT\r\n', expect: [221] });

  await smtpSession(socket, steps, 20000);
}

module.exports = { sendMail, buildMessage, SmtpError };

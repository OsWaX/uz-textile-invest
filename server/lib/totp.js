'use strict';
/** TOTP (RFC 6238) для двухфакторной аутентификации — совместимо с Google/Microsoft Authenticator. */
const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Некорректный секрет Base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

const generateSecret = (bytes = 20) => base32Encode(crypto.randomBytes(bytes));

function generateCode(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Проверка кода с допуском +/- window шагов по 30 секунд. */
function verifyCode(secret, code, window = 1, now = Date.now()) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const counter = Math.floor(now / 30000);
  for (let i = -window; i <= window; i++) {
    const expected = generateCode(secret, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

/** otpauth:// URI для QR-кода в приложении-аутентификаторе. */
function otpauthUri(secret, account, issuer = 'Проектный офис — Текстиль') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, generateCode, verifyCode, otpauthUri, base32Encode, base32Decode };

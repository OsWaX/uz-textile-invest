'use strict';
/** Проверка и нормализация входных данных. Ошибки возвращаются на русском языке. */
const { badRequest } = require('./http');

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

function str(value, field, { required = false, max = 500, min = 0 } = {}) {
  if (isBlank(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно для заполнения`);
    return '';
  }
  const result = String(value).trim();
  if (result.length > max) throw badRequest(`Поле «${field}» длиннее ${max} символов`);
  if (result.length < min) throw badRequest(`Поле «${field}» короче ${min} символов`);
  return result;
}

function text(value, field, { required = false, max = 20000 } = {}) {
  return str(value, field, { required, max });
}

function int(value, field, { required = false, min = null, max = null, nullable = true } = {}) {
  if (isBlank(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно для заполнения`);
    return nullable ? null : 0;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`Поле «${field}» должно быть целым числом`);
  if (min !== null && n < min) throw badRequest(`Поле «${field}» не может быть меньше ${min}`);
  if (max !== null && n > max) throw badRequest(`Поле «${field}» не может быть больше ${max}`);
  return n;
}

function money(value, field) {
  if (isBlank(value)) return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw badRequest(`Поле «${field}» должно быть неотрицательным числом`);
  return Math.round(n * 100) / 100;
}

function date(value, field, { required = false } = {}) {
  if (isBlank(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно для заполнения`);
    return null;
  }
  const result = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw badRequest(`Поле «${field}» должно содержать дату в формате ГГГГ-ММ-ДД`);
  if (Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw badRequest(`Поле «${field}» содержит некорректную дату`);
  return result;
}

function time(value, field) {
  if (isBlank(value)) return '';
  const result = String(value).slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw badRequest(`Поле «${field}» должно содержать время в формате ЧЧ:ММ`);
  return result;
}

function oneOf(value, field, allowed, { required = true, fallback = null } = {}) {
  if (isBlank(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно для заполнения`);
    return fallback;
  }
  const result = String(value).trim();
  if (!allowed.includes(result)) {
    throw badRequest(`Поле «${field}» содержит недопустимое значение: ${result}`);
  }
  return result;
}

function email(value, field, { required = false } = {}) {
  if (isBlank(value)) {
    if (required) throw badRequest(`Поле «${field}» обязательно для заполнения`);
    return '';
  }
  const result = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(result)) throw badRequest(`Поле «${field}» содержит некорректный адрес электронной почты`);
  return result;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function array(value, field, { max = 200 } = {}) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw badRequest(`Поле «${field}» должно быть списком`);
  if (value.length > max) throw badRequest(`В поле «${field}» превышено количество элементов (${max})`);
  return value;
}

module.exports = { str, text, int, money, date, time, oneOf, email, bool, array, isBlank };

/** Форматирование сумм, телефонов и дат. */
import type { Lang } from './types';

const NBSP = ' ';

/** 129000 → «129 000 so‘m» / «129 000 сум». */
export function formatMoney(value: number, lang: Lang): string {
  const digits = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${digits}${NBSP}${lang === 'ru' ? 'сум' : 'so‘m'}`;
}

/** Девять цифр номера после +998 в виде «90 123 45 67» — для поля ввода. */
export function formatLocalPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(' ');
}

/** Номер из любого написания в 9 цифр после кода страны. */
export function localDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return (d.startsWith('998') && d.length > 9 ? d.slice(3) : d).slice(0, 9);
}

export const fullPhone = (digits: string) => `998${digits}`;
export const displayPhone = (digits: string) => `+998 ${formatLocalPhone(digits)}`;

export function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}${lang === 'ru' ? ' в' : ','} ${hh}:${mi}`;
}

export function discountPercent(price: number, oldPrice: number | null): number | null {
  if (!oldPrice || oldPrice <= price) return null;
  return Math.round((1 - price / oldPrice) * 100);
}

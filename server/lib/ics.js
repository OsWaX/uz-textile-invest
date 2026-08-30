'use strict';
/** Формирование iCalendar-ленты (RFC 5545) для подписки из Outlook / Google Calendar. */

const pad = (n) => String(n).padStart(2, '0');

function toIcsDate(value, allDay = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (allDay) return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** Строки iCalendar не должны превышать 75 октетов. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 74) return line;
  const parts = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) {
      parts.push(current);
      current = ' ' + char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n');
}

/**
 * @param {{uid:string,summary:string,description?:string,location?:string,start:Date|string,end?:Date|string,allDay?:boolean,url?:string,categories?:string}[]} events
 */
function buildCalendar(events, name = 'Проектный офис — календарь') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UzTextile Project Office//Portal//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Asia/Tashkent',
  ];

  const stamp = toIcsDate(new Date());
  for (const event of events) {
    const start = toIcsDate(event.start, event.allDay);
    if (!start) continue;
    const end = event.end ? toIcsDate(event.end, event.allDay) : null;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(event.uid)}@portal.textile.gov.uz`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`);
    if (end) lines.push(event.allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    if (event.categories) lines.push(`CATEGORIES:${escapeText(event.categories)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, toIcsDate };

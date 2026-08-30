'use strict';
/** Модульные проверки формирования файлов и вспомогательных библиотек. */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { buildWorkbook, buildCsv, columnName } = require('../server/lib/xlsx');
const { createZip, crc32 } = require('../server/lib/zip');
const { buildCalendar } = require('../server/lib/ics');
const totp = require('../server/lib/totp');
const { buildMessage } = require('../server/lib/mailer');
const v = require('../server/lib/validate');

test('ZIP-архив содержит корректные сигнатуры и распаковывается', () => {
  const content = 'Проектный офис — проверка архива';
  const zip = createZip([{ name: 'test.txt', data: content }]);
  assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304', 'сигнатура локального заголовка');
  assert.ok(zip.includes(Buffer.from('504b0102', 'hex')), 'центральный каталог присутствует');
  assert.ok(zip.includes(Buffer.from('504b0506', 'hex')), 'запись конца каталога присутствует');

  // Распаковываем полезную нагрузку и сверяем контрольную сумму
  const nameLength = zip.readUInt16LE(26);
  const payload = zip.subarray(30 + nameLength, 30 + nameLength + zip.readUInt32LE(18));
  const restored = zip.readUInt16LE(8) === 8 ? zlib.inflateRawSync(payload) : payload;
  assert.equal(restored.toString('utf8'), content);
  assert.equal(crc32(Buffer.from(content, 'utf8')), zip.readUInt32LE(14));
});

test('Имена столбцов Excel вычисляются верно', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(51), 'AZ');
  assert.equal(columnName(701), 'ZZ');
});

test('Книга Excel формируется с кириллицей, числами и датами', () => {
  const workbook = buildWorkbook([{
    name: 'Проекты',
    columns: [
      { header: 'Код', key: 'code' },
      { header: 'Сумма', key: 'amount', type: 'money' },
      { header: 'Срок', key: 'due', type: 'date' },
    ],
    rows: [
      { code: 'PRJ-2026-0001', amount: 4200000, due: '2026-09-15' },
      { code: 'PRJ-2026-0002', amount: null, due: null },
    ],
  }]);

  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(workbook.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(workbook.includes(Buffer.from('xl/styles.xml')));
  assert.ok(workbook.length > 1500);
});

test('CSV сохраняется с BOM и экранированием разделителей', () => {
  const csv = buildCsv(
    [{ header: 'Название', key: 'title' }, { header: 'Примечание', key: 'note' }],
    [{ title: 'Экспорт; партия №1', note: 'Текст с "кавычками"' }]
  );
  assert.equal(csv[0], 0xef, 'BOM в начале файла');
  const text = csv.toString('utf8');
  assert.ok(text.includes('"Экспорт; партия №1"'), 'значение с разделителем взято в кавычки');
  assert.ok(text.includes('""кавычками""'), 'кавычки удвоены');
});

test('Календарь iCalendar формируется по стандарту', () => {
  const ics = buildCalendar([{
    uid: 'step-1',
    summary: 'Подписание годовой спецификации на поставку домашнего текстиля в Германию',
    description: 'Проект PRJ-2026-0001',
    start: '2026-09-15T00:00:00Z',
    end: '2026-09-15T00:00:00Z',
    allDay: true,
  }]);

  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('VERSION:2.0'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260915'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `строка длиннее 75 октетов: ${line}`);
  }
});

test('Одноразовые коды TOTP совместимы с приложениями-аутентификаторами', () => {
  const secret = totp.generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/, 'секрет в кодировке Base32');

  const counter = Math.floor(Date.now() / 30000);
  const code = totp.generateCode(secret, counter);
  assert.match(code, /^\d{6}$/);

  assert.equal(totp.verifyCode(secret, code), true, 'текущий код принимается');
  assert.equal(totp.verifyCode(secret, totp.generateCode(secret, counter - 1)), true, 'код предыдущего шага принимается');
  assert.equal(totp.verifyCode(secret, totp.generateCode(secret, counter - 5)), false, 'устаревший код отклоняется');
  assert.equal(totp.verifyCode(secret, '123'), false, 'некорректный код отклоняется');

  // Известный вектор RFC 6238 (секрет "12345678901234567890" в Base32)
  assert.equal(totp.generateCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
});

test('Тема письма с кириллицей кодируется по RFC 2047', () => {
  const message = buildMessage({
    from: 'portal@textile.gov.uz', to: 'pm@textile.gov.uz',
    subject: 'Просрочен этап дорожной карты', text: 'Проверка',
  });
  assert.ok(message.includes('Subject: =?UTF-8?B?'), 'тема закодирована в base64');
  assert.ok(message.includes('Content-Transfer-Encoding: base64'));
  const encoded = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(message)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'Просрочен этап дорожной карты');
});

test('Проверка входных данных возвращает сообщения на русском языке', () => {
  assert.throws(() => v.str('', 'Название', { required: true }), /Поле «Название» обязательно/);
  assert.throws(() => v.date('15.09.2026', 'Срок'), /формате ГГГГ-ММ-ДД/);
  assert.throws(() => v.email('не-почта', 'Электронная почта'), /некорректный адрес/);
  assert.throws(() => v.oneOf('unknown', 'Статус', ['a', 'b']), /недопустимое значение/);
  assert.throws(() => v.money('-5', 'Сумма'), /неотрицательным числом/);

  assert.equal(v.money('1 250 000,50', 'Сумма'), 1250000.5, 'сумма с пробелами и запятой разбирается');
  assert.equal(v.date('2026-09-15', 'Срок'), '2026-09-15');
  assert.equal(v.time('14:30', 'Время'), '14:30');
  assert.equal(v.bool('yes'), true);
});

'use strict';
/**
 * Генератор файлов Excel (.xlsx) без внешних зависимостей.
 * Поддерживает текст, числа, денежные суммы, даты, ширину столбцов,
 * закреплённую шапку и автофильтр.
 */
const { createZip } = require('./zip');

// Символы, недопустимые в XML 1.0.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const BOM = String.fromCharCode(0xfeff);

const escapeXml = (value) =>
  String(value)
    .replace(CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel хранит даты как число дней с 1899-12-30; показываем время Ташкента. */
function toExcelSerial(date) {
  return (date.getTime() + 5 * 3600 * 1000) / 86400000 + 25569;
}

/**
 * @param {{name:string, columns:{header:string,key:string,width?:number,type?:string}[], rows:object[]}[]} sheets
 * @returns {Buffer}
 */
function buildWorkbook(sheets) {
  const sharedStrings = [];
  const sharedIndex = new Map();
  const internString = (value) => {
    const key = String(value);
    if (sharedIndex.has(key)) return sharedIndex.get(key);
    const index = sharedStrings.length;
    sharedStrings.push(key);
    sharedIndex.set(key, index);
    return index;
  };

  const sheetXmls = sheets.map((sheet) => {
    const cols = sheet.columns
      .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width || 20}" customWidth="1"/>`)
      .join('');

    const headerCells = sheet.columns
      .map((col, i) => `<c r="${columnName(i)}1" s="1" t="s"><v>${internString(col.header)}</v></c>`)
      .join('');

    const bodyRows = sheet.rows
      .map((row, rowIndex) => {
        const r = rowIndex + 2;
        const cells = sheet.columns
          .map((col, i) => {
            const ref = `${columnName(i)}${r}`;
            const value = row[col.key];
            if (value === null || value === undefined || value === '') return '';
            if (col.type === 'number' || col.type === 'money') {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) return `<c r="${ref}" s="2" t="s"><v>${internString(value)}</v></c>`;
              return `<c r="${ref}" s="${col.type === 'money' ? 3 : 2}"><v>${numeric}</v></c>`;
            }
            if (col.type === 'date') {
              const date = value instanceof Date ? value : new Date(value);
              if (Number.isNaN(date.getTime())) return `<c r="${ref}" s="2" t="s"><v>${internString(value)}</v></c>`;
              return `<c r="${ref}" s="4"><v>${toExcelSerial(date)}</v></c>`;
            }
            return `<c r="${ref}" s="2" t="s"><v>${internString(value)}</v></c>`;
          })
          .join('');
        return `<row r="${r}">${cells}</row>`;
      })
      .join('');

    const lastCol = columnName(Math.max(sheet.columns.length - 1, 0));
    const lastRow = sheet.rows.length + 1;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1" ht="24" customHeight="1">${headerCells}</row>${bodyRows}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
  });

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings
    .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
    .join('')}</sst>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="DD.MM.YYYY"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E9E"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD8DCE6"/></left><right style="thin"><color rgb="FFD8DCE6"/></right><top style="thin"><color rgb="FFD8DCE6"/></top><bottom style="thin"><color rgb="FFD8DCE6"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`;

  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ];

  return createZip(entries);
}

/** Экспорт в CSV с BOM — корректно открывается в Excel с кириллицей. */
function buildCsv(columns, rows, delimiter = ';') {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(delimiter)];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(delimiter));
  return Buffer.from(BOM + lines.join('\r\n'), 'utf8');
}

module.exports = { buildWorkbook, buildCsv, columnName, escapeXml };

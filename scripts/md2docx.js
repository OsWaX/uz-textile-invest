const fs = require('fs');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, ExternalHyperlink, PageBreak, Header, Footer, PageNumber,
  TableOfContents, LevelFormat, convertMillimetersToTwip
} = d;

const SRC = process.argv[2];
const OUT = process.argv[3];
const raw = fs.readFileSync(SRC, 'utf8').split('\n');

// ---------- page geometry (A4, ГОСТ-like margins) ----------
const PAGE_W = 11906, M_LEFT = 1701, M_RIGHT = 850;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT; // 9355

const FONT = 'Times New Roman', MONO = 'Consolas';

// ---------- inline parsing ----------
const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]*\]\([^)]*\)|\*[^*\s][^*]*\*)/g;
function inline(text, opts = {}) {
  const base = { font: FONT, size: opts.size || 22, bold: opts.bold || false, italics: opts.italics || false };
  const out = [];
  let last = 0, m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const t = m[0];
    if (t.startsWith('**')) {
      out.push(new TextRun({ ...base, bold: true, text: t.slice(2, -2) }));
    } else if (t.startsWith('`')) {
      out.push(new TextRun({ ...base, font: MONO, size: base.size - 2, text: t.slice(1, -1) }));
    } else if (t.startsWith('[')) {
      const mm = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(t);
      if (mm && /^https?:/.test(mm[2])) {
        out.push(new ExternalHyperlink({
          link: mm[2],
          children: [new TextRun({ ...base, style: 'Hyperlink', text: mm[1] })],
        }));
      } else {
        out.push(new TextRun({ ...base, italics: true, text: mm ? mm[1] : t }));
      }
    } else {
      out.push(new TextRun({ ...base, italics: true, text: t.slice(1, -1) }));
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ ...base, text: text.slice(last) }));
  return out.length ? out : [new TextRun({ ...base, text: '' })];
}

// ---------- table helpers ----------
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
function isDelim(line) { return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-'); }

function buildTable(rows, aligns) {
  const cols = rows[0].length;
  const weights = new Array(cols).fill(0);
  rows.forEach((r) => r.forEach((c, i) => {
    if (i < cols) weights[i] = Math.max(weights[i], Math.min(c.replace(/[*`\[\]]/g, '').length, 55));
  }));
  const sum = weights.reduce((a, b) => a + b, 0) || cols;
  let widths = weights.map((w) => Math.max(650, Math.round((CONTENT_W * w) / sum)));
  let diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
  const widest = widths.indexOf(Math.max(...widths));
  widths[widest] += diff;

  const alignOf = (i) => (aligns[i] === 'center' ? AlignmentType.CENTER : aligns[i] === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT);

  const trs = rows.map((cells, ri) => new TableRow({
    tableHeader: ri === 0,
    cantSplit: true,
    children: cells.slice(0, cols).map((c, ci) => new TableCell({
      width: { size: widths[ci], type: WidthType.DXA },
      shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'E8ECF2' } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({
        alignment: alignOf(ci),
        spacing: { before: 20, after: 20, line: 240 },
        children: inline(c === '' ? '—' : c, { size: 18, bold: ri === 0 }),
      })],
    })),
  }));

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].reduce((acc, k) => {
      acc[k] = { style: BorderStyle.SINGLE, size: 4, color: '9AA5B1' };
      return acc;
    }, {}),
    rows: trs,
  });
}

// ---------- document body ----------
const children = [];
let numInstance = 0;

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 276 },
    alignment: opts.alignment || AlignmentType.BOTH,
    indent: opts.indent,
    numbering: opts.numbering,
    keepNext: opts.keepNext,
    children: inline(text, opts),
  });
}

// title page
children.push(new Paragraph({ spacing: { before: 2400, after: 240 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ font: FONT, size: 40, bold: true, text: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ' })] }));
children.push(new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ font: FONT, size: 30, bold: true, text: 'Маркетплейс нового поколения' })] }));
children.push(new Paragraph({ spacing: { after: 1200 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ font: FONT, size: 26, italics: true, text: '«товар — у продавца, деньги — продавцу»' })] }));
[['Версия', '1.0'], ['Дата', 'сентябрь 2026 года'],
 ['Язык интерфейса', 'узбекский (латиница), русский, английский'],
 ['Аналитическое обоснование', 'Обзор онлайн-маркетплейсов (research.md)']].forEach(([k, v]) => {
  children.push(new Paragraph({ spacing: { after: 80 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ font: FONT, size: 22, bold: true, text: k + ': ' }), new TextRun({ font: FONT, size: 22, text: v })] }));
});
children.push(new Paragraph({ children: [new PageBreak()] }));

// table of contents
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 200 },
  children: [new TextRun({ font: FONT, size: 28, bold: true, text: 'Содержание' })] }));
children.push(new TableOfContents('Содержание', { hyperlinks: true, headingStyleRange: '1-3' }));
children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ font: FONT, size: 18, italics: true, color: '5A6572', text: 'Если оглавление отображается пустым, обновите поле: выделите его и нажмите F9 (Word) либо «Ссылки → Обновить таблицу».' })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// find start of body (first numbered section heading)
let start = raw.findIndex((l) => /^## 1\. /.test(l));
if (start < 0) start = 0;

const lines = raw.slice(start);
let i = 0;
let pendingList = null; // 'ol' | 'ul'

function flushList() { pendingList = null; }

while (i < lines.length) {
  const line = lines[i];

  // fenced code block
  if (/^```/.test(line)) {
    i++;
    const code = [];
    while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
    i++;
    code.forEach((cl, idx) => {
      children.push(new Paragraph({
        spacing: { before: idx === 0 ? 120 : 0, after: idx === code.length - 1 ? 160 : 0, line: 240 },
        shading: { type: ShadingType.CLEAR, fill: 'F4F5F7' },
        indent: { left: 200 },
        children: [new TextRun({ font: MONO, size: 15, text: cl.replace(/\t/g, '    ') || ' ' })],
      }));
    });
    flushList();
    continue;
  }

  // table
  if (/^\s*\|/.test(line) && i + 1 < lines.length && isDelim(lines[i + 1])) {
    const header = splitRow(line);
    const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
    i += 2;
    const rows = [header];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
    children.push(buildTable(rows, aligns));
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: '', size: 8 })] }));
    flushList();
    continue;
  }

  // headings
  let m;
  if ((m = /^(#{2,4})\s+(.*)$/.exec(line))) {
    const level = m[1].length;
    const text = m[2].replace(/\s*\{#.*\}$/, '');
    const size = level === 2 ? 28 : level === 3 ? 24 : 22;
    children.push(new Paragraph({
      heading: level === 2 ? HeadingLevel.HEADING_1 : level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      pageBreakBefore: level === 2,
      spacing: { before: level === 2 ? 0 : 240, after: 140 },
      keepNext: true,
      children: inline(text, { size, bold: true }),
    }));
    flushList();
    i++;
    continue;
  }

  // horizontal rule / blank
  if (/^---+\s*$/.test(line) || line.trim() === '') { flushList(); i++; continue; }

  // list items (with continuations)
  const li = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(line);
  if (li) {
    const indentSpaces = li[1].length;
    const ordered = /\d/.test(li[2]);
    let text = li[3];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(\s*)(-|\d+\.)\s+/.test(lines[i]) && !/^#{2,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^```/.test(lines[i]) && !/^---+\s*$/.test(lines[i])) {
      text += ' ' + lines[i].trim();
      i++;
    }
    const checkbox = /^\[[ xX]\]\s*/.test(text);
    if (checkbox) {
      children.push(new Paragraph({
        spacing: { after: 60, line: 264 }, indent: { left: 400, hanging: 220 },
        children: [new TextRun({ font: FONT, size: 22, text: (/^\[[xX]\]/.test(text) ? '☑  ' : '☐  ') }), ...inline(text.replace(/^\[[ xX]\]\s*/, ''))],
      }));
    } else if (ordered) {
      if (pendingList !== 'ol' + indentSpaces) { numInstance++; pendingList = 'ol' + indentSpaces; }
      children.push(new Paragraph({
        spacing: { after: 80, line: 276 }, alignment: AlignmentType.BOTH,
        numbering: { reference: 'ol', level: indentSpaces >= 3 ? 1 : 0, instance: numInstance },
        children: inline(text),
      }));
    } else {
      children.push(new Paragraph({
        spacing: { after: 80, line: 276 }, alignment: AlignmentType.BOTH,
        numbering: { reference: 'ul', level: indentSpaces >= 3 ? 1 : 0, instance: 0 },
        children: inline(text),
      }));
    }
    continue;
  }

  // paragraph (join continuation lines)
  let text = line.trim();
  i++;
  while (i < lines.length && lines[i].trim() !== '' && !/^#{2,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^```/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) && !/^(\s*)(-|\d+\.)\s+/.test(lines[i])) {
    text += ' ' + lines[i].trim();
    i++;
  }
  children.push(para(text, { after: 140 }));
  flushList();
}

// ---------- document ----------
const doc = new Document({
  creator: 'Проектный офис',
  title: 'Техническое задание. Маркетплейс нового поколения',
  description: 'ТЗ на торговую интернет-площадку без складов оператора с прямыми выплатами продавцам',
  styles: {
    default: {
      document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 276, after: 120 } } },
      heading1: { run: { font: FONT, size: 28, bold: true, color: '1A2733' }, paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
      heading2: { run: { font: FONT, size: 24, bold: true, color: '1A2733' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      heading3: { run: { font: FONT, size: 22, bold: true, italics: true, color: '1A2733' }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    },
  },
  numbering: {
    config: [
      { reference: 'ol', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 500, hanging: 320 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 900, hanging: 320 } } } },
      ] },
      { reference: 'ul', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 900, hanging: 260 } } } },
      ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: 16838 },
        margin: { top: convertMillimetersToTwip(20), bottom: convertMillimetersToTwip(20), left: M_LEFT, right: M_RIGHT },
      },
      titlePage: true,
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C0C7D0', space: 4 } },
        children: [new TextRun({ font: FONT, size: 18, color: '5A6572', text: 'Техническое задание. Маркетплейс нового поколения' })],
      })] }),
      first: new Header({ children: [] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ font: FONT, size: 18, color: '5A6572', children: [PageNumber.CURRENT] })],
      })] }),
      first: new Footer({ children: [] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log('written', OUT, buf.length, 'bytes'); });

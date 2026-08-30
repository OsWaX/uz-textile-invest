// ==========================================================================
//  Диаграммы дашборда. Строятся средствами SVG без внешних библиотек.
// ==========================================================================
import { h, formatNumber, formatMoney, MONTHS_NOM } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export const PALETTE = ['#1f4e9e', '#0f8a6a', '#a5791f', '#6f45c9', '#c2582e', '#2f8bbf', '#8a3d6b', '#4e7a2f', '#a53f3f'];

/** Кольцевая диаграмма — распределение по статусам. */
export function donutChart(items, { size = 190, thickness = 30, centerLabel = '', centerValue = '' } = {}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img' });

  if (!total) {
    root.append(svg('circle', { cx: center, cy: center, r: radius, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': thickness }));
  } else {
    let angle = -Math.PI / 2;
    items.forEach((item, index) => {
      if (!item.count) return;
      const sweep = (item.count / total) * Math.PI * 2;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const x1 = center + radius * Math.cos(angle);
      const y1 = center + radius * Math.sin(angle);
      const x2 = center + radius * Math.cos(end);
      const y2 = center + radius * Math.sin(end);
      const path = svg('path', {
        d: sweep >= Math.PI * 2 - 0.0001
          ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - 0.01} ${center - radius}`
          : `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`,
        fill: 'none',
        stroke: item.color || PALETTE[index % PALETTE.length],
        'stroke-width': thickness,
      }, svg('title', {}, `${item.label}: ${item.count}`));
      root.append(path);
      angle = end;
    });
  }

  if (centerValue !== '') {
    root.append(svg('text', {
      x: center, y: center - 2, 'text-anchor': 'middle', 'font-size': 26,
      'font-weight': 700, fill: 'var(--ink)',
    }, centerValue));
    root.append(svg('text', {
      x: center, y: center + 17, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-faint)',
    }, centerLabel));
  }
  return root;
}

export function legend(items) {
  return h('div', { class: 'chart-legend' },
    items.filter((item) => item.count).map((item, index) =>
      h('div', { class: 'item' },
        h('span', { class: 'swatch', style: { background: item.color || PALETTE[index % PALETTE.length] } }),
        h('span', {}, item.label),
        h('b', { class: 'mono' }, String(item.count))
      )
    )
  );
}

/** Горизонтальные полосы: по регионам, странам, менеджерам. */
export function barList(items, { valueKey = 'count', showAmount = true, limit = 12, onSelect = null } = {}) {
  const rows = items.slice(0, limit);
  const max = Math.max(1, ...rows.map((item) => item[valueKey] || 0));
  return h('div', { class: 'bar-list' },
    rows.length === 0 ? h('p', { class: 'muted mb-0' }, 'Нет данных за выбранный период.') : null,
    rows.map((item, index) =>
      h('div', { class: 'bar-row' },
        onSelect
          ? h('a', { href: '#', class: 'nowrap', style: { overflow: 'hidden', textOverflow: 'ellipsis' },
              onclick: (e) => { e.preventDefault(); onSelect(item); } }, item.label)
          : h('span', { class: 'nowrap', style: { overflow: 'hidden', textOverflow: 'ellipsis' }, title: item.label }, item.label),
        h('div', { class: 'bar-track' },
          h('div', {
            class: 'bar-fill',
            style: { width: `${Math.max(3, ((item[valueKey] || 0) / max) * 100)}%`, background: item.color || PALETTE[index % PALETTE.length] },
          })
        ),
        h('span', { class: 'bar-value' },
          showAmount && item.amount_usd
            ? `${item.count} · ${formatMoney(item.amount_usd, 'USD', { compact: true })}`
            : formatNumber(item[valueKey])
        )
      )
    )
  );
}

/** Динамика по месяцам: столбцы и линия. */
export function dynamicsChart(points, { height = 190 } = {}) {
  const width = 640;
  const padding = { top: 16, right: 12, bottom: 30, left: 40 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.map((p) => p.count));

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', preserveAspectRatio: 'xMidYMid meet', style: 'width:100%;height:auto', role: 'img' });

  // Горизонтальная сетка
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (innerHeight / 4) * i;
    root.append(svg('line', { x1: padding.left, y1: y, x2: width - padding.right, y2: y, stroke: 'var(--line-soft)', 'stroke-width': 1 }));
    root.append(svg('text', { x: padding.left - 7, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--ink-faint)' },
      String(Math.round(max - (max / 4) * i))));
  }

  if (!points.length) {
    root.append(svg('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-faint)' }, 'Нет данных'));
    return root;
  }

  const slot = innerWidth / points.length;
  const barWidth = Math.min(30, slot * 0.55);

  points.forEach((point, index) => {
    const barHeight = (point.count / max) * innerHeight;
    const x = padding.left + slot * index + (slot - barWidth) / 2;
    const y = padding.top + innerHeight - barHeight;
    root.append(svg('rect', { x, y, width: barWidth, height: Math.max(barHeight, 1), rx: 3, fill: 'var(--indigo)', opacity: .82 },
      svg('title', {}, `${monthLabel(point.month)}: ${point.count}`)));
    if (index % Math.ceil(points.length / 7) === 0 || index === points.length - 1) {
      root.append(svg('text', {
        x: padding.left + slot * index + slot / 2, y: height - 10,
        'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ink-faint)',
      }, monthLabel(point.month, true)));
    }
  });

  return root;
}

function monthLabel(value, short = false) {
  const [year, month] = String(value).split('-');
  const name = MONTHS_NOM[Number(month) - 1] || value;
  return short ? `${name.slice(0, 3)} ${year.slice(2)}` : `${name} ${year}`;
}

// --------------------------------------------------------------------------
//  Схематическая карта мира по девяти регионам ответственности офиса.
//  Контуры условные — карта служит навигацией, а не географическим документом.
// --------------------------------------------------------------------------
const REGION_SHAPES = {
  north_america: { d: 'M62,62 L246,54 L258,120 L214,168 L186,232 L146,246 L120,182 L58,128 Z', label: [150, 130] },
  latin_america: { d: 'M186,236 L238,226 L262,296 L242,382 L206,432 L180,352 L162,286 Z', label: [214, 320] },
  europe:        { d: 'M392,58 L498,52 L516,112 L474,158 L418,150 L386,106 Z', label: [450, 106] },
  cis:           { d: 'M504,46 L768,52 L780,116 L646,138 L522,118 Z', label: [640, 92] },
  middle_east:   { d: 'M470,166 L566,152 L596,214 L534,252 L474,218 Z', label: [530, 200] },
  africa:        { d: 'M390,178 L468,172 L502,254 L470,364 L420,404 L378,322 L358,242 Z', label: [432, 282] },
  south_asia:    { d: 'M602,182 L672,176 L694,244 L648,286 L606,238 Z', label: [648, 226] },
  east_asia:     { d: 'M702,108 L824,102 L846,184 L772,220 L700,184 Z', label: [772, 158] },
  asia_pacific:  { d: 'M762,232 L874,238 L904,332 L834,404 L762,352 L738,288 Z', label: [818, 310] },
};

/** Короткие подписи — полные названия не помещаются в контуры регионов. */
const REGION_SHORT = {
  north_america: 'Сев. Америка',
  latin_america: 'Лат. Америка',
  europe: 'Европа',
  cis: 'СНГ',
  middle_east: 'Бл. Восток',
  africa: 'Африка',
  south_asia: 'Юж. Азия',
  east_asia: 'Вост. Азия',
  asia_pacific: 'ЮВА и Океания',
};

export function worldMap(regionData, { onSelect = null } = {}) {
  const byCode = new Map(regionData.map((item) => [item.key, item]));
  const max = Math.max(1, ...regionData.map((item) => item.count));

  const root = svg('svg', {
    viewBox: '0 0 960 450', class: 'worldmap', preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': 'Схематическая карта регионов ответственности',
  });

  root.append(svg('rect', { x: 0, y: 0, width: 960, height: 450, fill: 'var(--surface-2)', rx: 8 }));

  for (const [code, shape] of Object.entries(REGION_SHAPES)) {
    const data = byCode.get(code);
    const count = data?.count || 0;
    const intensity = count ? 0.22 + (count / max) * 0.78 : 0.1;
    const group = svg('g', {
      class: 'region',
      role: onSelect ? 'button' : undefined,
      tabindex: onSelect ? 0 : undefined,
      onclick: onSelect ? () => onSelect(code, data) : undefined,
      onkeydown: onSelect ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(code, data); } } : undefined,
    });
    const fillColor = count
      ? `color-mix(in srgb, var(--indigo) ${Math.round(intensity * 100)}%, var(--surface))`
      : 'var(--surface-3)';
    group.append(svg('path', { d: shape.d, fill: fillColor, stroke: 'var(--surface)' },
      svg('title', {}, `${data?.label || code}: ${count} ${count === 1 ? 'проект' : 'проектов'}`)));

    const [x, y] = shape.label;
    const onDark = intensity > 0.5;
    // Обводка подписи повторяет заливку региона — текст читается на любом фоне.
    if (count) {
      group.append(svg('text', {
        x, y, 'text-anchor': 'middle', class: 'region-count',
        fill: onDark ? '#fff' : 'var(--ink)', stroke: fillColor,
      }, String(count)));
    }
    group.append(svg('text', {
      x, y: y + (count ? 21 : 6), 'text-anchor': 'middle', class: 'region-label',
      fill: onDark ? '#fff' : 'var(--ink)', stroke: fillColor,
    }, REGION_SHORT[code] || data?.label || ''));
    root.append(group);
  }

  return root;
}

// --------------------------------------------------------------------------
//  Схематическая карта Республики Узбекистан по 14 регионам.
//  Контуры условные: карта служит навигацией, а не картографическим документом.
// --------------------------------------------------------------------------
const UZ_SHAPES = {
  karakalpakstan:  { d: 'M40,40 L250,28 L268,120 L232,206 L150,236 L74,196 L34,120 Z', at: [148, 120], short: 'Каракалпакстан' },
  khorezm:         { d: 'M212,208 L268,196 L292,238 L256,268 L214,250 Z', at: [252, 232], short: 'Хорезм' },
  navoiy:          { d: 'M270,124 L430,110 L452,206 L360,244 L292,214 L272,166 Z', at: [362, 172], short: 'Навоий' },
  bukhara:         { d: 'M258,270 L360,248 L392,316 L330,364 L266,330 Z', at: [324, 306], short: 'Бухара' },
  samarkand:       { d: 'M396,250 L470,232 L494,290 L440,318 L396,300 Z', at: [444, 276], short: 'Самарканд' },
  jizzakh:         { d: 'M456,178 L522,168 L540,226 L488,244 L452,214 Z', at: [496, 204], short: 'Джизак' },
  syrdarya:        { d: 'M528,150 L578,142 L590,190 L544,204 L524,178 Z', at: [556, 172], short: 'Сырдарья' },
  tashkent_region: { d: 'M556,84 L646,72 L668,132 L606,158 L556,132 Z', at: [608, 110], short: 'Ташкент. обл.' },
  tashkent_city:   { d: 'M602,60 L640,54 L648,80 L612,88 Z', at: [626, 48], short: 'г. Ташкент' },
  namangan:        { d: 'M660,102 L744,92 L760,140 L700,158 L662,136 Z', at: [710, 122], short: 'Наманган' },
  fergana:         { d: 'M708,166 L780,156 L796,206 L740,222 L706,196 Z', at: [750, 188], short: 'Фергана' },
  andijan:         { d: 'M766,116 L830,108 L844,152 L792,166 L766,142 Z', at: [800, 134], short: 'Андижан' },
  kashkadarya:     { d: 'M398,326 L486,300 L512,368 L446,406 L392,376 Z', at: [452, 352], short: 'Кашкадарья' },
  surkhandarya:    { d: 'M452,412 L522,378 L552,436 L500,470 L450,446 Z', at: [502, 424], short: 'Сурхандарья' },
};

export function uzbekistanMap(regionData, { onSelect = null } = {}) {
  const byCode = new Map(regionData.map((item) => [item.key, item]));
  const max = Math.max(1, ...regionData.map((item) => item.count));

  const root = svg('svg', {
    viewBox: '0 0 880 500', class: 'worldmap', preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': 'Схематическая карта регионов Республики Узбекистан',
  });
  root.append(svg('rect', { x: 0, y: 0, width: 880, height: 500, fill: 'var(--surface-2)', rx: 8 }));

  for (const [code, shape] of Object.entries(UZ_SHAPES)) {
    const data = byCode.get(code);
    const count = data?.count || 0;
    const intensity = count ? 0.24 + (count / max) * 0.76 : 0.1;
    const fill = count
      ? `color-mix(in srgb, var(--indigo) ${Math.round(intensity * 100)}%, var(--surface))`
      : 'var(--surface-3)';
    const onDark = intensity > 0.5;

    const group = svg('g', {
      class: 'region',
      role: onSelect ? 'button' : undefined,
      tabindex: onSelect ? 0 : undefined,
      onclick: onSelect ? () => onSelect(code, data) : undefined,
      onkeydown: onSelect
        ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(code, data); } }
        : undefined,
    });
    group.append(svg('path', { d: shape.d, fill, stroke: 'var(--surface)' },
      svg('title', {}, `${data?.label || shape.short}: ${count} ${count === 1 ? 'проект' : 'проектов'}`)));

    const [x, y] = shape.at;
    if (count) {
      group.append(svg('text', {
        x, y, 'text-anchor': 'middle', class: 'region-count',
        fill: onDark ? '#fff' : 'var(--ink)', stroke: fill,
      }, String(count)));
    }
    group.append(svg('text', {
      x, y: y + (count ? 20 : 5), 'text-anchor': 'middle', class: 'region-label',
      fill: onDark ? '#fff' : 'var(--ink)', stroke: fill,
    }, shape.short));
    root.append(group);
  }
  return root;
}

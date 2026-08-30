// ==========================================================================
//  Базовые средства интерфейса: создание элементов, форматирование,
//  всплывающие сообщения и модальные окна.
// ==========================================================================

/** Создаёт DOM-элемент. Значения вставляются как текст — защита от XSS. */
export function h(tag, attrs = null, ...children) {
  const element = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (key === 'html') element.innerHTML = value; // используется только для доверенной разметки
    else if (key in element && key !== 'list' && typeof value !== 'object') element[key] = value;
    else element.setAttribute(key, value);
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
};

/**
 * Колонка внутри сетки. В отличие от frag(), создаёт реальный элемент —
 * поэтому дочерние карточки остаются в одной ячейке grid, а не разлетаются по ней.
 */
export const column = (...children) => h('div', { class: 'col-stack' }, ...children);

export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

/**
 * Заменяет содержимое узла. В отличие от Node.replaceChildren, разворачивает
 * вложенные массивы и пропускает null/undefined — как это делает h().
 */
export function setChildren(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

// ---------- Форматирование -------------------------------------------------

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad = (n) => String(n).padStart(2, '0');

/** Даты в базе хранятся в UTC, отображаются во времени Ташкента (UTC+5). */
function toTashkent(value) {
  if (!value) return null;
  const raw = String(value);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 5 * 3600 * 1000);
}

export function formatDate(value, { long = false } = {}) {
  const date = toTashkent(value);
  if (!date) return '—';
  return long
    ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} г.`
    : `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

export function formatDateShort(value) {
  const date = toTashkent(value);
  return date ? `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}` : '—';
}

export function formatDateTime(value) {
  const date = toTashkent(value);
  if (!date) return '—';
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Склонение существительного: 1 день, 2 дня, 5 дней. */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function relativeTime(value) {
  const date = toTashkent(value);
  if (!date) return '—';
  const nowTashkent = new Date(Date.now() + 5 * 3600 * 1000);
  const diffMinutes = Math.round((nowTashkent - date) / 60000);
  if (diffMinutes < 1) return 'только что';
  if (diffMinutes < 60) return `${diffMinutes} ${plural(diffMinutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatDate(value);
}

export function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(`${String(dateString).slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso()}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86400000);
}

export const todayIso = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU');

export const formatNumber = (value) => (value === null || value === undefined || value === '' ? '—' : NUMBER_FORMAT.format(Math.round(Number(value))));

export function formatMoney(amount, currency = 'USD', { compact = false } = {}) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  if (compact && Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace('.', ',')} млн ${currency}`;
  if (compact && Math.abs(value) >= 1_000) return `${Math.round(value / 1000)} тыс. ${currency}`;
  return `${NUMBER_FORMAT.format(value)} ${currency}`;
}

export const formatSize = (bytes) => {
  if (!bytes) return '0 КБ';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
};

export const initials = (fullName) =>
  String(fullName || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const ROLE_LABELS = { admin: 'Администратор', team: 'Проектный менеджер', viewer: 'Наблюдатель' };
export const AREA_LABELS = { export: 'Экспорт', investment: 'Инвестиции' };
export const DIRECTION_LABELS = { outbound: 'Выездной визит', inbound: 'Приём делегации' };
export const STEP_STATE_LABELS = { planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен' };

// ---------- Значки ---------------------------------------------------------

/** Цветная метка статуса; цвет берётся из справочника. */
export function statusTag(label, color, extraClass = '') {
  if (!label) return h('span', { class: 'muted' }, '—');
  const tag = h('span', { class: `tag ${extraClass}` }, h('span', { class: 'dot' }), label);
  if (color) {
    tag.style.color = color;
    tag.style.background = `color-mix(in srgb, ${color} 13%, transparent)`;
  }
  return tag;
}

// ---------- Всплывающие сообщения -----------------------------------------

export function toast(message, { type = 'info', title = '', timeout = 4600 } = {}) {
  const root = document.getElementById('toast-root');
  const node = h('div', { class: `toast ${type}`, role: 'status' },
    title && h('div', { class: 't-title' }, title),
    h('div', { class: 't-body' }, message)
  );
  root.append(node);
  setTimeout(() => node.remove(), timeout);
  return node;
}

export const toastOk = (message, title = 'Готово') => toast(message, { type: 'ok', title });
export const toastError = (message, title = 'Ошибка') => toast(message, { type: 'error', title, timeout: 7000 });

// ---------- Модальные окна -------------------------------------------------

let openModals = 0;

/**
 * Открывает модальное окно.
 * @returns {{close: Function, body: HTMLElement, footer: HTMLElement}}
 */
export function openModal({ title, body, footer, size = '', onClose, closeOnScrim = true }) {
  const root = document.getElementById('modal-root');
  const bodyEl = h('div', { class: 'modal-body' });
  const footEl = h('div', { class: 'modal-foot' });
  if (body) append(bodyEl, [body]);
  if (footer) append(footEl, [footer]);

  const close = () => {
    scrim.remove();
    openModals -= 1;
    if (openModals === 0) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  const modal = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', title: 'Закрыть', onclick: close }, '✕')
    ),
    bodyEl,
    footer ? footEl : null
  );

  const scrim = h('div', {
    class: 'modal-scrim',
    onclick: (event) => { if (closeOnScrim && event.target === scrim) close(); },
  }, modal);

  root.append(scrim);
  openModals += 1;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  setTimeout(() => modal.querySelector('input, select, textarea, button')?.focus(), 40);

  return { close, body: bodyEl, footer: footEl, modal };
}

export function confirmDialog({ title = 'Подтверждение', message, confirmLabel = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const decide = (value) => { decided = true; dialog.close(); resolve(value); };
    const dialog = openModal({
      title,
      size: 'narrow',
      body: h('p', { class: 'mb-0' }, message),
      footer: frag(
        h('button', { class: 'btn', type: 'button', onclick: () => decide(false) }, 'Отмена'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => decide(true) }, confirmLabel)
      ),
      onClose: () => { if (!decided) resolve(false); },
    });
  });
}

/** Индикатор загрузки внутри контейнера. */
export const spinner = () => h('div', { class: 'spinner', role: 'status', 'aria-label': 'Загрузка' });

export const empty = (title, note, icon = '📄') =>
  h('div', { class: 'empty' },
    h('div', { class: 'icon' }, icon),
    h('h3', {}, title),
    note && h('p', { class: 'mb-0' }, note)
  );

/** Поле формы с подписью. */
export function field(label, control, { required = false, help = '', id = '' } = {}) {
  if (id) control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: control.id || undefined },
      label,
      required && h('span', { class: 'req' }, '*')
    ),
    control,
    help && h('div', { class: 'help' }, help)
  );
}

export function select(options, { value = '', placeholder = '', name = '', onchange = null } = {}) {
  const el = h('select', { name, onchange: onchange || undefined });
  if (placeholder) el.append(h('option', { value: '' }, placeholder));
  for (const option of options) {
    const optValue = String(option.value ?? option.code ?? option.id ?? '');
    el.append(h('option', { value: optValue, selected: optValue === String(value ?? '') }, option.label ?? option.name_ru ?? option.name ?? optValue));
  }
  el.value = String(value ?? '');
  return el;
}

/** Собирает значения формы в объект. */
export function formValues(form) {
  const data = {};
  for (const element of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (element.type === 'checkbox') data[element.name] = element.checked;
    else if (element.type === 'radio') { if (element.checked) data[element.name] = element.value; }
    else data[element.name] = element.value;
  }
  return data;
}

/** Подсветка @упоминаний в тексте комментария. */
export function renderComment(text) {
  const container = h('div', { class: 'feed-text' });
  const parts = String(text).split(/(@[\p{L}][\p{L}\-.]{1,60})/u);
  for (const part of parts) {
    if (part.startsWith('@')) container.append(h('span', { class: 'mention' }, part));
    else container.append(document.createTextNode(part));
  }
  return container;
}

export const debounce = (fn, delay = 260) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

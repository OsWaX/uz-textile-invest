// ==========================================================================
//  Портал Проектного офиса — точка входа клиентского приложения.
// ==========================================================================
import { api, setUnauthorizedHandler, ApiError } from './api.js';
import { store } from './store.js';
import {
  h, clear, frag, toast, toastError, spinner, initials, ROLE_LABELS, debounce, openModal,
} from './ui.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProjects } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderCompanies, renderCompany } from './views/companies.js';
import { renderVisits } from './views/visits.js';
import { renderVisit } from './views/visit.js';
import { renderCalendar } from './views/calendar.js';
import { renderKanban } from './views/kanban.js';
import { renderReports } from './views/reports.js';
import { renderCorrections } from './views/corrections.js';
import { renderProfile } from './views/profile.js';
import { renderAdmin } from './views/admin.js';

const root = document.getElementById('root');

// --------------------------------------------------------------------------
//  Разделы навигации
// --------------------------------------------------------------------------
const NAV = [
  { group: 'Работа офиса', items: [
    { path: 'dashboard', icon: '▤', label: 'Дашборд' },
    { path: 'projects', icon: '▦', label: 'Проекты и соглашения' },
    { path: 'kanban', icon: '▥', label: 'Доска проектов' },
    { path: 'companies', icon: '⌂', label: 'Компании и партнёры' },
    { path: 'visits', icon: '✈', label: 'Визиты и встречи' },
    { path: 'calendar', icon: '▣', label: 'Календарь' },
  ] },
  { group: 'Аналитика', items: [
    { path: 'reports', icon: '⇩', label: 'Отчёты и выгрузки' },
    { path: 'corrections', icon: '✎', label: 'Заявки на исправление' },
  ] },
  { group: 'Администрирование', admin: true, items: [
    { path: 'admin/users', icon: '☰', label: 'Пользователи' },
    { path: 'admin/fields', icon: '⊞', label: 'Конструктор форм' },
    { path: 'admin/dictionaries', icon: '⊟', label: 'Справочники' },
    { path: 'admin/settings', icon: '⚙', label: 'Настройки' },
    { path: 'admin/audit', icon: '⧉', label: 'Журнал аудита' },
    { path: 'admin/bin', icon: '🗑', label: 'Корзина' },
  ] },
];

const ROUTES = [
  { pattern: /^\/?$/, view: renderDashboard },
  { pattern: /^\/dashboard$/, view: renderDashboard },
  { pattern: /^\/projects$/, view: renderProjects },
  { pattern: /^\/projects\/(\d+)$/, view: renderProject },
  { pattern: /^\/kanban$/, view: renderKanban },
  { pattern: /^\/companies$/, view: renderCompanies },
  { pattern: /^\/companys?\/(\d+)$/, view: renderCompany },
  { pattern: /^\/companies\/(\d+)$/, view: renderCompany },
  { pattern: /^\/visits$/, view: renderVisits },
  { pattern: /^\/visits\/(\d+)$/, view: renderVisit },
  { pattern: /^\/calendar$/, view: renderCalendar },
  { pattern: /^\/reports$/, view: renderReports },
  { pattern: /^\/corrections$/, view: renderCorrections },
  { pattern: /^\/profile$/, view: renderProfile },
  { pattern: /^\/admin\/(\w+)$/, view: renderAdmin },
];

// --------------------------------------------------------------------------
//  Каркас приложения
// --------------------------------------------------------------------------
let contentEl = null;
let sidebarEl = null;
let notifButton = null;

function buildShell() {
  const nav = h('nav', { class: 'nav' });
  for (const group of NAV) {
    if (group.admin && !store.isAdmin) continue;
    nav.append(h('div', { class: 'nav-group-title' }, group.group));
    for (const item of group.items) {
      nav.append(h('a', { href: `#/${item.path}`, dataset: { path: item.path } },
        h('span', { class: 'icon' }, item.icon),
        h('span', {}, item.label),
        item.path === 'corrections' ? h('span', { class: 'badge hidden', dataset: { badge: 'corrections' } }) : null
      ));
    }
  }

  sidebarEl = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'sidebar-brand' },
      h('div', { class: 'title' }, 'Проектный офис'),
      h('div', { class: 'sub' }, 'Текстильная промышленность')
    ),
    nav,
    h('div', { class: 'sidebar-foot' },
      'Министерство инвестиций, промышленности и торговли Республики Узбекистан'
    )
  );

  const searchInput = h('input', {
    type: 'search', placeholder: 'Поиск по проектам, компаниям, контактам…',
    'aria-label': 'Глобальный поиск', autocomplete: 'off',
  });
  const searchResults = h('div', { class: 'search-results hidden' });
  const searchBox = h('div', { class: 'search-box' },
    h('span', { class: 'mag' }, '⌕'), searchInput,
    h('kbd', {}, '/'), searchResults
  );
  wireSearch(searchInput, searchResults);

  notifButton = h('button', { class: 'icon-btn', title: 'Уведомления', 'aria-label': 'Уведомления', onclick: toggleNotifications }, '🔔');

  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'burger', 'aria-label': 'Меню', onclick: () => sidebarEl.classList.toggle('open') }, '☰'),
    searchBox,
    h('div', { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', title: 'Светлая или тёмная тема', onclick: toggleTheme }, '◐'),
      notifButton,
      h('button', { class: 'user-chip', onclick: () => { location.hash = '#/profile'; } },
        h('span', { class: 'avatar' }, initials(store.user.full_name)),
        h('span', {},
          h('div', { class: 'u-name' }, store.user.full_name),
          h('div', { class: 'u-role' }, ROLE_LABELS[store.user.role])
        )
      ),
      h('button', { class: 'icon-btn', title: 'Выйти из системы', onclick: logout }, '⏻')
    )
  );

  contentEl = h('main', { class: 'content', id: 'content' });

  clear(root).append(h('div', { class: 'app' }, sidebarEl, h('div', { class: 'main' }, topbar, contentEl)));
  refreshNotificationBadge();
  refreshCorrectionsBadge();
}

// --------------------------------------------------------------------------
//  Маршрутизация
// --------------------------------------------------------------------------
async function route() {
  if (!store.user) return;
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  const [path] = hash.split('?');

  for (const link of sidebarEl.querySelectorAll('.nav a')) {
    link.classList.toggle('active', `/${link.dataset.path}` === path);
  }
  sidebarEl.classList.remove('open');

  const match = ROUTES.find((route) => route.pattern.test(path));
  clear(contentEl).append(spinner());
  window.scrollTo(0, 0);

  if (!match) {
    clear(contentEl).append(h('div', { class: 'empty' },
      h('div', { class: 'icon' }, '🧭'),
      h('h3', {}, 'Страница не найдена'),
      h('p', {}, 'Проверьте адрес или вернитесь на дашборд.'),
      h('a', { class: 'btn btn-primary', href: '#/dashboard' }, 'На дашборд')
    ));
    return;
  }

  const params = path.match(match.pattern).slice(1);
  const queryString = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const query = Object.fromEntries(new URLSearchParams(queryString).entries());

  try {
    const view = await match.view({ params, query, navigate });
    clear(contentEl).append(view);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    console.error(error);
    clear(contentEl).append(h('div', { class: 'callout danger' },
      h('b', {}, 'Не удалось загрузить раздел. '),
      error.message
    ));
  }
}

export function navigate(path, query = {}) {
  const search = api.query(query);
  location.hash = `#${path}${search}`;
}

/** Обновляет строку запроса без перезагрузки представления. */
export function updateQuery(query) {
  const [path] = location.hash.replace(/^#/, '').split('?');
  history.replaceState(null, '', `#${path}${api.query(query)}`);
}

// --------------------------------------------------------------------------
//  Глобальный поиск
// --------------------------------------------------------------------------
function wireSearch(input, resultsBox) {
  const run = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) { resultsBox.classList.add('hidden'); return; }
    try {
      const results = await api.search(term);
      renderSearchResults(resultsBox, results, term);
    } catch { /* поиск не критичен для работы */ }
  }, 240);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (resultsBox.children.length) resultsBox.classList.remove('hidden'); });
  document.addEventListener('click', (event) => {
    if (!resultsBox.contains(event.target) && event.target !== input) resultsBox.classList.add('hidden');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      input.focus();
    }
    if (event.key === 'Escape') resultsBox.classList.add('hidden');
  });
}

function renderSearchResults(box, results, term) {
  clear(box);
  const groups = [
    ['Проекты и соглашения', results.projects, (r) => ({ href: `#/projects/${r.id}`, title: r.title, meta: `${r.code} · ${r.company_name} · ${r.country_name}` })],
    ['Компании', results.companies, (r) => ({ href: `#/companies/${r.id}`, title: r.name, meta: `${r.country_name || ''}${r.city ? `, ${r.city}` : ''} · проектов: ${r.projects_count}` })],
    ['Визиты', results.visits, (r) => ({ href: `#/visits/${r.id}`, title: `${r.country_name}, ${r.cities}`, meta: `${r.code} · ${r.goal.slice(0, 70)}` })],
    ['Контактные лица', results.contacts, (r) => ({
      href: r.entity_type === 'company' ? `#/companies/${r.entity_id}` : `#/projects/${r.entity_id}`,
      title: r.full_name, meta: `${r.position || ''}${r.parent_name ? ` · ${r.parent_name}` : ''}`,
    })],
  ];

  let total = 0;
  for (const [label, rows, map] of groups) {
    if (!rows?.length) continue;
    total += rows.length;
    box.append(h('div', { class: 'group-title' }, label));
    for (const row of rows) {
      const item = map(row);
      box.append(h('a', { href: item.href, onclick: () => box.classList.add('hidden') },
        h('div', { class: 'r-title' }, item.title),
        h('div', { class: 'r-meta' }, item.meta)
      ));
    }
  }
  if (!total) box.append(h('div', { class: 'empty', style: { padding: '24px' } }, `По запросу «${term}» ничего не найдено`));
  box.classList.remove('hidden');
}

// --------------------------------------------------------------------------
//  Центр уведомлений
// --------------------------------------------------------------------------
let notifPanel = null;

async function toggleNotifications() {
  if (notifPanel) { notifPanel.remove(); notifPanel = null; return; }
  const data = await api.notifications({ limit: 40 });
  const list = h('div', { class: 'notif-list' });

  if (!data.rows.length) {
    list.append(h('div', { class: 'empty', style: { padding: '30px' } }, 'Новых уведомлений нет'));
  }
  for (const item of data.rows) {
    list.append(h('a', {
      class: `notif-item ${item.is_read ? '' : 'unread'}`,
      href: item.link || '#/dashboard',
      onclick: async () => {
        if (!item.is_read) await api.post(`/api/notifications/${item.id}/read`).catch(() => {});
        notifPanel?.remove(); notifPanel = null;
        refreshNotificationBadge();
      },
    },
      h('div', { class: 'n-title' }, item.title),
      item.body && h('div', { class: 'n-body' }, item.body),
      h('div', { class: 'n-time' }, `${item.type_label} · ${new Date(`${item.created_at.replace(' ', 'T')}Z`).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
    ));
  }

  notifPanel = h('div', { class: 'notif-panel' },
    h('div', { class: 'head' },
      h('h3', { style: { flex: '1' } }, 'Уведомления'),
      data.unread > 0 && h('button', {
        class: 'btn btn-sm', onclick: async () => {
          await api.post('/api/notifications/read-all');
          notifPanel.remove(); notifPanel = null;
          refreshNotificationBadge();
        },
      }, 'Прочитать все'),
      h('button', { class: 'icon-btn', onclick: () => { notifPanel.remove(); notifPanel = null; } }, '✕')
    ),
    list,
    h('div', { class: 'card-foot small muted' },
      `Каналы: в системе${data.channels.email ? ', электронная почта' : ''}${data.channels.telegram ? ', Telegram' : ''}. `,
      h('a', { href: '#/profile', onclick: () => { notifPanel?.remove(); notifPanel = null; } }, 'Настроить')
    )
  );
  document.body.append(notifPanel);
}

export async function refreshNotificationBadge() {
  try {
    const data = await api.notifications({ unread: 1, limit: 1 });
    store.unread = data.unread;
    const existing = notifButton.querySelector('.dot');
    existing?.remove();
    if (data.unread > 0) notifButton.append(h('span', { class: 'dot' }, data.unread > 99 ? '99+' : String(data.unread)));
  } catch { /* индикатор не критичен */ }
}

async function refreshCorrectionsBadge() {
  if (!store.isAdmin) return;
  try {
    const rows = await api.get('/api/corrections', { status: 'pending' });
    const badge = sidebarEl.querySelector('[data-badge="corrections"]');
    if (!badge) return;
    badge.textContent = String(rows.length);
    badge.classList.toggle('hidden', rows.length === 0);
  } catch { /* индикатор не критичен */ }
}

// --------------------------------------------------------------------------
//  Тема оформления
// --------------------------------------------------------------------------
function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('po-theme', next); } catch { /* хранилище недоступно */ }
  toast(next === 'dark' ? 'Тёмная тема' : next === 'light' ? 'Светлая тема' : 'Тема системы');
}

function restoreTheme() {
  try {
    const saved = localStorage.getItem('po-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch { /* хранилище недоступно */ }
}

// --------------------------------------------------------------------------
//  Вход и выход
// --------------------------------------------------------------------------
async function logout() {
  await api.logout().catch(() => {});
  store.user = null;
  store.permissions = {};
  location.hash = '';
  showLogin();
}

function showLogin(message = '') {
  clear(root).append(renderLogin({ onSuccess: startSession, message }));
}

async function startSession(session) {
  store.user = session.user;
  store.permissions = session.permissions;
  await store.loadReference(true);
  buildShell();
  await route();
  if (store.user.must_change_pwd) {
    toast('Рекомендуется сменить пароль, выданный администратором.', { type: 'error', title: 'Смена пароля', timeout: 9000 });
    setTimeout(() => { location.hash = '#/profile'; }, 700);
  }
  startSessionWatch();
}

/** Периодическое обновление счётчика уведомлений. */
let watchTimer = null;
function startSessionWatch() {
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && store.user) {
      refreshNotificationBadge();
      refreshCorrectionsBadge();
    }
  }, 90_000);
}

setUnauthorizedHandler(() => {
  if (!store.user) return;
  store.user = null;
  clearInterval(watchTimer);
  showLogin('Сессия завершена из-за бездействия. Войдите в систему заново.');
});

window.addEventListener('hashchange', route);

// --------------------------------------------------------------------------
//  Запуск
// --------------------------------------------------------------------------
(async function bootstrap() {
  restoreTheme();
  try {
    const session = await api.me();
    await startSession(session);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showLogin();
    else {
      clear(root).append(h('div', { class: 'callout danger', style: { margin: '40px' } },
        h('b', {}, 'Сервер недоступен. '), error.message
      ));
    }
  }
})();

export { openModal, toastError, frag };

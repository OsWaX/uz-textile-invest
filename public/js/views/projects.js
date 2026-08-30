// ==========================================================================
//  Реестр проектов и соглашений (п. 3.3 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, select, field, formatDate, formatMoney, formatNumber, statusTag, empty,
  toastOk, toastError, debounce, daysUntil, plural, openModal, AREA_LABELS, setChildren,
} from '../ui.js';
import { openProjectForm } from './forms.js';

const COLUMNS = [
  { key: 'code', label: 'Код', sortable: true },
  { key: 'title', label: 'Название / компания', sortable: true },
  { key: 'sector', label: 'Отрасль' },
  { key: 'country', label: 'Страна', sortable: true },
  { key: 'status', label: 'Статус', sortable: true },
  { key: 'amount', label: 'Сумма', sortable: true, num: true },
  { key: 'responsible', label: 'Ответственный', sortable: true },
  { key: 'roadmap', label: 'Дорожная карта' },
  { key: 'next_due_date', label: 'Ближайший срок', sortable: true },
];

export async function renderProjects({ query, navigate }) {
  const state = {
    limit: 50,
    offset: Number(query.offset) || 0,
    sort: query.sort || 'updated_at',
    dir: query.dir || 'desc',
    ...query,
  };

  const ref = store.reference;
  const tableHost = h('div', { class: 'card' });
  const savedFiltersHost = h('div', { class: 'filter-chips' });

  const setQuery = (patch) => {
    const next = { ...query, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === undefined || value === null) delete next[key];
    }
    navigate('/projects', next);
  };

  // ---- Фильтры ----
  const searchInput = h('input', {
    type: 'search', value: query.search || '',
    placeholder: 'Поиск по названию, компании, контактам, комментариям…',
  });
  searchInput.addEventListener('input', debounce(() => setQuery({ search: searchInput.value, offset: 0 }), 420));

  const filters = h('div', { class: 'filters' },
    field('Полнотекстовый поиск', searchInput),
    field('Статус', select(ref.project_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
      { value: query.status || '', placeholder: 'Все статусы', onchange: (e) => setQuery({ status: e.target.value, offset: 0 }) })),
    field('Отрасль', select(ref.sectors.map((s) => ({ value: s.code, label: s.name_ru })),
      { value: query.sector || '', placeholder: 'Все отрасли', onchange: (e) => setQuery({ sector: e.target.value, offset: 0 }) })),
    field('Направление', select([{ value: 'export', label: 'Экспорт' }, { value: 'investment', label: 'Инвестиции' }],
      { value: query.area || '', placeholder: 'Все направления', onchange: (e) => setQuery({ area: e.target.value, offset: 0 }) })),
    field('Регион', select(ref.regions.map((r) => ({ value: r.code, label: r.name_ru })),
      { value: query.region || '', placeholder: 'Все регионы', onchange: (e) => setQuery({ region: e.target.value, offset: 0 }) })),
    field('Страна', select(ref.countries.map((c) => ({ value: c.id, label: c.name_ru })),
      { value: query.country_id || '', placeholder: 'Все страны', onchange: (e) => setQuery({ country_id: e.target.value, offset: 0 }) })),
    field('Ответственный', select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
      { value: query.responsible_id || '', placeholder: 'Все сотрудники', onchange: (e) => setQuery({ responsible_id: e.target.value, offset: 0 }) })),
    field('Тип записи', select(ref.record_types.map((t) => ({ value: t.code, label: t.name_ru })),
      { value: query.record_type || '', placeholder: 'Все типы', onchange: (e) => setQuery({ record_type: e.target.value, offset: 0 }) })),
    field('Сумма от', h('input', {
      type: 'number', value: query.amount_min || '', placeholder: '0',
      onchange: (e) => setQuery({ amount_min: e.target.value, offset: 0 }),
    })),
    field('Сумма до', h('input', {
      type: 'number', value: query.amount_max || '', placeholder: 'без ограничения',
      onchange: (e) => setQuery({ amount_max: e.target.value, offset: 0 }),
    }))
  );

  const quickChips = h('div', { class: 'filter-chips' },
    quickChip('Мои проекты', query.responsible_id === String(store.user.id), () =>
      setQuery({ responsible_id: query.responsible_id === String(store.user.id) ? '' : store.user.id, offset: 0 })),
    store.user.region_id
      ? quickChip('Мой регион', query.region_id === String(store.user.region_id), () =>
          setQuery({ region_id: query.region_id === String(store.user.region_id) ? '' : store.user.region_id, offset: 0 }))
      : null,
    quickChip('Просроченные этапы', query.overdue === '1', () => setQuery({ overdue: query.overdue === '1' ? '' : '1', offset: 0 })),
    quickChip('Сроки в течение 7 дней', query.due_soon === '1', () => setQuery({ due_soon: query.due_soon === '1' ? '' : '1', offset: 0 })),
    quickChip(`Без активности более ${ref.settings.stale_days} дн.`, query.stale === '1', () => setQuery({ stale: query.stale === '1' ? '' : '1', offset: 0 })),
    Object.keys(query).length
      ? h('button', { class: 'chip', onclick: () => navigate('/projects') }, '✕ Сбросить фильтры')
      : null
  );

  // ---- Сохранённые фильтры (п. 3.3 ТЗ) ----
  async function loadSavedFilters() {
    const rows = await api.get('/api/saved-filters', { entity: 'projects' }).catch(() => []);
    setChildren(savedFiltersHost, 
      rows.length ? h('span', { class: 'small muted', style: { alignSelf: 'center' } }, 'Сохранённые выборки:') : null,
      rows.map((row) =>
        h('button', {
          class: 'chip',
          title: row.is_shared ? 'Общая выборка офиса' : 'Личная выборка',
          onclick: () => navigate('/projects', row.query),
        }, `${row.is_shared ? '★ ' : ''}${row.name}`)
      ),
      Object.keys(query).length
        ? h('button', { class: 'chip', onclick: () => saveCurrentFilter(query, loadSavedFilters) }, '+ Сохранить текущую выборку')
        : null
    );
  }
  loadSavedFilters();

  // ---- Таблица ----
  async function loadTable() {
    setChildren(tableHost, h('div', { class: 'spinner' }));
    const data = await api.projects(state);
    setChildren(tableHost, renderTable(data, state, setQuery, navigate));
  }
  await loadTable();

  return frag(
    h('div', { class: 'print-header' },
      h('div', { class: 'ministry' }, ref.settings.ministry),
      h('div', { class: 'doc-title' }, 'Реестр проектов и соглашений'),
      h('div', { class: 'doc-meta' }, `Сформировано: ${formatDate(new Date().toISOString(), { long: true })}`)
    ),
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Проекты и соглашения'),
        h('div', { class: 'subtitle' }, 'Экспортные и инвестиционные проекты, соглашения, меморандумы и контракты')
      ),
      h('div', { class: 'page-actions' },
        h('a', { class: 'btn', href: '#/kanban' }, '▥ Доска'),
        store.can('report.export') && h('button', {
          class: 'btn',
          onclick: () => api.download('/api/export/projects', { ...query, format: 'xlsx' }, 'projects.xlsx'),
        }, '⇩ Excel'),
        store.can('project.create') && h('button', {
          class: 'btn btn-primary',
          onclick: () => openProjectForm({ onSaved: (saved) => navigate(`/projects/${saved.id}`) }),
        }, '+ Новая запись')
      )
    ),
    quickChips,
    filters,
    savedFiltersHost,
    tableHost
  );
}

function quickChip(label, active, onclick) {
  return h('button', { class: `chip ${active ? 'active' : ''}`, onclick }, label);
}

function renderTable(data, state, setQuery, navigate) {
  if (!data.rows.length) {
    return h('div', { class: 'card-body' },
      empty('Записей не найдено', 'Измените условия фильтрации или создайте новую запись.', '🔍'));
  }

  const headerCell = (column) => {
    if (!column.sortable) return h('th', { class: column.num ? 'num' : '' }, column.label);
    const isActive = state.sort === column.key;
    return h('th', {
      class: `sortable ${column.num ? 'num' : ''}`,
      onclick: () => setQuery({ sort: column.key, dir: isActive && state.dir === 'desc' ? 'asc' : 'desc' }),
    }, column.label, isActive ? h('span', { class: 'arrow' }, state.dir === 'desc' ? '▼' : '▲') : null);
  };

  const rows = data.rows.map((project) => {
    const overdueDays = project.next_due_date ? daysUntil(project.next_due_date) : null;
    return h('tr', { class: `${project.is_overdue ? 'row-overdue' : project.is_stale ? 'row-stale' : ''}` },
      h('td', { class: 'code' }, project.code),
      h('td', {},
        h('a', { href: `#/projects/${project.id}`, class: 't-main' }, project.title),
        h('div', { class: 't-sub' },
          h('a', { href: `#/companies/${project.company_id}` }, project.company_name),
          ` · ${project.record_type_name} · ${AREA_LABELS[project.area]}`
        )
      ),
      h('td', {}, statusTag(project.sector_name, project.sector_color)),
      h('td', {}, project.country_name, h('div', { class: 't-sub' }, project.region_name)),
      h('td', {}, statusTag(project.status_name, project.status_color)),
      h('td', { class: 'num' }, formatMoney(project.amount, project.currency, { compact: true })),
      h('td', {}, project.responsible_name),
      h('td', {},
        h('div', { class: 'flex', style: { gap: '7px' } },
          h('div', { class: 'progress', style: { flex: '1' } },
            h('span', { style: { width: `${project.progress}%` } })),
          h('span', { class: 'small muted nowrap' }, `${project.steps_done}/${project.steps_total}`)
        ),
        project.steps_overdue > 0
          ? h('div', { class: 't-sub', style: { color: 'var(--danger)' } }, `просрочено: ${project.steps_overdue}`)
          : project.is_stale ? h('div', { class: 't-sub', style: { color: 'var(--warn)' } }, 'нет активности') : null
      ),
      h('td', { class: 'nowrap' },
        project.next_due_date
          ? frag(
              formatDate(project.next_due_date),
              h('div', { class: 't-sub', style: overdueDays < 0 ? { color: 'var(--danger)' } : {} },
                overdueDays < 0
                  ? `просрочено на ${Math.abs(overdueDays)} ${plural(Math.abs(overdueDays), 'день', 'дня', 'дней')}`
                  : overdueDays === 0 ? 'сегодня' : `через ${overdueDays} ${plural(overdueDays, 'день', 'дня', 'дней')}`)
            )
          : h('span', { class: 'muted' }, '—')
      )
    );
  });

  const pageStart = data.offset + 1;
  const pageEnd = Math.min(data.offset + data.rows.length, data.total);

  return frag(
    h('div', { class: 'card-head' },
      h('h2', {}, `Найдено записей: ${formatNumber(data.total)}`),
      h('span', { class: 'muted small' }, `показаны ${pageStart}–${pageEnd}`)
    ),
    h('div', { class: 'card-body tight' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data registry' },
          h('thead', {}, h('tr', {}, COLUMNS.map(headerCell))),
          h('tbody', {}, rows)
        )
      )
    ),
    data.total > data.limit
      ? h('div', { class: 'pagination' },
          h('button', {
            class: 'btn btn-sm', disabled: data.offset === 0,
            onclick: () => setQuery({ offset: Math.max(0, data.offset - data.limit) }),
          }, '← Назад'),
          h('span', { class: 'muted' }, `${Math.floor(data.offset / data.limit) + 1} из ${Math.ceil(data.total / data.limit)}`),
          h('button', {
            class: 'btn btn-sm', disabled: pageEnd >= data.total,
            onclick: () => setQuery({ offset: data.offset + data.limit }),
          }, 'Вперёд →')
        )
      : null
  );
}

function saveCurrentFilter(query, onSaved) {
  const nameInput = h('input', { type: 'text', placeholder: 'например: Инвестиции — в реализации', maxlength: 120 });
  const sharedInput = h('input', { type: 'checkbox' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить');

  const dialog = openModal({
    title: 'Сохранить выборку',
    size: 'narrow',
    body: h('div', {},
      field('Название выборки', nameInput, { required: true }),
      store.isAdmin
        ? h('label', { class: 'checkbox' }, sharedInput, h('span', {}, 'Сделать доступной всем сотрудникам офиса'))
        : null
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    try {
      await api.post('/api/saved-filters', {
        name: nameInput.value.trim(), entity: 'projects', query, is_shared: sharedInput.checked,
      });
      dialog.close();
      toastOk('Выборка сохранена.');
      onSaved();
    } catch (error) {
      toastError(error.message);
    }
  };
}

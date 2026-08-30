// ==========================================================================
//  Отчёты и выгрузки (раздел 8 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatNumber, formatDate, toastOk, toastError,
} from '../ui.js';

const DATASETS = [
  { key: 'projects', title: 'Реестр проектов и соглашений', note: 'Все поля карточки, включая произвольные поля из конструктора форм.' },
  { key: 'steps', title: 'Этапы дорожных карт', note: 'Сроки, состояние, ответственные, признак просрочки.' },
  { key: 'visits', title: 'Визиты', note: 'Даты, статус, состав, количество встреч.' },
  { key: 'companies', title: 'Компании и партнёры', note: 'Число проектов, суммы, встречи.' },
  { key: 'uz_locations', title: 'Проекты по регионам Узбекистана',
    note: 'По одной строке на каждую площадку: регион, город или район, объём в регионе, местные партнёры. Формат пригоден для сводных таблиц.' },
];

export async function renderReports({ query, navigate }) {
  const managers = await api.managers();
  const filterState = { ...query };

  const filters = h('div', { class: 'filters' },
    field('Отрасль', select(store.reference.sectors.map((s) => ({ value: s.code, label: s.name_ru })),
      { value: query.sector || '', placeholder: 'Все отрасли', onchange: (e) => navigate('/reports', { ...query, sector: e.target.value }) })),
    field('Направление', select([{ value: 'export', label: 'Экспорт' }, { value: 'investment', label: 'Инвестиции' }],
      { value: query.area || '', placeholder: 'Все направления', onchange: (e) => navigate('/reports', { ...query, area: e.target.value }) })),
    field('Регион', select(store.reference.regions.map((r) => ({ value: r.code, label: r.name_ru })),
      { value: query.region || '', placeholder: 'Все регионы', onchange: (e) => navigate('/reports', { ...query, region: e.target.value }) })),
    field('Статус', select(store.reference.project_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
      { value: query.status || '', placeholder: 'Все статусы', onchange: (e) => navigate('/reports', { ...query, status: e.target.value }) })),
    field('Создано с', h('input', { type: 'date', value: query.date_from || '', onchange: (e) => navigate('/reports', { ...query, date_from: e.target.value }) })),
    field('Создано по', h('input', { type: 'date', value: query.date_to || '', onchange: (e) => navigate('/reports', { ...query, date_to: e.target.value }) }))
  );

  const download = async (path, params, name) => {
    try {
      await api.download(path, params, name);
      toastOk('Файл сформирован и загружен.');
    } catch (error) {
      toastError(error.message);
    }
  };

  const datasetCards = h('div', { class: 'grid grid-2' },
    DATASETS.map((dataset) =>
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, dataset.title)),
        h('div', { class: 'card-body' },
          h('p', { class: 'small muted' }, dataset.note),
          h('div', { class: 'flex' },
            h('button', {
              class: 'btn btn-primary btn-sm',
              onclick: () => download(`/api/export/${dataset.key}`, { ...filterState, format: 'xlsx' }, `${dataset.key}.xlsx`),
            }, '⇩ Excel (.xlsx)'),
            h('button', {
              class: 'btn btn-sm',
              onclick: () => download(`/api/export/${dataset.key}`, { ...filterState, format: 'csv' }, `${dataset.key}.csv`),
            }, '⇩ CSV')
          )
        )
      )
    )
  );

  const readyReports = h('div', { class: 'grid grid-2' },
    reportCard(
      'Сводный отчёт по портфелю',
      'Книга Excel из пяти листов: по регионам, отраслям, статусам, менеджерам и полный реестр проектов с текущими фильтрами.',
      () => download('/api/export/report/portfolio', filterState, 'portfolio-report.xlsx')
    ),
    reportCard(
      'Отчёт по работе менеджеров',
      'Проекты, подписанные соглашения, выполненные и просроченные этапы, визиты по каждому сотруднику офиса.',
      () => download('/api/export/report/managers', {}, 'managers-report.xlsx')
    ),
    reportCard(
      'Календарь событий (.ics)',
      'Лента для подписки в Outlook или Google Календаре: сроки дорожных карт, визиты и встречи.',
      () => download('/api/calendar.ics', {}, 'project-office.ics')
    ),
    reportCard(
      'Печатные документы',
      'Карточка проекта и программа визита печатаются из соответствующих разделов кнопкой «Печать / PDF» — с бланком министерства.',
      null,
      h('a', { class: 'btn btn-sm', href: '#/projects' }, 'Перейти к проектам')
    )
  );

  const managersTable = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Показатели работы проектных менеджеров'),
      h('button', { class: 'btn btn-sm', onclick: () => window.print() }, '🖨 Печать')
    ),
    h('div', { class: 'card-body tight' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Сотрудник'), h('th', {}, 'Регион'),
            h('th', { class: 'num' }, 'Проектов'), h('th', { class: 'num' }, 'Подписано'),
            h('th', { class: 'num' }, 'Этапов выполнено'), h('th', { class: 'num' }, 'В срок'),
            h('th', { class: 'num' }, 'Просрочено'), h('th', { class: 'num' }, 'Визитов')
          )),
          h('tbody', {}, managers.map((manager) => {
            const punctuality = manager.steps_done ? Math.round((manager.steps_on_time / manager.steps_done) * 100) : null;
            return h('tr', {},
              h('td', {},
                h('span', { class: 't-main' }, manager.full_name),
                h('div', { class: 't-sub' }, manager.email)
              ),
              h('td', {}, manager.region_name || '—'),
              h('td', { class: 'num' }, formatNumber(manager.projects_total)),
              h('td', { class: 'num' }, formatNumber(manager.projects_signed)),
              h('td', { class: 'num' },
                formatNumber(manager.steps_done),
                punctuality !== null ? h('div', { class: 't-sub' }, `${punctuality}% в срок`) : null
              ),
              h('td', { class: 'num' }, formatNumber(manager.steps_on_time)),
              h('td', { class: 'num', style: manager.steps_overdue ? { color: 'var(--danger)', fontWeight: '600' } : {} },
                formatNumber(manager.steps_overdue)),
              h('td', { class: 'num' }, formatNumber(manager.visits_total))
            );
          }))
        )
      )
    )
  );

  return frag(
    h('div', { class: 'print-header' },
      h('div', { class: 'ministry' }, store.reference.settings.ministry),
      h('div', { class: 'doc-title' }, 'Отчёт по работе Проектного офиса'),
      h('div', { class: 'doc-meta' }, `Сформировано: ${formatDate(new Date().toISOString(), { long: true })}`)
    ),
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Отчёты и выгрузки'),
        h('div', { class: 'subtitle' }, 'Выгрузка любых списков в Excel и CSV, готовые отчёты для руководства')
      )
    ),
    h('div', { class: 'callout info' },
      'Фильтры ниже применяются к выгрузкам реестров и к сводному отчёту по портфелю. ',
      'Произвольные поля, добавленные администратором в конструкторе форм, включаются в выгрузки автоматически.'),
    filters,
    h('h2', { class: 'mb-1 mt-2' }, 'Готовые отчёты'),
    readyReports,
    h('h2', { class: 'mb-1 mt-3' }, 'Выгрузка реестров'),
    datasetCards,
    h('div', { class: 'mt-3' }, managersTable)
  );
}

function reportCard(title, note, onClick, extra = null) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, title)),
    h('div', { class: 'card-body' },
      h('p', { class: 'small muted' }, note),
      onClick ? h('button', { class: 'btn btn-primary btn-sm', onclick: onClick }, '⇩ Сформировать') : extra
    )
  );
}

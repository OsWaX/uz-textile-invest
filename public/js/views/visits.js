// ==========================================================================
//  Реестр визитов (раздел 5 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatDate, formatNumber, statusTag, empty, debounce, daysUntil,
  plural, DIRECTION_LABELS,
} from '../ui.js';
import { openVisitForm } from './forms.js';

export async function renderVisits({ query, navigate }) {
  const data = await api.visits({ ...query, limit: 50 });

  const searchInput = h('input', { type: 'search', value: query.search || '', placeholder: 'Страна, город, цель визита…' });
  searchInput.addEventListener('input', debounce(() => navigate('/visits', { ...query, search: searchInput.value }), 400));

  const filters = h('div', { class: 'filters' },
    field('Поиск', searchInput),
    field('Направление', select([
      { value: 'outbound', label: 'Выездные визиты' },
      { value: 'inbound', label: 'Приём делегаций' },
    ], { value: query.direction || '', placeholder: 'Все', onchange: (e) => navigate('/visits', { ...query, direction: e.target.value }) })),
    field('Статус', select(store.reference.visit_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
      { value: query.status || '', placeholder: 'Все статусы', onchange: (e) => navigate('/visits', { ...query, status: e.target.value }) })),
    field('Страна', select(store.reference.countries.map((c) => ({ value: c.id, label: c.name_ru })),
      { value: query.country_id || '', placeholder: 'Все страны', onchange: (e) => navigate('/visits', { ...query, country_id: e.target.value }) })),
    field('Ответственный', select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
      { value: query.responsible_id || '', placeholder: 'Все сотрудники', onchange: (e) => navigate('/visits', { ...query, responsible_id: e.target.value }) })),
    field('С даты', h('input', { type: 'date', value: query.date_from || '', onchange: (e) => navigate('/visits', { ...query, date_from: e.target.value }) })),
    field('По дату', h('input', { type: 'date', value: query.date_to || '', onchange: (e) => navigate('/visits', { ...query, date_to: e.target.value }) }))
  );

  const chips = h('div', { class: 'filter-chips' },
    h('button', {
      class: `chip ${query.upcoming === '1' ? 'active' : ''}`,
      onclick: () => navigate('/visits', { ...query, upcoming: query.upcoming === '1' ? '' : '1' }),
    }, 'Только предстоящие'),
    h('button', {
      class: `chip ${query.responsible_id === String(store.user.id) ? 'active' : ''}`,
      onclick: () => navigate('/visits', { ...query, responsible_id: query.responsible_id === String(store.user.id) ? '' : store.user.id }),
    }, 'Мои визиты'),
    Object.keys(query).length ? h('button', { class: 'chip', onclick: () => navigate('/visits') }, '✕ Сбросить') : null
  );

  const table = data.rows.length
    ? h('div', { class: 'table-wrap' },
        h('table', { class: 'data registry' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Код'), h('th', {}, 'Направление и страна'), h('th', {}, 'Даты'),
            h('th', {}, 'Статус'), h('th', { class: 'num' }, 'Встреч'), h('th', {}, 'Ответственный'), h('th', {}, 'Цель')
          )),
          h('tbody', {}, data.rows.map((visit) => {
            const untilStart = daysUntil(visit.date_from);
            return h('tr', { class: visit.meetings_tbc > 0 && untilStart >= 0 && untilStart <= 7 ? 'row-stale' : '' },
              h('td', { class: 'code' }, visit.code),
              h('td', {},
                h('a', { href: `#/visits/${visit.id}`, class: 't-main' }, `${visit.country_name}, ${visit.cities}`),
                h('div', { class: 't-sub' }, `${DIRECTION_LABELS[visit.direction]} · ${visit.region_name}`)
              ),
              h('td', { class: 'nowrap' },
                `${formatDate(visit.date_from)} – ${formatDate(visit.date_to)}`,
                untilStart > 0 ? h('div', { class: 't-sub' }, `через ${untilStart} ${plural(untilStart, 'день', 'дня', 'дней')}`) : null
              ),
              h('td', {}, statusTag(visit.status_name, visit.status_color)),
              h('td', { class: 'num' },
                formatNumber(visit.meetings_total),
                visit.meetings_tbc > 0 ? h('div', { class: 't-sub', style: { color: 'var(--warn)' } }, `${visit.meetings_tbc} не согл.`) : null
              ),
              h('td', {}, visit.responsible_name),
              h('td', { style: { maxWidth: '320px' } }, h('div', { class: 'small' }, visit.goal.slice(0, 140)))
            );
          }))
        )
      )
    : empty('Визитов не найдено', 'Измените условия фильтрации или запланируйте новый визит.', '✈');

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Визиты и встречи'),
        h('div', { class: 'subtitle' }, 'Выездные делегации и приём иностранных партнёров, программы встреч')
      ),
      h('div', { class: 'page-actions' },
        h('a', { class: 'btn', href: '#/calendar' }, '▣ Календарь'),
        store.can('report.export') && h('button', {
          class: 'btn', onclick: () => api.download('/api/export/visits', query, 'visits.xlsx'),
        }, '⇩ Excel'),
        store.can('visit.create') && h('button', {
          class: 'btn btn-primary',
          onclick: () => openVisitForm({ onSaved: (saved) => navigate(`/visits/${saved.id}`) }),
        }, '+ Новый визит')
      )
    ),
    chips,
    filters,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Всего визитов: ${formatNumber(data.total)}`)),
      h('div', { class: 'card-body tight' }, table)
    )
  );
}

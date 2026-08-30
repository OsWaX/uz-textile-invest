// ==========================================================================
//  Общий календарь: сроки этапов, визиты, встречи (п. 8.2 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatDate, todayIso, MONTHS_NOM, WEEKDAYS_SHORT, toastOk,
} from '../ui.js';

export async function renderCalendar({ query, navigate }) {
  const today = new Date(`${todayIso()}T00:00:00Z`);
  const year = Number(query.year) || today.getUTCFullYear();
  const month = query.month !== undefined ? Number(query.month) : today.getUTCMonth();
  const view = query.view === 'list' ? 'list' : 'month';

  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const from = new Date(Date.UTC(year, month, -6)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 7)).toISOString().slice(0, 10);

  const { events } = await api.calendar({ from, to, responsible_id: query.responsible_id });

  const byType = {
    deadline: query.hide_deadline !== '1',
    visit: query.hide_visit !== '1',
    meeting: query.hide_meeting !== '1',
  };
  const visible = events.filter((event) => byType[event.type]);

  const shift = (delta) => navigate('/calendar', {
    ...query,
    year: month + delta < 0 ? year - 1 : month + delta > 11 ? year + 1 : year,
    month: (month + delta + 12) % 12,
  });

  const monthField = field('Месяц', h('div', { class: 'flex' },
      h('button', { class: 'btn btn-sm', onclick: () => shift(-1) }, '←'),
      h('span', { style: { minWidth: '150px', textAlign: 'center', fontWeight: '600' } }, `${MONTHS_NOM[month]} ${year}`),
      h('button', { class: 'btn btn-sm', onclick: () => shift(1) }, '→'),
      h('button', { class: 'btn btn-sm', onclick: () => navigate('/calendar', { ...query, year: today.getUTCFullYear(), month: today.getUTCMonth() }) }, 'Сегодня')
    ));
  monthField.classList.add('wide');

  const toolbar = h('div', { class: 'filters' },
    monthField,
    field('Ответственный', select(store.staff.map((u) => ({ value: u.id, label: u.full_name })), {
      value: query.responsible_id || '', placeholder: 'Все сотрудники',
      onchange: (e) => navigate('/calendar', { ...query, responsible_id: e.target.value }),
    })),
    field('Представление', select([{ value: 'month', label: 'Месяц' }, { value: 'list', label: 'Список' }], {
      value: view, onchange: (e) => navigate('/calendar', { ...query, view: e.target.value }),
    })),
    field('Подписка', h('button', {
      class: 'btn btn-sm',
      onclick: () => {
        api.download('/api/calendar.ics', { responsible_id: query.responsible_id }, 'project-office.ics');
        toastOk('Файл .ics загружен — подключите его в Outlook или Google Календаре.');
      },
    }, '⇩ Экспорт .ics'))
  );

  const legendRow = h('div', { class: 'filter-chips' },
    legendChip('Сроки этапов', '#1f4e9e', byType.deadline, () => navigate('/calendar', { ...query, hide_deadline: byType.deadline ? '1' : '' })),
    legendChip('Визиты', '#8a5cf0', byType.visit, () => navigate('/calendar', { ...query, hide_visit: byType.visit ? '1' : '' })),
    legendChip('Встречи', '#0f8a6a', byType.meeting, () => navigate('/calendar', { ...query, hide_meeting: byType.meeting ? '1' : '' }))
  );

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Календарь'),
        h('div', { class: 'subtitle' }, 'Сроки дорожных карт, периоды визитов и встречи в одном представлении')
      )
    ),
    toolbar,
    legendRow,
    h('div', { class: 'card' },
      h('div', { class: 'card-body' },
        view === 'month'
          ? monthGrid(monthStart, monthEnd, visible, today)
          : eventList(visible)
      )
    )
  );
}

function legendChip(label, color, active, onclick) {
  return h('button', { class: `chip ${active ? 'active' : ''}`, onclick },
    h('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '2px', background: color, marginRight: '6px' } }),
    label
  );
}

function monthGrid(monthStart, monthEnd, events, today) {
  const grid = h('div', { class: 'cal-grid' });
  for (const day of WEEKDAYS_SHORT) grid.append(h('div', { class: 'cal-dow' }, day));

  // Неделя начинается с понедельника.
  const firstWeekday = (monthStart.getUTCDay() + 6) % 7;
  const start = new Date(monthStart);
  start.setUTCDate(start.getUTCDate() - firstWeekday);
  const totalCells = Math.ceil((firstWeekday + monthEnd.getUTCDate()) / 7) * 7;

  const byDate = new Map();
  for (const event of events) {
    // Визиты занимают диапазон дат — размещаем на каждый день периода.
    const startDate = new Date(`${event.date}T00:00:00Z`);
    const endDate = new Date(`${event.end || event.date}T00:00:00Z`);
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(event);
      if (byDate.get(key).length > 40) break;
    }
  }

  for (let i = 0; i < totalCells; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = date.toISOString().slice(0, 10);
    const isOther = date.getUTCMonth() !== monthStart.getUTCMonth();
    const isToday = key === today.toISOString().slice(0, 10);
    const dayEvents = byDate.get(key) || [];

    grid.append(h('div', { class: `cal-cell ${isOther ? 'other' : ''} ${isToday ? 'today' : ''}` },
      h('div', { class: 'cal-daynum' }, String(date.getUTCDate())),
      dayEvents.slice(0, 4).map((event) =>
        h('a', {
          class: 'cal-event', href: event.link, title: `${event.title} — ${event.subtitle}`,
          style: { background: event.color },
        }, `${event.time ? `${event.time} ` : ''}${event.title}`)
      ),
      dayEvents.length > 4 ? h('div', { class: 'small muted' }, `ещё ${dayEvents.length - 4}`) : null
    ));
  }
  return grid;
}

function eventList(events) {
  if (!events.length) return h('p', { class: 'muted mb-0' }, 'Событий за выбранный период нет.');
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  return h('div', {},
    [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) =>
      h('div', { class: 'mb-2' },
        h('div', { class: 'form-section-title' }, formatDate(date, { long: true })),
        items.map((event) =>
          h('a', { class: 'attention-item', href: event.link, style: { color: 'inherit', textDecoration: 'none' } },
            h('span', { class: 'marker', style: { background: event.color } }),
            h('span', { style: { flex: '1', minWidth: '0' } },
              h('div', { class: 'a-title' }, `${event.time ? `${event.time} · ` : ''}${event.title}`),
              h('div', { class: 'a-meta' }, event.subtitle)
            ),
            h('span', { class: 'a-right muted' }, event.responsible || '')
          )
        )
      )
    )
  );
}

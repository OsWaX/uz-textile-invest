// ==========================================================================
//  Дашборд и аналитика (раздел 6 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, formatMoney, formatNumber, formatDate, daysUntil, plural, empty, select, statusTag, column,
} from '../ui.js';
import { donutChart, legend, barList, dynamicsChart, worldMap } from '../charts.js';

export async function renderDashboard({ query, navigate }) {
  const scope = query.scope || (store.isAdmin ? 'all' : 'my_region');
  const params = { scope, ...(query.sector ? { sector: query.sector } : {}), ...(query.area ? { area: query.area } : {}) };
  const data = await api.dashboard(params);
  const kpi = data.kpi;

  const scopeChips = h('div', { class: 'filter-chips' },
    [
      { key: 'all', label: 'Весь офис' },
      { key: 'my_region', label: 'Мой регион' },
      { key: 'mine', label: 'Мои проекты' },
    ].map((item) =>
      h('button', {
        class: `chip ${scope === item.key ? 'active' : ''}`,
        onclick: () => navigate('/dashboard', { ...query, scope: item.key }),
      }, item.label)
    ),
    h('span', { class: 'spacer' }),
    [
      { key: '', label: 'Все отрасли' },
      ...(store.reference.sectors.map((s) => ({ key: s.code, label: s.name_ru }))),
    ].map((item) =>
      h('button', {
        class: `chip ${(query.sector || '') === item.key ? 'active' : ''}`,
        onclick: () => navigate('/dashboard', { ...query, sector: item.key || undefined }),
      }, item.label)
    )
  );

  const kpiCards = h('div', { class: 'grid grid-4' },
    kpiCard('Активных проектов', formatNumber(kpi.projects_active), `всего записей: ${kpi.projects_total}`),
    kpiCard('Общая сумма портфеля', formatMoney(kpi.amount_total_usd, 'USD', { compact: true }), 'в пересчёте на доллары США', 'gold'),
    kpiCard('Экспорт', formatMoney(kpi.amount_export_usd, 'USD', { compact: true }), 'сумма экспортных проектов', 'ok'),
    kpiCard('Инвестиции', formatMoney(kpi.amount_investment_usd, 'USD', { compact: true }), 'сумма инвестиционных проектов', 'gold'),
    kpiCard('Подписано за квартал', formatNumber(kpi.signed_quarter), `с начала года: ${kpi.signed_year}`),
    kpiCard('Предстоящих визитов', formatNumber(kpi.upcoming_visits), 'ближайшие поездки и приёмы'),
    kpiCard('Компаний-партнёров', formatNumber(kpi.companies_total), 'в справочнике'),
    kpiCard('Просроченных этапов', formatNumber(kpi.overdue_steps), kpi.overdue_steps ? 'требуют внимания' : 'просрочек нет',
      kpi.overdue_steps ? 'danger' : 'ok')
  );

  // --- Панель внимания ---
  const attention = data.attention;
  const attentionCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Панель внимания'),
      h('span', { class: 'muted small' }, `порог «замершего» проекта — ${attention.stale_days} дн.`)
    ),
    h('div', { class: 'card-body' },
      attentionSection('Просроченные этапы', attention.overdue_steps, 'var(--danger)', (item) => ({
        title: item.title,
        meta: `${item.code} — ${item.project_title} · ${item.responsible_name || 'без ответственного'}`,
        right: `просрочено на ${Math.abs(daysUntil(item.due_date))} ${plural(Math.abs(daysUntil(item.due_date)), 'день', 'дня', 'дней')}`,
        href: `#/projects/${item.project_id}`,
      })),
      attentionSection('Сроки в ближайшие 7 дней', attention.due_soon_steps, 'var(--warn)', (item) => ({
        title: item.title,
        meta: `${item.code} — ${item.project_title} · ${item.responsible_name || '—'}`,
        right: formatDate(item.due_date),
        href: `#/projects/${item.project_id}`,
      })),
      attentionSection('Проекты без активности', attention.stale_projects, 'var(--gold)', (item) => ({
        title: item.title,
        meta: `${item.code} · ${item.responsible_name || '—'}`,
        right: `активность: ${formatDate(item.last_activity_at)}`,
        href: `#/projects/${item.id}`,
      })),
      attentionSection(`Несогласованные встречи (визит в ближайшие ${attention.tbc_days} дн.)`, attention.tbc_meetings, 'var(--violet)', (item) => ({
        title: item.company_name,
        meta: `${item.visit_code} · ${item.country_name} · встреча ${formatDate(item.meet_date)}`,
        right: `визит с ${formatDate(item.date_from)}`,
        href: `#/visits/${item.visit_id}`,
      })),
      !attention.overdue_steps.length && !attention.due_soon_steps.length &&
        !attention.stale_projects.length && !attention.tbc_meetings.length
        ? h('p', { class: 'muted mb-0' }, 'Записей, требующих внимания, нет.')
        : null
    )
  );

  // --- Диаграммы ---
  const statusItems = data.by_status.filter((s) => s.count);
  const chartsRow = h('div', { class: 'grid grid-2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Проекты по статусам')),
      h('div', { class: 'card-body' },
        h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } },
          donutChart(statusItems, { centerValue: String(kpi.projects_total), centerLabel: 'всего' }),
          h('div', { style: { flex: '1', minWidth: '190px' } }, legend(data.by_status))
        )
      )
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Отрасли и направления')),
      h('div', { class: 'card-body' },
        h('div', { class: 'form-section-title' }, 'По отраслям'),
        barList(data.by_sector.map((s) => ({ ...s, color: s.color })), {}),
        h('div', { class: 'form-section-title' }, 'По направлениям'),
        barList(data.by_area.map((a, i) => ({ ...a, color: i === 0 ? '#0f8a6a' : '#a5791f' })), {})
      )
    )
  );

  const mapCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'География портфеля'),
      h('span', { class: 'muted small' }, 'нажмите на регион, чтобы открыть его проекты')
    ),
    h('div', { class: 'card-body' },
      worldMap(data.by_region, {
        onSelect: (code) => navigate('/projects', { region: code }),
      }),
      h('p', { class: 'small muted mt-1 mb-0' },
        'Схематическая карта регионов ответственности проектных менеджеров. Насыщенность цвета отражает число проектов.')
    )
  );

  const listsRow = h('div', { class: 'grid grid-3' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'По регионам')),
      h('div', { class: 'card-body' },
        barList(data.by_region, { onSelect: (item) => navigate('/projects', { region: item.key }) })
      )
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'По странам')),
      h('div', { class: 'card-body' },
        barList(data.by_country, {
          limit: 10,
          onSelect: (item) => {
            const country = store.reference.countries.find((c) => c.iso2 === item.key);
            if (country) navigate('/projects', { country_id: country.id });
          },
        })
      )
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'По менеджерам')),
      h('div', { class: 'card-body' },
        barList(data.by_manager, { onSelect: (item) => navigate('/projects', { responsible_id: item.key }) })
      )
    )
  );

  const dynamicsCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Динамика новых записей по месяцам')),
    h('div', { class: 'card-body' }, dynamicsChart(data.dynamics))
  );

  const visitsCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Ближайшие визиты'),
      h('a', { class: 'btn btn-sm', href: '#/visits' }, 'Все визиты')
    ),
    data.upcoming_visits.length
      ? h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Визит'), h('th', {}, 'Даты'), h('th', {}, 'Статус'), h('th', {}, 'Ответственный')
              )),
              h('tbody', {}, data.upcoming_visits.map((visit) =>
                h('tr', {},
                  h('td', {},
                    h('a', { href: `#/visits/${visit.id}`, class: 't-main' }, `${visit.country_name}, ${visit.cities}`),
                    h('div', { class: 't-sub' }, `${visit.code} · ${visit.direction === 'outbound' ? 'выезд' : 'приём делегации'}`)
                  ),
                  h('td', { class: 'nowrap' }, `${formatDate(visit.date_from)} – ${formatDate(visit.date_to)}`),
                  h('td', {}, statusTag(visit.status_name, visit.status_color)),
                  h('td', {}, visit.responsible_name)
                )
              ))
            )
          )
        )
      : h('div', { class: 'card-body' }, h('p', { class: 'muted mb-0' }, 'Предстоящих визитов нет.'))
  );

  return frag(
    h('div', { class: 'print-header' },
      h('div', { class: 'ministry' }, store.reference.settings.ministry),
      h('div', { class: 'doc-title' }, 'Сводка по портфелю проектов'),
      h('div', { class: 'doc-meta' }, `Сформировано: ${formatDate(new Date().toISOString(), { long: true })}`)
    ),
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Дашборд'),
        h('div', { class: 'subtitle' }, store.reference.settings.org_name)
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Печать / PDF'),
        store.can('report.export') && h('button', {
          class: 'btn btn-primary',
          onclick: () => api.download('/api/export/report/portfolio', params, 'portfolio.xlsx'),
        }, '⇩ Сводный отчёт Excel')
      )
    ),
    scopeChips,
    kpiCards,
    h('div', { class: 'split mt-2' },
      column(chartsRow, mapCard, dynamicsCard, visitsCard),
      column(attentionCard)
    )
  );
}

function kpiCard(label, value, note, modifier = '') {
  return h('div', { class: `kpi ${modifier}` },
    h('div', { class: 'label' }, label),
    h('div', { class: `value ${String(value).length > 9 ? 'sm' : ''}` }, value),
    h('div', { class: 'note' }, note)
  );
}

function attentionSection(title, items, color, map) {
  if (!items.length) return null;
  return h('div', { class: 'mb-2' },
    h('div', { class: 'form-section-title' }, `${title} · ${items.length}`),
    items.slice(0, 6).map((item) => {
      const data = map(item);
      return h('a', { class: 'attention-item', href: data.href, style: { color: 'inherit', textDecoration: 'none' } },
        h('span', { class: 'marker', style: { background: color } }),
        h('span', { style: { minWidth: '0', flex: '1' } },
          h('div', { class: 'a-title' }, data.title),
          h('div', { class: 'a-meta' }, data.meta)
        ),
        h('span', { class: 'a-right muted' }, data.right)
      );
    }),
    items.length > 6 ? h('div', { class: 'small muted mt-1' }, `и ещё ${items.length - 6}`) : null
  );
}

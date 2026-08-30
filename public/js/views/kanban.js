// ==========================================================================
//  Доска проектов по статусам с перетаскиванием карточек (раздел 10 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import { h, frag, field, select, formatMoney, toastOk, toastError, formatDate, setChildren,
} from '../ui.js';

export async function renderKanban({ query, navigate }) {
  const board = await api.kanban(query);
  const host = h('div', { class: 'kanban' });

  const reload = async () => {
    const fresh = await api.kanban(query);
    drawColumns(fresh);
  };

  function drawColumns(data) {
    setChildren(host, 
      data.columns.map((column) => {
        const cards = h('div', { class: 'kanban-cards' },
          column.projects.map((project) => card(project, reload))
        );

        const columnEl = h('div', { class: 'kanban-col' },
          h('div', { class: 'kanban-col-head' },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: column.color || 'var(--indigo)' } }),
            h('span', {}, column.name_ru),
            h('span', { class: 'count' }, String(column.projects.length))
          ),
          cards
        );

        // Перетаскивание доступно тем, кто может менять статус.
        columnEl.addEventListener('dragover', (event) => {
          if (!store.can('project.status_change')) return;
          event.preventDefault();
          columnEl.classList.add('drag-over');
        });
        columnEl.addEventListener('dragleave', () => columnEl.classList.remove('drag-over'));
        columnEl.addEventListener('drop', async (event) => {
          event.preventDefault();
          columnEl.classList.remove('drag-over');
          const projectId = event.dataTransfer.getData('text/plain');
          if (!projectId) return;
          try {
            await api.patch(`/api/projects/${projectId}`, {
              status_code: column.code,
              status_comment: 'Изменение статуса перетаскиванием на доске',
            });
            toastOk(`Статус изменён на «${column.name_ru}».`);
            reload();
          } catch (error) {
            toastError(error.message);
          }
        });

        return columnEl;
      })
    );
  }

  drawColumns(board);

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Доска проектов'),
        h('div', { class: 'subtitle' },
          store.can('project.status_change')
            ? 'Перетащите карточку в другую колонку, чтобы изменить статус проекта'
            : 'Просмотр воронки проектов по статусам')
      ),
      h('div', { class: 'page-actions' }, h('a', { class: 'btn', href: '#/projects' }, '▦ Таблица'))
    ),
    h('div', { class: 'filters' },
      field('Отрасль', select(store.reference.sectors.map((s) => ({ value: s.code, label: s.name_ru })),
        { value: query.sector || '', placeholder: 'Все отрасли', onchange: (e) => navigate('/kanban', { ...query, sector: e.target.value }) })),
      field('Направление', select([{ value: 'export', label: 'Экспорт' }, { value: 'investment', label: 'Инвестиции' }],
        { value: query.area || '', placeholder: 'Все направления', onchange: (e) => navigate('/kanban', { ...query, area: e.target.value }) })),
      field('Регион', select(store.reference.regions.map((r) => ({ value: r.code, label: r.name_ru })),
        { value: query.region || '', placeholder: 'Все регионы', onchange: (e) => navigate('/kanban', { ...query, region: e.target.value }) })),
      field('Ответственный', select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
        { value: query.responsible_id || '', placeholder: 'Все сотрудники', onchange: (e) => navigate('/kanban', { ...query, responsible_id: e.target.value }) }))
    ),
    host
  );
}

function card(project, reload) {
  const node = h('div', {
    class: 'kanban-card',
    draggable: store.can('project.status_change'),
    onclick: () => { location.hash = `#/projects/${project.id}`; },
  },
    h('div', { class: 'kc-code' }, project.code),
    h('div', { class: 'kc-title' }, project.title),
    h('div', { class: 'kc-meta' },
      h('span', {}, project.country_name),
      h('span', {}, formatMoney(project.amount, project.currency, { compact: true }))
    ),
    h('div', { class: 'kc-meta mt-1' },
      h('span', {}, project.responsible_name),
      project.steps_overdue > 0 ? h('span', { style: { color: 'var(--danger)' } }, `просрочено: ${project.steps_overdue}`) : null,
      project.next_due_date && !project.steps_overdue ? h('span', {}, `до ${formatDate(project.next_due_date)}`) : null
    )
  );

  node.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', String(project.id));
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));
  return node;
}

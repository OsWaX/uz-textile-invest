// ==========================================================================
//  Заявки на исправление записей (п. 2.3 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, formatDateTime, empty, openModal, toastOk, toastError, setChildren,
} from '../ui.js';

const STATUS_LABELS = { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена' };
const ENTITY_LABELS = { project: 'Проект', company: 'Компания', visit: 'Визит', meeting: 'Встреча', step: 'Этап' };
const ENTITY_ROUTES = { project: 'projects', company: 'companies', visit: 'visits', meeting: 'visits', step: 'projects' };

export async function renderCorrections({ query, navigate }) {
  const container = h('div', {});
  const reload = async () => {
    const rows = await api.get('/api/corrections', query.status ? { status: query.status } : {});
    draw(rows);
  };

  function draw(rows) {
    const chips = h('div', { class: 'filter-chips' },
      [
        { key: '', label: 'Все заявки' },
        { key: 'pending', label: 'На рассмотрении' },
        { key: 'approved', label: 'Одобренные' },
        { key: 'rejected', label: 'Отклонённые' },
      ].map((item) =>
        h('button', {
          class: `chip ${(query.status || '') === item.key ? 'active' : ''}`,
          onclick: () => navigate('/corrections', item.key ? { status: item.key } : {}),
        }, item.label)
      )
    );

    setChildren(container, 
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Заявки на исправление'),
          h('div', { class: 'subtitle' },
            store.isAdmin
              ? 'Запросы проектных менеджеров на изменение созданных записей'
              : 'Ваши запросы на исправление записей')
        )
      ),
      h('div', { class: 'callout info' },
        'Проектные менеджеры не могут изменять записи после создания — это гарантирует достоверность данных. ',
        'Ошибки исправляются через заявку: администратор вносит изменение, и оно фиксируется в журнале аудита.'),
      chips,
      rows.length
        ? h('div', { class: 'card' }, h('div', { class: 'card-body tight' }, table(rows, reload)))
        : h('div', { class: 'card' }, h('div', { class: 'card-body' },
            empty('Заявок нет', 'Запросы на исправление появятся здесь.', '✎')))
    );
  }

  await reload();
  return container;
}

function table(rows, reload) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Статус'), h('th', {}, 'Запись'), h('th', {}, 'Что исправить'),
        h('th', {}, 'Автор'), h('th', {}, 'Решение'), store.can('correction.decide') ? h('th', {}, '') : null
      )),
      h('tbody', {}, rows.map((request) =>
        h('tr', {},
          h('td', {},
            h('span', {
              class: `tag ${request.status === 'pending' ? 'tag-warn' : request.status === 'approved' ? 'tag-ok' : 'tag-danger'}`,
            }, STATUS_LABELS[request.status]),
            h('div', { class: 't-sub' }, formatDateTime(request.created_at))
          ),
          h('td', {},
            h('a', { href: `#/${ENTITY_ROUTES[request.entity_type]}/${request.entity_id}` },
              request.entity_label || `${ENTITY_LABELS[request.entity_type]} №${request.entity_id}`),
            h('div', { class: 't-sub' }, ENTITY_LABELS[request.entity_type])
          ),
          h('td', { style: { maxWidth: '380px' } }, request.reason),
          h('td', {}, request.requested_by_name),
          h('td', {},
            request.status === 'pending'
              ? h('span', { class: 'muted' }, '—')
              : frag(request.decided_by_name || '—',
                  h('div', { class: 't-sub' }, formatDateTime(request.decided_at)),
                  request.decision_note ? h('div', { class: 'small' }, request.decision_note) : null)
          ),
          store.can('correction.decide')
            ? h('td', {},
                request.status === 'pending'
                  ? h('div', { class: 'flex', style: { gap: '5px' } },
                      h('button', { class: 'btn btn-sm btn-primary', onclick: () => decide(request, 'approved', reload) }, 'Одобрить'),
                      h('button', { class: 'btn btn-sm', onclick: () => decide(request, 'rejected', reload) }, 'Отклонить')
                    )
                  : null
              )
            : null
        )
      ))
    )
  );
}

function decide(request, decision, reload) {
  const note = h('textarea', {
    placeholder: decision === 'approved'
      ? 'Опишите, какое изменение внесено в запись'
      : 'Причина отклонения заявки',
  });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, decision === 'approved' ? 'Одобрить' : 'Отклонить');

  const dialog = openModal({
    title: decision === 'approved' ? 'Одобрение заявки' : 'Отклонение заявки',
    size: 'narrow',
    body: h('div', {},
      h('div', { class: 'callout' }, request.reason),
      decision === 'approved'
        ? h('p', { class: 'small muted' }, 'После одобрения внесите изменение в карточке записи — обе операции попадут в журнал аудита.')
        : null,
      field('Комментарий', note)
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    try {
      await api.post(`/api/corrections/${request.id}/decide`, { decision, note: note.value.trim() });
      dialog.close();
      toastOk('Решение сохранено, автор заявки уведомлён.');
      reload();
    } catch (error) { toastError(error.message); }
  };
}

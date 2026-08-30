// ==========================================================================
//  Карточка проекта / соглашения: дорожная карта, лента, файлы, история.
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatDate, formatDateTime, formatMoney, relativeTime, statusTag,
  renderComment, initials, confirmDialog, toastOk, toastError, openModal, daysUntil, plural,
  AREA_LABELS, STEP_STATE_LABELS, todayIso, setChildren, column,
} from '../ui.js';
import { openProjectForm, openCorrectionForm, uploadZone, fileRow } from './forms.js';
import { refreshNotificationBadge } from '../app.js';

export async function renderProject({ params, navigate }) {
  const id = Number(params[0]);
  let project = await api.project(id);

  const container = h('div', {});
  const reload = async () => {
    project = await api.project(id);
    draw();
  };

  function draw() {
    setChildren(container, 
      printHeader(project),
      header(project, { reload, navigate }),
      h('div', { class: 'split' },
        column(
          overviewCard(project),
          roadmapCard(project, reload),
          commentsCard(project, reload),
          meetingsCard(project)
        ),
        column(
          filesCard(project, reload),
          pollsCard(project, reload),
          statusHistoryCard(project),
          correctionsCard(project, reload)
        )
      )
    );
  }

  draw();
  return container;
}

function printHeader(project) {
  return h('div', { class: 'print-header' },
    h('div', { class: 'ministry' }, store.reference.settings.ministry),
    h('div', { class: 'doc-title' }, `Карточка проекта ${project.code}`),
    h('div', { class: 'doc-meta' },
      `${project.title} · ${project.company_name} · ${project.country_name} · сформировано ${formatDate(new Date().toISOString(), { long: true })}`)
  );
}

function header(project, { reload, navigate }) {
  const canEdit = store.can('project.edit');
  const canRequestCorrection = store.can('correction.request');

  return frag(
    h('div', { class: 'breadcrumbs' },
      h('a', { href: '#/projects' }, 'Проекты и соглашения'), ' / ', project.code),
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, project.title),
        h('div', { class: 'subtitle' },
          h('a', { href: `#/companies/${project.company_id}` }, project.company_name),
          ` · ${project.country_name} (${project.region_name}) · ${project.record_type_name}`
        ),
        h('div', { class: 'pill-row mt-1' },
          statusTag(project.status_name, project.status_color),
          statusTag(project.sector_name, project.sector_color),
          h('span', { class: 'tag tag-plain' }, AREA_LABELS[project.area]),
          project.is_overdue && h('span', { class: 'tag tag-danger' }, `просроченных этапов: ${project.steps_overdue}`),
          project.is_stale && h('span', { class: 'tag tag-warn' }, 'нет активности')
        )
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Печать / PDF'),
        store.can('project.status_change') && h('button', {
          class: 'btn', onclick: () => openStatusDialog(project, reload),
        }, '⟳ Сменить статус'),
        canEdit && h('button', {
          class: 'btn', onclick: () => openProjectForm({ project, onSaved: reload }),
        }, '✎ Изменить'),
        !canEdit && canRequestCorrection && h('button', {
          class: 'btn',
          onclick: () => openCorrectionForm({
            entityType: 'project', entityId: project.id,
            entityLabel: `${project.code} — ${project.title}`, onSaved: reload,
          }),
        }, '✎ Запросить исправление'),
        store.can('project.delete') && h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            const confirmed = await confirmDialog({
              title: 'Удаление записи',
              message: `Удалить проект ${project.code}? Запись переместится в корзину и может быть восстановлена администратором в течение ${store.reference.settings.stale_days ? 30 : 30} дней.`,
              confirmLabel: 'Удалить', danger: true,
            });
            if (!confirmed) return;
            await api.delete(`/api/projects/${project.id}`);
            toastOk('Запись перемещена в корзину.');
            navigate('/projects');
          },
        }, 'Удалить')
      )
    )
  );
}

function overviewCard(project) {
  const custom = store.reference.custom_fields.project.filter((f) => f.is_active && f.type !== 'poll' && f.type !== 'file');
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Сведения о записи'), h('span', { class: 'mono muted' }, project.code)),
    h('div', { class: 'card-body' },
      h('dl', { class: 'def-list' },
        def('Тип записи', project.record_type_name),
        def('Отрасль', project.sector_name),
        def('Направление', AREA_LABELS[project.area]),
        def('Страна и регион', `${project.country_name} · ${project.region_name}`),
        def('Иностранный партнёр', h('a', { href: `#/companies/${project.company_id}` }, project.company_name)),
        def('Местные партнёры', project.partners?.length
          ? h('div', {}, project.partners.map((x, i) => h('div', { style: i ? { marginTop: '3px' } : {} },
              h('a', { href: `#/companies/${x.company_id}` }, x.company_name),
              x.role_note ? h('span', { class: 'muted small' }, ` — ${x.role_note}`) : null)))
          : h('span', { class: 'muted' }, 'не указаны')),
        def('Сумма', formatMoney(project.amount, project.currency)),
        def('Ответственный', project.responsible_name),
        def('Статус', statusTag(project.status_name, project.status_color)),
        def('Создано', `${formatDateTime(project.created_at)} · ${project.created_by_name || '—'}`),
        def('Последнее изменение', formatDateTime(project.updated_at)),
        def('Последняя активность', formatDateTime(project.last_activity_at)),
        ...custom.map((cf) => def(cf.label_ru, formatCustom(cf, project.custom_values[cf.field_key])))
      ),
      project.description
        ? frag(h('div', { class: 'form-section-title' }, 'Описание'), h('p', { class: 'mb-0' }, project.description))
        : null,
      project.locations?.length
        ? frag(
            h('div', { class: 'form-section-title' }, 'Регионы реализации в Узбекистане'),
            !project.locations_allowed
              ? h('p', { class: 'small muted' },
                  'Заполнено, когда запись относилась к инвестиционным проектам.')
              : null,
            h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Регион'), h('th', {}, 'Город или район'), h('th', { class: 'num' }, 'Объём в регионе'))),
              h('tbody', {}, project.locations.map((loc) => h('tr', {},
                h('td', { class: 'strong' }, loc.region_name),
                h('td', {}, loc.locality),
                h('td', { class: 'num' }, loc.amount ? formatMoney(loc.amount, project.currency) : h('span', { class: 'muted' }, 'не распределён'))))))))
        : null,
      h('div', { class: 'form-section-title' }, 'Контактные лица иностранного партнёра'),
      project.contacts.length
        ? h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'ФИО'), h('th', {}, 'Должность'), h('th', {}, 'Телефон'), h('th', {}, 'Эл. почта'))),
              h('tbody', {}, project.contacts.map((contact) =>
                h('tr', {},
                  h('td', { class: 'strong' }, contact.full_name),
                  h('td', {}, contact.position || '—'),
                  h('td', {}, contact.phone ? h('a', { href: `tel:${contact.phone}` }, contact.phone) : '—'),
                  h('td', {}, contact.email ? h('a', { href: `mailto:${contact.email}` }, contact.email) : '—')
                )
              ))
            )
          )
        : h('p', { class: 'muted' }, 'Контактные лица не указаны.')
    )
  );
}

const def = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value ?? '—'));

function formatCustom(cf, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (cf.type === 'checkbox') return value ? 'Да' : 'Нет';
  if (cf.type === 'money') return formatMoney(value, 'USD');
  if (cf.type === 'date') return formatDate(value);
  if (cf.type === 'user') return store.userById(value)?.full_name || '—';
  if (cf.type === 'url') return h('a', { href: value, target: '_blank', rel: 'noopener' }, value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// --------------------------------------------------------------------------
//  Дорожная карта (п. 3.2 ТЗ): чек-лист и горизонтальная диаграмма сроков
// --------------------------------------------------------------------------
function roadmapCard(project, reload) {
  const steps = project.steps;
  const canAdd = store.can('step.create');
  const canEditSteps = store.can('step.edit');

  const checklist = h('div', {},
    steps.length === 0 ? h('p', { class: 'muted' }, 'Этапы дорожной карты ещё не заданы.') : null,
    steps.map((step) => {
      const canComplete = store.isAdmin || step.responsible_user_id === store.user.id || project.responsible_user_id === store.user.id;
      const remaining = daysUntil(step.due_date);
      return h('div', { class: 'step-row' },
        h('button', {
          class: `step-check ${step.state === 'done' ? 'done' : ''}`,
          disabled: !canComplete,
          title: canComplete ? 'Отметить выполнение' : 'Доступно ответственному за этап',
          onclick: () => openStepCompletion(step, project, reload),
        }, '✓'),
        h('div', { class: 'step-main' },
          h('div', { class: `step-title ${step.state === 'done' ? 'done' : ''}` }, step.title),
          step.description ? h('div', { class: 'small muted' }, step.description) : null,
          h('div', { class: 'step-meta' },
            h('span', {}, `Срок: ${formatDate(step.due_date)}`),
            h('span', {}, step.responsible_name || 'без ответственного'),
            step.state === 'done'
              ? h('span', { style: { color: 'var(--ok)' } }, `выполнен ${formatDate(step.done_at)}${step.done_by_name ? ` · ${step.done_by_name}` : ''}`)
              : step.is_overdue
                ? h('span', { style: { color: 'var(--danger)' } }, `просрочен на ${Math.abs(remaining)} ${plural(Math.abs(remaining), 'день', 'дня', 'дней')}`)
                : remaining !== null
                  ? h('span', {}, remaining === 0 ? 'срок сегодня' : `осталось ${remaining} ${plural(remaining, 'день', 'дня', 'дней')}`)
                  : null,
            step.files_count ? h('span', {}, `📎 ${step.files_count}`) : null,
            h('span', { class: 'tag tag-plain' }, STEP_STATE_LABELS[step.state])
          ),
          step.done_comment ? h('div', { class: 'small mt-1' }, `Комментарий: ${step.done_comment}`) : null
        ),
        h('div', { class: 'flex', style: { gap: '4px' } },
          h('button', { class: 'btn btn-sm', title: 'Файлы этапа', onclick: () => openStepFiles(step, reload) }, '📎'),
          canEditSteps && h('button', { class: 'btn btn-sm', onclick: () => openStepForm({ project, step, reload }) }, '✎'),
          store.can('step.delete') && h('button', {
            class: 'btn btn-sm',
            onclick: async () => {
              if (!await confirmDialog({ title: 'Удаление этапа', message: `Удалить этап «${step.title}»?`, confirmLabel: 'Удалить', danger: true })) return;
              await api.delete(`/api/steps/${step.id}`);
              toastOk('Этап удалён.');
              reload();
            },
          }, '✕')
        )
      );
    })
  );

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Дорожная карта'),
      h('span', { class: 'muted small' }, `${project.steps_done} из ${project.steps_total} выполнено`),
      canAdd && h('button', { class: 'btn btn-sm btn-primary', onclick: () => openStepForm({ project, reload }) }, '+ Этап')
    ),
    h('div', { class: 'card-body' },
      steps.length ? ganttChart(steps) : null,
      checklist,
      !store.isAdmin && steps.length
        ? h('p', { class: 'small muted mt-2 mb-0' },
            'Проектный менеджер может добавлять этапы и отмечать выполнение своих этапов. ' +
            'Изменение и удаление этапов выполняет администратор.')
        : null
    )
  );
}

/** Простая диаграмма сроков этапов. */
function ganttChart(steps) {
  const dated = steps.filter((s) => s.due_date);
  if (dated.length < 2) return null;

  const dates = dated.map((s) => new Date(`${s.due_date}T00:00:00Z`).getTime());
  const today = new Date(`${todayIso()}T00:00:00Z`).getTime();
  const min = Math.min(...dates, today);
  const max = Math.max(...dates, today);
  const span = Math.max(max - min, 86400000);
  const position = (time) => ((time - min) / span) * 100;

  return h('div', { class: 'mb-2' },
    h('div', { class: 'gantt' },
      dated.map((step, index) => {
        const time = new Date(`${step.due_date}T00:00:00Z`).getTime();
        const previous = index > 0 ? new Date(`${dated[index - 1].due_date}T00:00:00Z`).getTime() : min;
        const left = position(Math.min(previous, time));
        const width = Math.max(position(time) - left, 2);
        const color = step.state === 'done' ? 'var(--ok)' : step.is_overdue ? 'var(--danger)' : 'var(--indigo)';
        return h('div', { class: 'gantt-row' },
          h('span', { class: 'nowrap', style: { overflow: 'hidden', textOverflow: 'ellipsis' }, title: step.title }, step.title),
          h('div', { class: 'gantt-track' },
            h('div', { class: 'gantt-bar', style: { left: `${left}%`, width: `${width}%`, background: color } }),
            h('div', { class: 'gantt-today', style: { left: `${position(today)}%` } })
          )
        );
      })
    ),
    h('div', { class: 'gantt-axis' },
      h('span', {}, formatDate(new Date(min).toISOString().slice(0, 10))),
      h('span', { style: { color: 'var(--danger)' } }, 'сегодня'),
      h('span', {}, formatDate(new Date(max).toISOString().slice(0, 10)))
    )
  );
}

function openStepForm({ project, step = null, reload }) {
  const titleInput = h('input', { type: 'text', value: step?.title || '', maxlength: 300, placeholder: 'Что необходимо сделать' });
  const descriptionInput = h('textarea', { maxlength: 5000 }, step?.description || '');
  const dueInput = h('input', { type: 'date', value: step?.due_date || '' });
  const responsibleSelect = select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
    { value: step?.responsible_user_id || project.responsible_user_id });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, step ? 'Сохранить' : 'Добавить этап');

  const dialog = openModal({
    title: step ? 'Изменение этапа' : 'Новый этап дорожной карты',
    body: h('div', {},
      errorBox,
      field('Описание этапа', titleInput, { required: true }),
      field('Подробности', descriptionInput),
      h('div', { class: 'form-row' },
        field('Срок выполнения', dueInput, { help: 'При наступлении срока этап автоматически станет просроченным' }),
        field('Ответственный', responsibleSelect)
      )
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        title: titleInput.value.trim(),
        description: descriptionInput.value.trim(),
        due_date: dueInput.value,
        responsible_user_id: responsibleSelect.value,
      };
      if (step) await api.patch(`/api/steps/${step.id}`, payload);
      else await api.post(`/api/projects/${project.id}/steps`, payload);
      dialog.close();
      toastOk(step ? 'Этап изменён.' : 'Этап добавлен в дорожную карту.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

/** Отметка о выполнении с приложением подтверждающих материалов. */
function openStepCompletion(step, project, reload) {
  const stateSelect = select(
    Object.entries(STEP_STATE_LABELS).map(([value, label]) => ({ value, label })),
    { value: step.state === 'done' ? 'done' : step.state }
  );
  const commentInput = h('textarea', { placeholder: 'Что сделано, какие материалы приложены' }, step.done_comment || '');
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить');

  const dialog = openModal({
    title: `Состояние этапа: ${step.title}`,
    body: h('div', {},
      errorBox,
      h('div', { class: 'callout info' },
        'Отметка о выполнении фиксируется в журнале. Текст этапа при этом не изменяется.'),
      field('Состояние', stateSelect, { required: true }),
      field('Комментарий о выполнении', commentInput),
      h('div', { class: 'form-section-title' }, 'Подтверждающие материалы'),
      uploadZone({ entityType: 'step', entityId: step.id, onUploaded: () => toastOk('Файл приложен к этапу.') })
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Закрыть'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      await api.patch(`/api/steps/${step.id}`, { state: stateSelect.value, done_comment: commentInput.value.trim() });
      dialog.close();
      toastOk('Состояние этапа обновлено.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

async function openStepFiles(step, reload) {
  const list = h('div', {});
  const load = async () => {
    const project = await api.project(step.project_id);
    const refreshed = project.steps.find((s) => s.id === step.id);
    setChildren(list, 
      refreshed?.files_count
        ? h('p', { class: 'small muted' }, `Файлов: ${refreshed.files_count}. Откройте карточку проекта для полного списка.`)
        : h('p', { class: 'muted' }, 'К этапу пока не приложено файлов.')
    );
  };

  openModal({
    title: `Файлы этапа: ${step.title}`,
    body: h('div', {},
      list,
      store.can('attachment.upload')
        ? uploadZone({ entityType: 'step', entityId: step.id, onUploaded: () => { load(); reload(); } })
        : null
    ),
    onClose: reload,
  });
  load();
}

// --------------------------------------------------------------------------
//  Лента комментариев (P-13): только добавление
// --------------------------------------------------------------------------
function commentsCard(project, reload) {
  const input = h('textarea', { placeholder: 'Комментарий о ходе работы. Упомяните коллегу через @Фамилия — он получит уведомление.', maxlength: 5000 });
  const sendButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Добавить в ленту');

  sendButton.onclick = async () => {
    const body = input.value.trim();
    if (!body) return;
    sendButton.disabled = true;
    try {
      await api.post(`/api/projects/${project.id}/comments`, { body });
      input.value = '';
      toastOk('Комментарий добавлен.');
      refreshNotificationBadge();
      reload();
    } catch (error) {
      toastError(error.message);
    } finally {
      sendButton.disabled = false;
    }
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Лента комментариев'),
      h('span', { class: 'muted small' }, 'записи не редактируются и не удаляются')
    ),
    h('div', { class: 'card-body' },
      store.can('project.comment')
        ? h('div', { class: 'mb-2 no-print' }, input, h('div', { class: 'mt-1' }, sendButton))
        : null,
      project.comments.length === 0 ? h('p', { class: 'muted mb-0' }, 'Комментариев пока нет.') : null,
      project.comments.map((comment) =>
        h('div', { class: 'feed-item' },
          h('span', { class: 'avatar' }, initials(comment.author_name)),
          h('div', { class: 'feed-body' },
            h('div', { class: 'feed-head' },
              h('span', { class: 'feed-author' }, comment.author_name),
              h('span', { class: 'feed-time' }, relativeTime(comment.created_at))
            ),
            renderComment(comment.body)
          )
        )
      )
    )
  );
}

function meetingsCard(project) {
  if (!project.meetings.length) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Встречи по этому проекту')),
    h('div', { class: 'card-body tight' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Организация'), h('th', {}, 'Визит'), h('th', {}, 'Место'))),
          h('tbody', {}, project.meetings.map((meeting) =>
            h('tr', {},
              h('td', { class: 'nowrap' }, formatDate(meeting.meet_date)),
              h('td', {}, meeting.company_name),
              h('td', {}, h('a', { href: `#/visits/${meeting.visit_id}` }, meeting.visit_code)),
              h('td', {}, meeting.venue || '—')
            )
          ))
        )
      )
    )
  );
}

function filesCard(project, reload) {
  const current = project.attachments.filter((file) => file.is_current);
  const older = project.attachments.filter((file) => !file.is_current);

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Документы и файлы')),
    h('div', { class: 'card-body' },
      current.length === 0 ? h('p', { class: 'muted' }, 'Файлы не приложены.') : null,
      current.map((file) => fileRow(file, {
        canDelete: store.can('attachment.delete'),
        onDelete: async (target) => {
          if (!await confirmDialog({ title: 'Удаление файла', message: `Удалить «${target.orig_name}»?`, confirmLabel: 'Удалить', danger: true })) return;
          await api.delete(`/api/attachments/${target.id}`);
          toastOk('Файл удалён.');
          reload();
        },
      })),
      older.length
        ? h('details', { class: 'mt-1' },
            h('summary', { class: 'small muted' }, `Предыдущие версии файлов (${older.length})`),
            older.map((file) => fileRow(file))
          )
        : null,
      store.can('attachment.upload')
        ? h('div', { class: 'mt-2 no-print' },
            uploadZone({ entityType: 'project', entityId: project.id, onUploaded: reload }))
        : null
    )
  );
}

/** Голосования из конструктора форм (тип поля «poll»). */
function pollsCard(project, reload) {
  const pollFields = store.reference.custom_fields.project.filter((f) => f.is_active && f.type === 'poll');
  if (!pollFields.length) return null;

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Голосования')),
    h('div', { class: 'card-body' },
      pollFields.map((cf) => {
        const poll = project.polls[cf.field_key] || { tally: [], total: 0, my_vote: null };
        const total = poll.total || 0;
        return h('div', { class: 'mb-2' },
          h('h3', {}, cf.label_ru),
          cf.help_text ? h('p', { class: 'small muted' }, cf.help_text) : null,
          cf.options.map((option) => {
            const votes = poll.tally.find((t) => t.option === option)?.n || 0;
            const percent = total ? Math.round((votes / total) * 100) : 0;
            return h('div', { class: 'bar-row', style: { marginBottom: '6px' } },
              h('button', {
                class: `chip ${poll.my_vote === option ? 'active' : ''}`,
                onclick: async () => {
                  try {
                    await api.post(`/api/polls/${cf.id}/vote`, { entity_type: 'project', entity_id: project.id, option });
                    toastOk('Голос учтён.');
                    reload();
                  } catch (error) { toastError(error.message); }
                },
              }, option),
              h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(percent, 2)}%`, background: 'var(--indigo)' } })),
              h('span', { class: 'bar-value' }, `${votes} (${percent}%)`)
            );
          }),
          h('div', { class: 'small muted mt-1' }, `Проголосовало: ${total}`)
        );
      })
    )
  );
}

function statusHistoryCard(project) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'История статусов')),
    h('div', { class: 'card-body' },
      project.status_history.map((entry) =>
        h('div', { class: 'attention-item' },
          h('span', { class: 'marker', style: { background: 'var(--indigo)' } }),
          h('div', { style: { flex: '1', minWidth: '0' } },
            h('div', { class: 'a-title' }, entry.to_status_name || entry.to_status),
            h('div', { class: 'a-meta' }, `${entry.user_name || 'система'} · ${formatDateTime(entry.created_at)}`),
            entry.comment ? h('div', { class: 'small' }, entry.comment) : null
          )
        )
      )
    )
  );
}

function correctionsCard(project, reload) {
  if (!project.corrections.length) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Заявки на исправление')),
    h('div', { class: 'card-body' },
      project.corrections.map((request) =>
        h('div', { class: 'mb-2', style: { paddingBottom: '10px', borderBottom: '1px solid var(--line-soft)' } },
          h('div', { class: 'flex flex-wrap', style: { gap: '8px' } },
            h('span', {
              class: `tag ${request.status === 'pending' ? 'tag-warn' : request.status === 'approved' ? 'tag-ok' : 'tag-danger'}`,
            }, request.status === 'pending' ? 'На рассмотрении' : request.status === 'approved' ? 'Одобрена' : 'Отклонена'),
            h('span', { class: 'small muted' }, `${request.requested_by_name} · ${formatDateTime(request.created_at)}`)
          ),
          h('p', { class: 'small mt-1 mb-0' }, request.reason),
          request.decision_note ? h('p', { class: 'small muted mb-0' }, `Решение: ${request.decision_note}`) : null,
          request.status === 'pending' && store.can('correction.decide')
            ? h('div', { class: 'flex mt-1' },
                h('button', { class: 'btn btn-sm btn-primary', onclick: () => decide(request, 'approved', reload) }, 'Одобрить'),
                h('button', { class: 'btn btn-sm', onclick: () => decide(request, 'rejected', reload) }, 'Отклонить')
              )
            : null
        )
      )
    )
  );
}

async function decide(request, decision, reload) {
  const note = h('textarea', { placeholder: decision === 'approved' ? 'Что было исправлено' : 'Причина отклонения' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, decision === 'approved' ? 'Одобрить' : 'Отклонить');
  const dialog = openModal({
    title: decision === 'approved' ? 'Одобрение заявки' : 'Отклонение заявки',
    size: 'narrow',
    body: h('div', {}, h('p', { class: 'small muted' }, request.reason), field('Комментарий', note)),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });
  saveButton.onclick = async () => {
    try {
      await api.post(`/api/corrections/${request.id}/decide`, { decision, note: note.value.trim() });
      dialog.close();
      toastOk('Решение сохранено.');
      reload();
    } catch (error) { toastError(error.message); }
  };
}

function openStatusDialog(project, reload) {
  const statusSelect = select(store.reference.project_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
    { value: project.status_code });
  const commentInput = h('textarea', { placeholder: 'Основание для смены статуса' });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сменить статус');

  const dialog = openModal({
    title: 'Смена статуса проекта',
    size: 'narrow',
    body: h('div', {},
      errorBox,
      field('Новый статус', statusSelect, { required: true }),
      field('Комментарий', commentInput, { help: 'Сохраняется в истории статусов' })
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      await api.patch(`/api/projects/${project.id}`, {
        status_code: statusSelect.value, status_comment: commentInput.value.trim(),
      });
      dialog.close();
      toastOk('Статус изменён.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

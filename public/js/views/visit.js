// ==========================================================================
//  Карточка визита: делегация, программа встреч по дням, итоги (п. 5 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import { 
  h, frag, field, select, formatDate, statusTag, confirmDialog, toastOk, toastError, openModal,
  initials, relativeTime, renderComment, debounce, DIRECTION_LABELS, daysUntil, plural,
  setChildren, column,
 } from '../ui.js';
import { openVisitForm, openCorrectionForm, uploadZone, fileRow } from './forms.js';

export async function renderVisit({ params, navigate }) {
  const id = Number(params[0]);
  let visit = await api.visit(id);
  const container = h('div', {});
  const reload = async () => { visit = await api.visit(id); draw(); };

  function draw() {
    setChildren(container, 
      printHeader(visit),
      header(visit, reload, navigate),
      h('div', { class: 'split' },
        column(agendaCard(visit, reload), outcomeCard(visit, reload), commentsCard(visit, reload)),
        column(overviewCard(visit), membersCard(visit, reload), filesCard(visit, reload))
      )
    );
  }

  draw();
  return container;
}

function printHeader(visit) {
  return h('div', { class: 'print-header' },
    h('div', { class: 'ministry' }, store.reference.settings.ministry),
    h('div', { class: 'doc-title' }, `Программа визита ${visit.code}`),
    h('div', { class: 'doc-meta' },
      `${DIRECTION_LABELS[visit.direction]} · ${visit.country_name}, ${visit.cities} · ` +
      `${formatDate(visit.date_from, { long: true })} — ${formatDate(visit.date_to, { long: true })}`)
  );
}

function header(visit, reload, navigate) {
  return frag(
    h('div', { class: 'breadcrumbs' }, h('a', { href: '#/visits' }, 'Визиты и встречи'), ' / ', visit.code),
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, `${visit.country_name}, ${visit.cities}`),
        h('div', { class: 'subtitle' },
          `${DIRECTION_LABELS[visit.direction]} · ${formatDate(visit.date_from)} – ${formatDate(visit.date_to)} · ${visit.responsible_name}`),
        h('div', { class: 'pill-row mt-1' },
          statusTag(visit.status_name, visit.status_color),
          h('span', { class: 'tag tag-plain' }, `встреч: ${visit.meetings_total}`),
          visit.meetings_tbc > 0 && h('span', { class: 'tag tag-warn' }, `не согласовано: ${visit.meetings_tbc}`)
        )
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Программа визита (PDF)'),
        store.can('meeting.create') && h('button', { class: 'btn', onclick: () => openMeetingForm({ visit, reload }) }, '+ Встреча'),
        store.can('visit.edit') && h('button', { class: 'btn', onclick: () => openVisitForm({ visit, onSaved: reload }) }, '✎ Изменить'),
        !store.can('visit.edit') && store.can('correction.request') && h('button', {
          class: 'btn',
          onclick: () => openCorrectionForm({ entityType: 'visit', entityId: visit.id, entityLabel: `${visit.code} — ${visit.country_name}`, onSaved: reload }),
        }, '✎ Запросить исправление'),
        store.can('visit.delete') && h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            if (!await confirmDialog({ title: 'Удаление визита', message: `Удалить визит ${visit.code}?`, confirmLabel: 'Удалить', danger: true })) return;
            await api.delete(`/api/visits/${visit.id}`);
            toastOk('Визит перемещён в корзину.');
            navigate('/visits');
          },
        }, 'Удалить')
      )
    )
  );
}

function overviewCard(visit) {
  const untilStart = daysUntil(visit.date_from);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Сведения о визите'), h('span', { class: 'mono muted' }, visit.code)),
    h('div', { class: 'card-body' },
      h('dl', { class: 'def-list' },
        h('div', {}, h('dt', {}, 'Направление'), h('dd', {}, DIRECTION_LABELS[visit.direction])),
        h('div', {}, h('dt', {}, 'Страна'), h('dd', {}, `${visit.country_name} (${visit.region_name})`)),
        h('div', {}, h('dt', {}, 'Города'), h('dd', {}, visit.cities)),
        h('div', {}, h('dt', {}, 'Даты'), h('dd', {}, `${formatDate(visit.date_from)} – ${formatDate(visit.date_to)}`)),
        h('div', {}, h('dt', {}, 'Статус'), h('dd', {}, statusTag(visit.status_name, visit.status_color))),
        h('div', {}, h('dt', {}, 'Ответственный'), h('dd', {}, visit.responsible_name)),
        untilStart > 0
          ? h('div', {}, h('dt', {}, 'До начала'), h('dd', {}, `${untilStart} ${plural(untilStart, 'день', 'дня', 'дней')}`))
          : null
      ),
      h('div', { class: 'form-section-title' }, 'Цель визита'),
      h('p', { class: 'mb-0' }, visit.goal)
    )
  );
}

function membersCard(visit, reload) {
  const canEdit = store.can('visit.edit') || visit.responsible_user_id === store.user.id || visit.created_by === store.user.id;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, `Состав делегации — ${visit.members.length}`),
      canEdit && h('button', { class: 'btn btn-sm no-print', onclick: () => openMemberForm(visit, reload) }, '+ Участник')
    ),
    h('div', { class: 'card-body tight' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'ФИО'), h('th', {}, 'Организация'), h('th', {}, 'Должность'), store.can('visit.edit') ? h('th', { class: 'no-print' }, '') : null)),
          h('tbody', {}, visit.members.map((member) =>
            h('tr', {},
              h('td', { class: 'strong' }, member.full_name),
              h('td', {}, member.organization || '—'),
              h('td', {}, member.position || '—'),
              store.can('visit.edit')
                ? h('td', { class: 'no-print' }, h('button', {
                    class: 'btn btn-sm',
                    onclick: async () => {
                      if (!await confirmDialog({ title: 'Исключение участника', message: `Исключить ${member.full_name} из состава делегации?`, confirmLabel: 'Исключить', danger: true })) return;
                      await api.delete(`/api/visit-members/${member.id}`);
                      reload();
                    },
                  }, '✕'))
                : null
            )
          ))
        )
      )
    )
  );
}

/** Программа встреч по дням — печатается как одностраничный документ (п. 5.2 ТЗ). */
function agendaCard(visit, reload) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Программа встреч'),
      h('span', { class: 'muted small' }, `${visit.meetings.length} встреч`),
      store.can('meeting.create') && h('button', { class: 'btn btn-sm btn-primary no-print', onclick: () => openMeetingForm({ visit, reload }) }, '+ Встреча')
    ),
    h('div', { class: 'card-body' },
      visit.agenda.length === 0
        ? h('p', { class: 'muted mb-0' }, 'Встречи ещё не запланированы.')
        : visit.agenda.map((day) =>
            h('div', { class: 'mb-2' },
              h('div', { class: 'form-section-title' }, formatDate(day.date, { long: true })),
              day.meetings.map((meeting) =>
                h('div', { class: 'step-row' },
                  h('div', { class: 'mono', style: { minWidth: '52px', paddingTop: '2px' } }, meeting.meet_time || '—'),
                  h('div', { class: 'step-main' },
                    h('div', { class: 'step-title' },
                      meeting.company_id
                        ? h('a', { href: `#/companies/${meeting.company_id}` }, meeting.company_name)
                        : meeting.company_name
                    ),
                    h('div', { class: 'step-meta' },
                      meeting.venue ? h('span', {}, meeting.venue) : null,
                      meeting.participants ? h('span', {}, meeting.participants) : null,
                      meeting.project_code ? h('a', { href: `#/projects/${meeting.project_id}` }, `Проект ${meeting.project_code}`) : null
                    ),
                    meeting.notes ? h('div', { class: 'small mt-1' }, meeting.notes) : null
                  ),
                  h('div', { class: 'flex', style: { gap: '5px', alignItems: 'flex-start' } },
                    statusTag(meeting.status_name, meeting.status_color),
                    store.can('meeting.status_change') && h('button', {
                      class: 'btn btn-sm no-print', title: 'Изменить статус или итоги',
                      onclick: () => openMeetingStatus(meeting, visit, reload),
                    }, '⟳'),
                    store.can('meeting.edit') && h('button', {
                      class: 'btn btn-sm no-print', onclick: () => openMeetingForm({ visit, meeting, reload }),
                    }, '✎'),
                    store.can('meeting.delete') && h('button', {
                      class: 'btn btn-sm no-print',
                      onclick: async () => {
                        if (!await confirmDialog({ title: 'Удаление встречи', message: `Удалить встречу с «${meeting.company_name}»?`, confirmLabel: 'Удалить', danger: true })) return;
                        await api.delete(`/api/meetings/${meeting.id}`);
                        reload();
                      },
                    }, '✕')
                  )
                )
              )
            )
          )
    ),
    h('div', { class: 'print-footer' },
      `${store.reference.settings.org_name}. Программа сформирована ${formatDate(new Date().toISOString(), { long: true })}.`)
  );
}

function outcomeCard(visit, reload) {
  const canEdit = store.can('visit.edit') || visit.responsible_user_id === store.user.id;
  const textarea = h('textarea', { placeholder: 'Достигнутые договорённости, подписанные документы, дальнейшие шаги', maxlength: 10000 }, visit.outcome || '');
  const saveButton = h('button', { class: 'btn btn-primary btn-sm no-print', type: 'button' }, 'Сохранить итоги');
  saveButton.onclick = async () => {
    try {
      await api.patch(`/api/visits/${visit.id}`, { outcome: textarea.value.trim() });
      toastOk('Итоги визита сохранены.');
      reload();
    } catch (error) { toastError(error.message); }
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Итоги визита')),
    h('div', { class: 'card-body' },
      canEdit
        ? frag(textarea, h('div', { class: 'mt-1' }, saveButton))
        : h('p', { class: 'mb-0' }, visit.outcome || h('span', { class: 'muted' }, 'Итоги ещё не заполнены.'))
    )
  );
}

function commentsCard(visit, reload) {
  const input = h('textarea', { placeholder: 'Комментарий по подготовке визита', maxlength: 5000 });
  const sendButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Добавить');
  sendButton.onclick = async () => {
    if (!input.value.trim()) return;
    try {
      await api.post(`/api/visits/${visit.id}/comments`, { body: input.value.trim() });
      input.value = '';
      reload();
    } catch (error) { toastError(error.message); }
  };

  return h('div', { class: 'card no-print' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Комментарии')),
    h('div', { class: 'card-body' },
      h('div', { class: 'mb-2' }, input, h('div', { class: 'mt-1' }, sendButton)),
      visit.comments.length === 0 ? h('p', { class: 'muted mb-0' }, 'Комментариев пока нет.') : null,
      visit.comments.map((comment) =>
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

function filesCard(visit, reload) {
  const current = visit.attachments.filter((file) => file.is_current);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Документы визита')),
    h('div', { class: 'card-body' },
      current.length === 0 ? h('p', { class: 'muted' }, 'Программа, приглашения, отчёт и фотографии не приложены.') : null,
      current.map((file) => fileRow(file, {
        canDelete: store.can('attachment.delete'),
        onDelete: async (target) => {
          if (!await confirmDialog({ title: 'Удаление файла', message: `Удалить «${target.orig_name}»?`, confirmLabel: 'Удалить', danger: true })) return;
          await api.delete(`/api/attachments/${target.id}`);
          reload();
        },
      })),
      store.can('attachment.upload')
        ? h('div', { class: 'mt-2 no-print' }, uploadZone({ entityType: 'visit', entityId: visit.id, onUploaded: reload }))
        : null
    )
  );
}

// --------------------------------------------------------------------------
//  Формы встреч и участников
// --------------------------------------------------------------------------
function openMeetingForm({ visit, meeting = null, reload }) {
  const companyInput = h('input', { type: 'text', value: meeting?.company_name || '', placeholder: 'Название организации' });
  const companyResults = h('div', { class: 'search-results hidden', style: { position: 'static', maxHeight: '180px', marginTop: '6px' } });
  let companyId = meeting?.company_id || null;

  companyInput.addEventListener('input', debounce(async () => {
    const term = companyInput.value.trim();
    companyId = null;
    if (term.length < 2) { companyResults.classList.add('hidden'); return; }
    const data = await api.companies({ search: term, limit: 6 });
    setChildren(companyResults, 
      data.rows.length
        ? data.rows.map((row) => h('a', {
            href: '#', onclick: (event) => {
              event.preventDefault();
              companyId = row.id;
              companyInput.value = row.name;
              companyResults.classList.add('hidden');
            },
          }, h('div', { class: 'r-title' }, row.name), h('div', { class: 'r-meta' }, row.country_name || '')))
        : h('div', { class: 'empty', style: { padding: '12px' } }, 'Не найдено — встреча будет записана по названию')
    );
    companyResults.classList.remove('hidden');
  }, 260));

  const dateInput = h('input', { type: 'date', value: meeting?.meet_date || visit.date_from, min: visit.date_from, max: visit.date_to });
  const timeInput = h('input', { type: 'time', value: meeting?.meet_time || '' });
  const venueInput = h('input', { type: 'text', value: meeting?.venue || '', maxlength: 300, placeholder: 'Адрес или площадка' });
  const statusSelect = select(store.reference.meeting_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
    { value: meeting?.status_code || 'tbc' });
  const participantsInput = h('input', { type: 'text', value: meeting?.participants || '', maxlength: 1000, placeholder: 'Кто участвует с обеих сторон' });
  const notesInput = h('textarea', { maxlength: 5000, placeholder: 'Повестка, договорённости, итоги' }, meeting?.notes || '');
  const projectSelect = h('select', {});
  projectSelect.append(h('option', { value: '' }, '— не связана с проектом —'));

  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, meeting ? 'Сохранить' : 'Добавить встречу');

  api.projects({ limit: 200 }).then((data) => {
    for (const project of data.rows) {
      projectSelect.append(h('option', {
        value: project.id, selected: meeting?.project_id === project.id,
      }, `${project.code} — ${project.title}`));
    }
  }).catch(() => {});

  const dialog = openModal({
    title: meeting ? 'Изменение встречи' : `Новая встреча в рамках визита ${visit.code}`,
    body: h('div', {},
      errorBox,
      field('Компания / организация', h('div', {}, companyInput, companyResults), { required: true }),
      h('div', { class: 'form-row' },
        field('Дата', dateInput, { required: true }),
        field('Время', timeInput),
        field('Статус', statusSelect, { required: true })
      ),
      field('Место проведения', venueInput),
      field('Участники', participantsInput),
      field('Связанный проект', projectSelect, { help: 'История проекта будет включать эту встречу' }),
      field('Повестка и итоги', notesInput)
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        company_id: companyId,
        company_name: companyInput.value.trim(),
        meet_date: dateInput.value,
        meet_time: timeInput.value,
        venue: venueInput.value.trim(),
        status_code: statusSelect.value,
        participants: participantsInput.value.trim(),
        notes: notesInput.value.trim(),
        project_id: projectSelect.value || null,
      };
      if (meeting) await api.patch(`/api/meetings/${meeting.id}`, payload);
      else await api.post(`/api/visits/${visit.id}/meetings`, payload);
      dialog.close();
      toastOk(meeting ? 'Встреча изменена.' : 'Встреча добавлена в программу.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

function openMeetingStatus(meeting, visit, reload) {
  const statusSelect = select(store.reference.meeting_statuses.map((s) => ({ value: s.code, label: s.name_ru })),
    { value: meeting.status_code });
  const notesInput = h('textarea', { placeholder: 'Итоги встречи' }, meeting.notes || '');
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить');

  const dialog = openModal({
    title: `Встреча: ${meeting.company_name}`,
    size: 'narrow',
    body: h('div', {}, errorBox, field('Статус встречи', statusSelect, { required: true }), field('Итоги', notesInput)),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    try {
      await api.patch(`/api/meetings/${meeting.id}`, { status_code: statusSelect.value, notes: notesInput.value.trim() });
      dialog.close();
      toastOk('Статус встречи обновлён.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };
}

function openMemberForm(visit, reload) {
  const userSelect = select(
    [{ value: '', label: '— внешний участник —' }, ...store.reference.users.map((u) => ({ value: u.id, label: u.full_name }))], {});
  const nameInput = h('input', { type: 'text', placeholder: 'ФИО участника' });
  const organizationInput = h('input', { type: 'text', placeholder: 'Организация' });
  const positionInput = h('input', { type: 'text', placeholder: 'Должность' });
  userSelect.addEventListener('change', () => { nameInput.disabled = Boolean(userSelect.value); });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Добавить');

  const dialog = openModal({
    title: 'Участник делегации',
    size: 'narrow',
    body: h('div', {}, errorBox,
      field('Сотрудник офиса', userSelect),
      field('ФИО (для внешнего участника)', nameInput),
      field('Организация', organizationInput),
      field('Должность', positionInput)
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    try {
      await api.post(`/api/visits/${visit.id}/members`, {
        user_id: userSelect.value || null,
        full_name: nameInput.value.trim(),
        organization: organizationInput.value.trim(),
        position: positionInput.value.trim(),
      });
      dialog.close();
      toastOk('Участник добавлен.');
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };
}

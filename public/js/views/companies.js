// ==========================================================================
//  Модуль «Компании и партнёры» (раздел 4 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatDate, formatDateTime, formatMoney, formatNumber, statusTag,
  empty, debounce, confirmDialog, toastOk, toastError, openModal, relativeTime, initials, renderComment, setChildren, column,
} from '../ui.js';
import { openCompanyForm, uploadZone, fileRow, openCorrectionForm } from './forms.js';

/** Метка роли компании: вычисляется по фактическим связям с проектами. */
function roleTag(role) {
  if (role === 'both') return h('span', { class: 'tag tag-indigo' }, 'Обе роли');
  if (role === 'local') return h('span', { class: 'tag tag-ok' }, 'Местный партнёр');
  return h('span', { class: 'tag' }, 'Иностранный партнёр');
}

export async function renderCompanies({ query, navigate }) {
  const data = await api.companies({ ...query, limit: 50 });

  const searchInput = h('input', { type: 'search', value: query.search || '', placeholder: 'Название, отрасль, город, контактное лицо…' });
  searchInput.addEventListener('input', debounce(() => navigate('/companies', { ...query, search: searchInput.value, offset: 0 }), 400));

  const chips = h('div', { class: 'filter-chips' },
    h('button', {
      class: `chip ${query.local === '1' ? 'active' : ''}`,
      title: 'Организации со страной «Узбекистан» — потенциальные местные партнёры',
      onclick: () => navigate('/companies', { ...query, local: query.local === '1' ? '' : '1', offset: 0 }),
    }, 'Местные партнёры'),
    h('button', {
      class: `chip ${query.role === 'partner' ? 'active' : ''}`,
      title: 'Компании, уже указанные местным партнёром хотя бы в одном проекте',
      onclick: () => navigate('/companies', { ...query, role: query.role === 'partner' ? '' : 'partner', offset: 0 }),
    }, 'Участвуют как местный партнёр'),
    Object.keys(query).length ? h('button', { class: 'chip', onclick: () => navigate('/companies') }, '✕ Сбросить') : null);

  const filters = h('div', { class: 'filters' },
    field('Поиск', searchInput),
    field('Регион', select(store.reference.regions.map((r) => ({ value: r.code, label: r.name_ru })),
      { value: query.region || '', placeholder: 'Все регионы', onchange: (e) => navigate('/companies', { ...query, region: e.target.value, offset: 0 }) })),
    field('Страна', select(store.reference.countries.map((c) => ({ value: c.id, label: c.name_ru })),
      { value: query.country_id || '', placeholder: 'Все страны', onchange: (e) => navigate('/companies', { ...query, country_id: e.target.value, offset: 0 }) })),
    field('Ответственный', select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
      { value: query.responsible_id || '', placeholder: 'Все сотрудники', onchange: (e) => navigate('/companies', { ...query, responsible_id: e.target.value, offset: 0 }) }))
  );

  const table = data.rows.length
    ? h('div', { class: 'table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Компания'), h('th', {}, 'Роль'), h('th', {}, 'Страна и город'), h('th', {}, 'Отрасль'),
            h('th', { class: 'num' }, 'Проектов'), h('th', { class: 'num' }, 'Сумма (USD)'),
            h('th', { class: 'num' }, 'Встреч'), h('th', {}, 'Ответственный')
          )),
          h('tbody', {}, data.rows.map((company) =>
            h('tr', {},
              h('td', {},
                h('a', { href: `#/companies/${company.id}`, class: 't-main' }, company.name),
                company.website ? h('div', { class: 't-sub' }, company.website.replace(/^https?:\/\//, '')) : null
              ),
              h('td', {}, roleTag(company.role)),
              h('td', {}, company.country_name || '—', h('div', { class: 't-sub' }, company.city || '')),
              h('td', {}, company.industry || '—'),
              h('td', { class: 'num' }, formatNumber(company.projects_count)),
              h('td', { class: 'num' }, company.amount_usd ? formatMoney(company.amount_usd, 'USD', { compact: true }) : '—'),
              h('td', { class: 'num' }, formatNumber(company.meetings_count)),
              h('td', {}, company.responsible_name || '—')
            )
          ))
        )
      )
    : empty('Компаний не найдено', 'Измените условия поиска или добавьте нового партнёра.', '🏢');

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Компании и партнёры'),
        h('div', { class: 'subtitle' }, 'Справочник иностранных компаний и организаций-партнёров')
      ),
      h('div', { class: 'page-actions' },
        store.can('report.export') && h('button', {
          class: 'btn', onclick: () => api.download('/api/export/companies', query, 'companies.xlsx'),
        }, '⇩ Excel'),
        store.can('company.create') && h('button', {
          class: 'btn btn-primary',
          onclick: () => openCompanyForm({ onSaved: (saved) => navigate(`/companies/${saved.id}`) }),
        }, '+ Новая компания')
      )
    ),
    chips,
    filters,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Всего компаний: ${formatNumber(data.total)}`)),
      h('div', { class: 'card-body tight' }, table)
    )
  );
}

// --------------------------------------------------------------------------
//  Карточка компании: все проекты, встречи и суммы (требование раздела 4 ТЗ)
// --------------------------------------------------------------------------
export async function renderCompany({ params, navigate }) {
  const id = Number(params[0]);
  let company = await api.company(id);
  const container = h('div', {});

  const reload = async () => { company = await api.company(id); draw(); };

  function draw() {
    const totals = Object.entries(company.totals);
    setChildren(container, 
      h('div', { class: 'print-header' },
        h('div', { class: 'ministry' }, store.reference.settings.ministry),
        h('div', { class: 'doc-title' }, `Карточка компании: ${company.name}`),
        h('div', { class: 'doc-meta' }, `Сформировано ${formatDate(new Date().toISOString(), { long: true })}`)
      ),
      h('div', { class: 'breadcrumbs' }, h('a', { href: '#/companies' }, 'Компании и партнёры'), ' / ', company.name),
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, company.name),
          h('div', { class: 'subtitle' },
            company.role !== 'foreign' ? roleTag(company.role) : null,
            company.role !== 'foreign' ? ' · ' : '',
            `${company.country_name || '—'}${company.city ? `, ${company.city}` : ''}`,
            company.industry ? ` · ${company.industry}` : '',
            company.region_name ? ` · ${company.region_name}` : ''
          )
        ),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Печать / PDF'),
          store.can('company.merge') && h('button', { class: 'btn', onclick: () => openMergeDialog(company, navigate) }, '⇄ Объединить дубликат'),
          store.can('company.edit') && h('button', { class: 'btn', onclick: () => openCompanyForm({ company, onSaved: reload }) }, '✎ Изменить'),
          !store.can('company.edit') && store.can('correction.request') && h('button', {
            class: 'btn',
            onclick: () => openCorrectionForm({ entityType: 'company', entityId: company.id, entityLabel: company.name, onSaved: reload }),
          }, '✎ Запросить исправление'),
          store.can('company.delete') && h('button', {
            class: 'btn btn-danger',
            onclick: async () => {
              if (!await confirmDialog({ title: 'Удаление компании', message: `Удалить компанию «${company.name}»?`, confirmLabel: 'Удалить', danger: true })) return;
              try {
                await api.delete(`/api/companies/${company.id}`);
                toastOk('Компания перемещена в корзину.');
                navigate('/companies');
              } catch (error) { toastError(error.message); }
            },
          }, 'Удалить')
        )
      ),
      h('div', { class: 'grid grid-4 mb-2' },
        kpi('Проектов и соглашений', formatNumber(company.projects.length)),
        kpi('Встреч проведено и запланировано', formatNumber(company.meetings.length)),
        kpi('Контактных лиц', formatNumber(company.contacts.length)),
        kpi('Суммы соглашений', totals.length
          ? totals.map(([currency, amount]) => formatMoney(amount, currency, { compact: true })).join(' · ')
          : '—')
      ),
      h('div', { class: 'split' },
        column(projectsCard(company), partnerProjectsCard(company), meetingsCard(company), commentsCard(company, reload)),
        column(profileCard(company), contactsCard(company), filesCard(company, reload))
      )
    );
  }

  draw();
  return container;
}

const kpi = (label, value) => h('div', { class: 'kpi' },
  h('div', { class: 'label' }, label),
  h('div', { class: `value ${String(value).length > 12 ? 'sm' : ''}` }, value)
);

function profileCard(company) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Профиль компании')),
    h('div', { class: 'card-body' },
      h('dl', { class: 'def-list' },
        h('div', {}, h('dt', {}, 'Страна'), h('dd', {}, company.country_name || '—')),
        h('div', {}, h('dt', {}, 'Город'), h('dd', {}, company.city || '—')),
        h('div', {}, h('dt', {}, 'Отрасль'), h('dd', {}, company.industry || '—')),
        h('div', {}, h('dt', {}, 'Сайт'), h('dd', {},
          company.website ? h('a', { href: company.website, target: '_blank', rel: 'noopener' }, company.website.replace(/^https?:\/\//, '')) : '—')),
        h('div', {}, h('dt', {}, 'Ответственный'), h('dd', {}, company.responsible_name || '—')),
        h('div', {}, h('dt', {}, 'Добавлена'), h('dd', {}, formatDateTime(company.created_at)))
      ),
      company.profile ? h('p', { class: 'mt-2 mb-0' }, company.profile) : null
    )
  );
}

function contactsCard(company) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Контактные лица')),
    h('div', { class: 'card-body' },
      company.contacts.length === 0 ? h('p', { class: 'muted mb-0' }, 'Контактные лица не указаны.') : null,
      company.contacts.map((contact) =>
        h('div', { class: 'feed-item' },
          h('span', { class: 'avatar' }, initials(contact.full_name)),
          h('div', { class: 'feed-body' },
            h('div', { class: 'feed-author' }, contact.full_name),
            h('div', { class: 'small muted' }, contact.position || '—'),
            h('div', { class: 'small' },
              contact.phone ? h('a', { href: `tel:${contact.phone}` }, contact.phone) : null,
              contact.phone && contact.email ? ' · ' : null,
              contact.email ? h('a', { href: `mailto:${contact.email}` }, contact.email) : null
            )
          )
        )
      )
    )
  );
}

function projectsCard(company) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `Проекты и соглашения — ${company.projects.length}`)),
    company.projects.length
      ? h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Код'), h('th', {}, 'Название'), h('th', {}, 'Статус'),
                h('th', { class: 'num' }, 'Сумма'), h('th', {}, 'Ответственный')
              )),
              h('tbody', {}, company.projects.map((project) =>
                h('tr', {},
                  h('td', { class: 'code' }, project.code),
                  h('td', {}, h('a', { href: `#/projects/${project.id}` }, project.title)),
                  h('td', {}, statusTag(project.status_name, project.status_color)),
                  h('td', { class: 'num' }, formatMoney(project.amount, project.currency, { compact: true })),
                  h('td', {}, project.responsible_name || '—')
                )
              ))
            )
          )
        )
      : h('div', { class: 'card-body' }, h('p', { class: 'muted mb-0' }, 'Проектов с этой компанией пока нет.'))
  );
}

/** Проекты, где компания выступает узбекской стороной (дополнение № 1 к ТЗ). */
function partnerProjectsCard(company) {
  const rows = company.partner_projects || [];
  if (!rows.length) return null;

  const totals = Object.entries(company.partner_totals || {});
  const totalsLabel = totals.map(([currency, sum]) => formatMoney(sum, currency, { compact: true })).join(' · ');

  const row = (project) => h('tr', {},
    h('td', { class: 'code' }, project.code),
    h('td', {}, h('a', { href: `#/projects/${project.id}` }, project.title)),
    h('td', {}, project.role_note || h('span', { class: 'muted' }, '—')),
    h('td', {}, statusTag(project.status_name, project.status_color)),
    h('td', { class: 'num' }, formatMoney(project.amount, project.currency, { compact: true })));

  const table = h('div', { class: 'table-wrap' },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Код'), h('th', {}, 'Название'), h('th', {}, 'Роль в проекте'),
        h('th', {}, 'Статус'), h('th', { class: 'num' }, 'Сумма'))),
      h('tbody', {}, rows.map(row))));

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, `Проекты, где компания — местный партнёр — ${rows.length}`),
      totalsLabel ? h('span', { class: 'muted small' }, totalsLabel) : null),
    h('div', { class: 'card-body tight' }, table));
}

function meetingsCard(company) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `Встречи — ${company.meetings.length}`)),
    company.meetings.length
      ? h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Визит'), h('th', {}, 'Место'), h('th', {}, 'Статус'))),
              h('tbody', {}, company.meetings.map((meeting) =>
                h('tr', {},
                  h('td', { class: 'nowrap' }, formatDate(meeting.meet_date), meeting.meet_time ? h('div', { class: 't-sub' }, meeting.meet_time) : null),
                  h('td', {}, h('a', { href: `#/visits/${meeting.visit_id}` }, meeting.visit_code),
                    h('div', { class: 't-sub' }, meeting.direction === 'outbound' ? 'выездной визит' : 'приём делегации')),
                  h('td', {}, meeting.venue || '—'),
                  h('td', {}, statusTag(meeting.status_name, meeting.status_color))
                )
              ))
            )
          )
        )
      : h('div', { class: 'card-body' }, h('p', { class: 'muted mb-0' }, 'Встреч с этой компанией не зафиксировано.'))
  );
}

function commentsCard(company, reload) {
  const input = h('textarea', { placeholder: 'Комментарий по работе с компанией', maxlength: 5000 });
  const sendButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Добавить');
  sendButton.onclick = async () => {
    if (!input.value.trim()) return;
    try {
      await api.post(`/api/companies/${company.id}/comments`, { body: input.value.trim() });
      input.value = '';
      reload();
    } catch (error) { toastError(error.message); }
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Комментарии')),
    h('div', { class: 'card-body' },
      h('div', { class: 'mb-2 no-print' }, input, h('div', { class: 'mt-1' }, sendButton)),
      company.comments.length === 0 ? h('p', { class: 'muted mb-0' }, 'Комментариев пока нет.') : null,
      company.comments.map((comment) =>
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

function filesCard(company, reload) {
  const current = company.attachments.filter((file) => file.is_current);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Документы')),
    h('div', { class: 'card-body' },
      current.length === 0 ? h('p', { class: 'muted' }, 'Файлы не приложены.') : null,
      current.map((file) => fileRow(file, {
        canDelete: store.can('attachment.delete'),
        onDelete: async (target) => {
          if (!await confirmDialog({ title: 'Удаление файла', message: `Удалить «${target.orig_name}»?`, confirmLabel: 'Удалить', danger: true })) return;
          await api.delete(`/api/attachments/${target.id}`);
          reload();
        },
      })),
      store.can('attachment.upload')
        ? h('div', { class: 'mt-2 no-print' }, uploadZone({ entityType: 'company', entityId: company.id, onUploaded: reload }))
        : null
    )
  );
}

/** Объединение дубликатов — доступно администратору. */
function openMergeDialog(target, navigate) {
  const searchInput = h('input', { type: 'search', placeholder: 'Найдите компанию-дубликат' });
  const results = h('div', { class: 'search-results', style: { position: 'static', maxHeight: '260px' } });
  let selected = null;
  const mergeButton = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Объединить');

  searchInput.addEventListener('input', debounce(async () => {
    const term = searchInput.value.trim();
    if (term.length < 2) { setChildren(results, ); return; }
    const data = await api.companies({ search: term, limit: 10 });
    setChildren(results, 
      data.rows.filter((row) => row.id !== target.id).map((row) =>
        h('a', {
          href: '#', onclick: (event) => {
            event.preventDefault();
            selected = row;
            mergeButton.disabled = false;
            searchInput.value = row.name;
            setChildren(results, h('div', { class: 'callout ok' }, `Будет объединена: «${row.name}» → «${target.name}»`));
          },
        }, h('div', { class: 'r-title' }, row.name), h('div', { class: 'r-meta' }, `проектов: ${row.projects_count}`))
      )
    );
  }, 300));

  const dialog = openModal({
    title: 'Объединение дубликатов компаний',
    body: h('div', {},
      h('div', { class: 'callout' },
        `Все проекты, встречи, контакты и файлы выбранной компании будут перенесены в «${target.name}». ` +
        'Компания-дубликат перемещается в корзину. Действие фиксируется в журнале аудита.'),
      field('Компания-дубликат', searchInput, { required: true }),
      results
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), mergeButton),
  });

  mergeButton.onclick = async () => {
    try {
      await api.post(`/api/companies/${target.id}/merge`, { source_id: selected.id });
      dialog.close();
      toastOk('Компании объединены.');
      navigate(`/companies/${target.id}`);
      location.reload();
    } catch (error) { toastError(error.message); }
  };
}

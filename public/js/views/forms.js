// ==========================================================================
//  Формы создания и изменения записей, включая произвольные поля
//  из конструктора форм (раздел 9 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, field, select, openModal, frag, toastOk, toastError, debounce, formatSize, AREA_LABELS, setChildren,
} from '../ui.js';

/** Поля из конструктора форм для указанной формы. */
export function customFieldsBlock(form, values = {}, { disabled = false } = {}) {
  const fields = (store.reference.custom_fields?.[form] || []).filter((f) => f.is_active);
  if (!fields.length) return { node: null, read: () => ({}) };

  const controls = new Map();
  const container = h('div', {},
    h('div', { class: 'form-section-title' }, 'Дополнительные поля'),
    fields.map((cf) => {
      const readOnly = disabled || (!cf.team_can_fill && !store.isAdmin);
      const value = values[cf.field_key];
      let control;

      switch (cf.type) {
        case 'textarea':
          control = h('textarea', { name: cf.field_key, disabled: readOnly }, value || '');
          break;
        case 'number':
        case 'money':
          control = h('input', { type: 'number', step: cf.type === 'money' ? '0.01' : '1', name: cf.field_key, value: value ?? '', disabled: readOnly });
          break;
        case 'date':
          control = h('input', { type: 'date', name: cf.field_key, value: value || '', disabled: readOnly });
          break;
        case 'url':
          control = h('input', { type: 'url', name: cf.field_key, value: value || '', placeholder: 'https://', disabled: readOnly });
          break;
        case 'checkbox':
          control = h('label', { class: 'checkbox' },
            h('input', { type: 'checkbox', name: cf.field_key, checked: Boolean(value), disabled: readOnly }),
            h('span', {}, cf.help_text || 'Да')
          );
          break;
        case 'select':
          control = select(cf.options.map((o) => ({ value: o, label: o })), { value: value || '', placeholder: '— не выбрано —', name: cf.field_key });
          control.disabled = readOnly;
          break;
        case 'multiselect':
          control = h('div', {}, cf.options.map((option) =>
            h('label', { class: 'checkbox' },
              h('input', { type: 'checkbox', value: option, checked: Array.isArray(value) && value.includes(option), disabled: readOnly }),
              h('span', {}, option)
            )
          ));
          break;
        case 'user':
          control = select(store.staff.map((u) => ({ value: u.id, label: u.full_name })), { value: value || '', placeholder: '— не выбрано —', name: cf.field_key });
          control.disabled = readOnly;
          break;
        case 'poll':
          return null; // голосование доступно в карточке записи
        case 'file':
          return null; // файлы прикрепляются в карточке записи
        default:
          control = h('input', { type: 'text', name: cf.field_key, value: value || '', disabled: readOnly });
      }

      controls.set(cf.field_key, { cf, control });
      return cf.type === 'checkbox'
        ? h('div', { class: 'field' }, h('label', {}, cf.label_ru), control)
        : field(cf.label_ru, control, { required: cf.required, help: cf.help_text });
    })
  );

  const read = () => {
    const result = {};
    for (const [key, { cf, control }] of controls) {
      if (cf.type === 'checkbox') result[key] = control.querySelector('input').checked;
      else if (cf.type === 'multiselect') {
        result[key] = [...control.querySelectorAll('input:checked')].map((input) => input.value);
      } else {
        result[key] = control.value;
      }
    }
    return result;
  };

  return { node: container, read };
}

/** Динамический список контактных лиц. */
export function contactsEditor(initial = []) {
  const rows = h('div', {});
  const addRow = (data = {}) => {
    const row = h('div', { class: 'form-row', style: { marginBottom: '10px', alignItems: 'end' } },
      h('input', { type: 'text', name: 'full_name', placeholder: 'ФИО контактного лица *', value: data.full_name || '' }),
      h('input', { type: 'text', name: 'position', placeholder: 'Должность', value: data.position || '' }),
      h('input', { type: 'text', name: 'phone', placeholder: 'Телефон', value: data.phone || '' }),
      h('input', { type: 'email', name: 'email', placeholder: 'Электронная почта', value: data.email || '' }),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Удалить строку', onclick: () => row.remove() }, '✕')
    );
    rows.append(row);
  };
  (initial.length ? initial : [{}]).forEach(addRow);

  const node = h('div', {},
    h('div', { class: 'form-section-title' }, 'Контактные лица иностранного партнёра'),
    rows,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addRow() }, '+ Добавить контакт')
  );

  const read = () => [...rows.children].map((row) => ({
    full_name: row.querySelector('[name=full_name]').value.trim(),
    position: row.querySelector('[name=position]').value.trim(),
    phone: row.querySelector('[name=phone]').value.trim(),
    email: row.querySelector('[name=email]').value.trim(),
  })).filter((contact) => contact.full_name);

  return { node, read };
}

/** Редактор дорожной карты при создании проекта. */
export function stepsEditor() {
  const rows = h('div', {});
  const addRow = () => {
    const row = h('div', { class: 'form-row', style: { marginBottom: '10px', alignItems: 'end' } },
      h('input', { type: 'text', name: 'title', placeholder: 'Что нужно сделать *' }),
      h('input', { type: 'date', name: 'due_date', title: 'Срок' }),
      select(store.staff.map((u) => ({ value: u.id, label: u.full_name })), { value: store.user.id, name: 'responsible_user_id' }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => row.remove() }, '✕')
    );
    rows.append(row);
  };
  addRow();

  const node = h('div', {},
    h('div', { class: 'form-section-title' }, 'Дорожная карта (можно добавить позже)'),
    rows,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: addRow }, '+ Добавить этап')
  );

  const read = () => [...rows.children].map((row) => ({
    title: row.querySelector('[name=title]').value.trim(),
    due_date: row.querySelector('[name=due_date]').value,
    responsible_user_id: row.querySelector('[name=responsible_user_id]').value,
  })).filter((step) => step.title);

  return { node, read };
}


/**
 * Список местных партнёров (P-16, дополнение № 1 к ТЗ).
 * Партнёров может быть несколько; у каждого — необязательная роль в проекте.
 */
export function partnersEditor(initial = []) {
  const rows = h('div', {});

  const addRow = (data = {}) => {
    const companySelect = select(
      store.reference.companies_brief.map((c) => ({ value: c.id, label: c.uz ? `${c.name} — Узбекистан` : `${c.name} (${c.country_name || 'зарубежная'})` })),
      { value: data.company_id || '', placeholder: '— выберите организацию —', name: 'company_id' }
    );
    const note = h('input', { type: 'text', name: 'role_note', maxlength: 200,
      placeholder: 'Роль в проекте: учредитель СП, площадка…', value: data.role_note || '' });
    const row = h('div', { class: 'form-row', style: { marginBottom: '10px', alignItems: 'end' } },
      companySelect, note,
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Убрать партнёра', onclick: () => row.remove() }, '✕'));
    rows.append(row);
  };
  (initial.length ? initial : []).forEach(addRow);

  const node = h('div', {},
    h('div', { class: 'form-section-title' }, 'Местные партнёры (Узбекистан)'),
    h('p', { class: 'help', style: { marginTop: '-4px', marginBottom: '10px' } },
      'Узбекская сторона проекта. Партнёров может быть несколько; поле необязательное.'),
    rows,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addRow() }, '+ Добавить партнёра'));

  const read = () => [...rows.children].map((row) => ({
    company_id: row.querySelector('[name=company_id]').value,
    role_note: row.querySelector('[name=role_note]').value.trim(),
  })).filter((x) => x.company_id);

  return { node, read };
}

/**
 * Регионы реализации (P-17). Регион выбирается из закрытого списка,
 * населённый пункт обязателен, объём в регионе — необязателен.
 */
export function locationsEditor(initial = [], { visible = true } = {}) {
  const rows = h('div', {});

  const addRow = (data = {}) => {
    const regionSelect = select(
      store.reference.uz_regions.map((r) => ({ value: r.id, label: r.name_ru })),
      { value: data.uz_region_id || '', placeholder: '— выберите регион —', name: 'uz_region_id' }
    );
    const locality = h('input', { type: 'text', name: 'locality', maxlength: 200,
      placeholder: 'Город или район *', value: data.locality || '' });
    const amount = h('input', { type: 'number', name: 'amount', min: '0', step: '1000',
      placeholder: 'Объём в регионе', value: data.amount ?? '' });
    const row = h('div', { class: 'form-row', style: { marginBottom: '10px', alignItems: 'end' } },
      regionSelect, locality, amount,
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Убрать регион', onclick: () => row.remove() }, '✕'));
    rows.append(row);
  };
  initial.forEach(addRow);

  const node = h('div', { class: visible ? '' : 'hidden' },
    h('div', { class: 'form-section-title' }, 'Регионы реализации в Узбекистане'),
    h('p', { class: 'help', style: { marginTop: '-4px', marginBottom: '10px' } },
      'Для каждого выбранного региона укажите город или район. Объём в регионе заполняется, ' +
      'если инвестиции распределены между площадками, — иначе сумма проекта попадёт в строку «Не распределено».'),
    rows,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addRow() }, '+ Добавить регион'));

  const read = () => [...rows.children].map((row) => ({
    uz_region_id: row.querySelector('[name=uz_region_id]').value,
    locality: row.querySelector('[name=locality]').value.trim(),
    amount: row.querySelector('[name=amount]').value,
  })).filter((x) => x.uz_region_id);

  return { node, read, setVisible: (on) => node.classList.toggle('hidden', !on) };
}

// --------------------------------------------------------------------------
//  Проект / соглашение
// --------------------------------------------------------------------------
export function openProjectForm({ project = null, onSaved }) {
  const isEdit = Boolean(project);
  const ref = store.reference;

  const controls = {
    record_type: select(ref.record_types.map(dictOption), { value: project?.record_type || 'project', name: 'record_type' }),
    sector_code: select(ref.sectors.map(dictOption), { value: project?.sector_code || 'textile', name: 'sector_code' }),
    area: select([{ value: 'export', label: AREA_LABELS.export }, { value: 'investment', label: AREA_LABELS.investment }],
      { value: project?.area || 'export', name: 'area' }),
    country_id: select(ref.countries.map((c) => ({ value: c.id, label: `${c.name_ru} — ${c.region_name}` })),
      { value: project?.country_id || '', placeholder: '— выберите страну —', name: 'country_id' }),
    title: h('input', { type: 'text', name: 'title', value: project?.title || '', maxlength: 300, placeholder: 'Краткое название проекта или соглашения' }),
    description: h('textarea', { name: 'description', maxlength: 10000 }, project?.description || ''),
    amount: h('input', { type: 'number', step: '0.01', min: '0', name: 'amount', value: project?.amount ?? '', placeholder: 'например, 1250000' }),
    currency: select(ref.currencies.map(dictOption), { value: project?.currency || 'USD', name: 'currency' }),
    responsible_user_id: select(store.staff.map((u) => ({ value: u.id, label: `${u.full_name}${u.region_name ? ` — ${u.region_name}` : ''}` })),
      { value: project?.responsible_user_id || store.user.id, name: 'responsible_user_id' }),
    status_code: select(ref.project_statuses.map(dictOption), { value: project?.status_code || 'negotiation', name: 'status_code' }),
  };

  const companyPicker = buildCompanyPicker(project?.company_id, project?.company_name);
  const partners = partnersEditor(project?.partners || []);
  const locationsAllowed = (area) => area === 'investment' || store.reference.settings.locations_for_export;
  const locations = locationsEditor(project?.locations || [], { visible: locationsAllowed(controls.area.value) });
  controls.area.addEventListener('change', () => locations.setVisible(locationsAllowed(controls.area.value)));
  const contacts = isEdit ? null : contactsEditor();
  const steps = isEdit ? null : stepsEditor();
  const custom = customFieldsBlock('project', project?.custom_values || {});
  const errorBox = h('div', { class: 'callout danger hidden' });

  const body = h('form', { id: 'project-form', onsubmit: (e) => e.preventDefault() },
    errorBox,
    h('div', { class: 'form-section-title' }, 'Основные сведения'),
    field('Название / краткое описание', controls.title, { required: true }),
    h('div', { class: 'form-row' },
      field('Тип записи', controls.record_type, { required: true }),
      field('Отрасль', controls.sector_code, { required: true }),
      field('Направление', controls.area, { required: true })
    ),
    h('div', { class: 'form-row' },
      field('Страна', controls.country_id, { required: true, help: 'Регион определяется автоматически по стране' }),
      field('Ответственный', controls.responsible_user_id, { required: true }),
      field('Статус', controls.status_code, { required: true })
    ),
    field('Иностранный партнёр', companyPicker.node, { required: true }),
    partners.node,
    h('div', { class: 'form-row' },
      field('Сумма', controls.amount),
      field('Валюта', controls.currency)
    ),
    field('Описание', controls.description),
    locations.node,
    contacts?.node,
    steps?.node,
    custom.node
  );

  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить изменения' : 'Создать запись');

  const dialog = openModal({
    title: isEdit ? `Изменение записи ${project.code}` : 'Новый проект или соглашение',
    size: 'wide',
    body,
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        record_type: controls.record_type.value,
        sector_code: controls.sector_code.value,
        area: controls.area.value,
        country_id: controls.country_id.value,
        company_id: await companyPicker.resolve(),
        title: controls.title.value.trim(),
        description: controls.description.value.trim(),
        amount: controls.amount.value,
        currency: controls.currency.value,
        responsible_user_id: controls.responsible_user_id.value,
        status_code: controls.status_code.value,
        partners: partners.read(),
        locations: locationsAllowed(controls.area.value) ? locations.read() : [],
        custom_values: custom.read(),
      };
      if (!isEdit) {
        payload.contacts = contacts.read();
        payload.steps = steps.read();
      }
      const saved = isEdit
        ? await api.patch(`/api/projects/${project.id}`, payload)
        : await api.post('/api/projects', payload);
      dialog.close();
      toastOk(isEdit ? 'Изменения сохранены.' : `Создана запись ${saved.code}.`);
      onSaved?.(saved);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
      errorBox.scrollIntoView({ block: 'nearest' });
    } finally {
      saveButton.disabled = false;
    }
  };
}

const dictOption = (item) => ({ value: item.code, label: item.name_ru });

/**
 * Выбор компании из справочника с возможностью создать новую прямо в форме
 * и подсказкой о возможных дубликатах (раздел 4 ТЗ).
 */
function buildCompanyPicker(selectedId = '', selectedName = '') {
  const input = h('input', { type: 'text', placeholder: 'Начните вводить название компании…', value: selectedName || '', autocomplete: 'off' });
  const list = h('div', { class: 'search-results hidden', style: { position: 'static', maxHeight: '210px', marginTop: '6px' } });
  const state = { id: selectedId || null, name: selectedName || '' };
  const status = h('div', { class: 'help' }, state.id ? `Выбрана компания: ${state.name}` : 'Компания будет создана, если не найдена в справочнике');

  const search = debounce(async () => {
    const term = input.value.trim();
    state.id = null;
    if (term.length < 2) { list.classList.add('hidden'); status.textContent = 'Компания будет создана, если не найдена в справочнике'; return; }
    try {
      const [found, similar] = await Promise.all([
        api.companies({ search: term, limit: 8 }),
        api.similarCompanies(term),
      ]);
      renderOptions(found.rows, similar);
    } catch { /* подсказка не критична */ }
  }, 240);

  function renderOptions(rows, similar) {
    setChildren(list, );
    if (rows.length) list.append(h('div', { class: 'group-title' }, 'Найдено в справочнике'));
    for (const company of rows) {
      list.append(h('a', {
        href: '#', onclick: (event) => {
          event.preventDefault();
          state.id = company.id;
          state.name = company.name;
          input.value = company.name;
          list.classList.add('hidden');
          status.textContent = `Выбрана компания: ${company.name}`;
        },
      },
        h('div', { class: 'r-title' }, company.name),
        h('div', { class: 'r-meta' }, `${company.country_name || ''}${company.city ? `, ${company.city}` : ''} · проектов: ${company.projects_count}`)
      ));
    }
    const extra = similar.filter((s) => !rows.some((r) => r.id === s.id));
    if (extra.length) {
      list.append(h('div', { class: 'group-title' }, 'Возможные дубликаты — проверьте перед созданием'));
      for (const company of extra) {
        list.append(h('a', {
          href: '#', onclick: (event) => {
            event.preventDefault();
            state.id = company.id;
            state.name = company.name;
            input.value = company.name;
            list.classList.add('hidden');
            status.textContent = `Выбрана компания: ${company.name}`;
          },
        }, h('div', { class: 'r-title' }, company.name), h('div', { class: 'r-meta' }, 'похожее название')));
      }
    }
    if (!rows.length && !extra.length) {
      list.append(h('div', { class: 'empty', style: { padding: '14px' } }, 'Не найдено — компания будет создана автоматически'));
    }
    list.classList.remove('hidden');
  }

  input.addEventListener('input', search);

  const countrySelect = select(store.reference.countries.map((c) => ({ value: c.id, label: c.name_ru })), { placeholder: '— страна новой компании —' });
  const newCompanyBlock = h('div', { class: 'hidden mt-1' }, field('Страна новой компании', countrySelect, { required: true }));

  input.addEventListener('blur', () => {
    setTimeout(() => {
      newCompanyBlock.classList.toggle('hidden', Boolean(state.id) || input.value.trim().length < 2);
    }, 200);
  });

  return {
    node: h('div', {}, input, list, status, newCompanyBlock),
    /** Возвращает id компании; при необходимости создаёт новую запись. */
    async resolve() {
      if (state.id) return state.id;
      const name = input.value.trim();
      if (!name) throw new Error('Укажите компанию или организацию');
      if (!countrySelect.value) throw new Error('Для новой компании укажите страну');
      const created = await api.post('/api/companies', { name, country_id: countrySelect.value });
      toastOk(`Компания «${created.name}» добавлена в справочник.`);
      return created.id;
    },
  };
}

// --------------------------------------------------------------------------
//  Компания
// --------------------------------------------------------------------------
export function openCompanyForm({ company = null, onSaved }) {
  const isEdit = Boolean(company);
  const controls = {
    name: h('input', { type: 'text', value: company?.name || '', maxlength: 300 }),
    country_id: select(store.reference.countries.map((c) => ({ value: c.id, label: c.name_ru })),
      { value: company?.country_id || '', placeholder: '— выберите страну —' }),
    city: h('input', { type: 'text', value: company?.city || '', maxlength: 120 }),
    website: h('input', { type: 'text', value: company?.website || '', placeholder: 'https://', maxlength: 300 }),
    industry: h('input', { type: 'text', value: company?.industry || '', maxlength: 200, placeholder: 'например, оптовая торговля текстилем' }),
    profile: h('textarea', {}, company?.profile || ''),
    responsible_user_id: select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
      { value: company?.responsible_user_id || store.user.id }),
  };
  const contacts = isEdit ? null : contactsEditor();
  const custom = customFieldsBlock('company', company?.custom_values || {});
  const errorBox = h('div', { class: 'callout danger hidden' });
  const duplicateBox = h('div', { class: 'callout hidden' });

  if (!isEdit) {
    controls.name.addEventListener('input', debounce(async () => {
      const term = controls.name.value.trim();
      if (term.length < 3) { duplicateBox.classList.add('hidden'); return; }
      const similar = await api.similarCompanies(term).catch(() => []);
      if (!similar.length) { duplicateBox.classList.add('hidden'); return; }
      setChildren(duplicateBox, 
        h('b', {}, 'Возможные дубликаты: '),
        similar.map((s) => s.name).join('; '),
        h('div', { class: 'small mt-1' }, 'Проверьте, не заведена ли компания ранее.')
      );
      duplicateBox.classList.remove('hidden');
    }, 350));
  }

  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить' : 'Создать компанию');
  const dialog = openModal({
    title: isEdit ? `Изменение: ${company.name}` : 'Новая компания-партнёр',
    body: h('form', { onsubmit: (e) => e.preventDefault() },
      errorBox, duplicateBox,
      field('Название компании', controls.name, { required: true }),
      h('div', { class: 'form-row' },
        field('Страна', controls.country_id, { required: true }),
        field('Город', controls.city)
      ),
      h('div', { class: 'form-row' },
        field('Отрасль / сегмент', controls.industry),
        field('Сайт', controls.website)
      ),
      field('Ответственный менеджер', controls.responsible_user_id),
      field('Краткая справка', controls.profile),
      contacts?.node,
      custom.node
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        name: controls.name.value.trim(),
        country_id: controls.country_id.value,
        city: controls.city.value.trim(),
        website: controls.website.value.trim(),
        industry: controls.industry.value.trim(),
        profile: controls.profile.value.trim(),
        responsible_user_id: controls.responsible_user_id.value,
        custom_values: custom.read(),
      };
      if (!isEdit) payload.contacts = contacts.read();
      const saved = isEdit
        ? await api.patch(`/api/companies/${company.id}`, payload)
        : await api.post('/api/companies', payload);
      dialog.close();
      toastOk(isEdit ? 'Изменения сохранены.' : `Компания «${saved.name}» добавлена.`);
      onSaved?.(saved);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

// --------------------------------------------------------------------------
//  Визит
// --------------------------------------------------------------------------
export function openVisitForm({ visit = null, onSaved }) {
  const isEdit = Boolean(visit);
  const ref = store.reference;
  const controls = {
    direction: select([
      { value: 'outbound', label: 'Выездной визит (делегация из Узбекистана)' },
      { value: 'inbound', label: 'Приём иностранной делегации' },
    ], { value: visit?.direction || 'outbound' }),
    country_id: select(ref.countries.map((c) => ({ value: c.id, label: `${c.name_ru} — ${c.region_name}` })),
      { value: visit?.country_id || '', placeholder: '— выберите страну —' }),
    cities: h('input', { type: 'text', value: visit?.cities || '', placeholder: 'например: Берлин, Дюссельдорф', maxlength: 500 }),
    date_from: h('input', { type: 'date', value: visit?.date_from || '' }),
    date_to: h('input', { type: 'date', value: visit?.date_to || '' }),
    status_code: select(ref.visit_statuses.map(dictOption), { value: visit?.status_code || 'planned' }),
    goal: h('textarea', { maxlength: 5000, placeholder: 'Цель визита, ожидаемые результаты' }, visit?.goal || ''),
    responsible_user_id: select(store.staff.map((u) => ({ value: u.id, label: u.full_name })),
      { value: visit?.responsible_user_id || store.user.id }),
  };

  const members = isEdit ? null : membersEditor();
  const custom = customFieldsBlock('visit', visit?.custom_values || {});
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить' : 'Создать визит');

  const dialog = openModal({
    title: isEdit ? `Изменение визита ${visit.code}` : 'Новый визит',
    size: 'wide',
    body: h('form', { onsubmit: (e) => e.preventDefault() },
      errorBox,
      h('div', { class: 'form-row' },
        field('Направление', controls.direction, { required: true }),
        field('Страна', controls.country_id, { required: true })
      ),
      field('Города', controls.cities, { required: true, help: 'Перечислите через запятую' }),
      h('div', { class: 'form-row' },
        field('Дата начала', controls.date_from, { required: true }),
        field('Дата окончания', controls.date_to, { required: true }),
        field('Статус', controls.status_code, { required: true })
      ),
      field('Цель визита', controls.goal, { required: true }),
      field('Ответственный', controls.responsible_user_id),
      members?.node,
      custom.node
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        direction: controls.direction.value,
        country_id: controls.country_id.value,
        cities: controls.cities.value.trim(),
        date_from: controls.date_from.value,
        date_to: controls.date_to.value,
        status_code: controls.status_code.value,
        goal: controls.goal.value.trim(),
        responsible_user_id: controls.responsible_user_id.value,
        custom_values: custom.read(),
      };
      if (!isEdit) payload.members = members.read();
      const saved = isEdit
        ? await api.patch(`/api/visits/${visit.id}`, payload)
        : await api.post('/api/visits', payload);
      dialog.close();
      toastOk(isEdit ? 'Изменения сохранены.' : `Создан визит ${saved.code}.`);
      onSaved?.(saved);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

function membersEditor() {
  const rows = h('div', {});
  const addRow = () => {
    const userSelect = select(
      [{ value: '', label: '— внешний участник —' }, ...store.reference.users.map((u) => ({ value: u.id, label: u.full_name }))],
      { name: 'user_id' }
    );
    const nameInput = h('input', { type: 'text', name: 'full_name', placeholder: 'ФИО участника' });
    userSelect.addEventListener('change', () => { nameInput.disabled = Boolean(userSelect.value); });
    const row = h('div', { class: 'form-row', style: { marginBottom: '10px', alignItems: 'end' } },
      userSelect, nameInput,
      h('input', { type: 'text', name: 'organization', placeholder: 'Организация' }),
      h('input', { type: 'text', name: 'position', placeholder: 'Должность' }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => row.remove() }, '✕')
    );
    rows.append(row);
  };
  addRow();

  return {
    node: h('div', {},
      h('div', { class: 'form-section-title' }, 'Состав делегации'),
      rows,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: addRow }, '+ Добавить участника')
    ),
    read: () => [...rows.children].map((row) => ({
      user_id: row.querySelector('[name=user_id]').value || null,
      full_name: row.querySelector('[name=full_name]').value.trim(),
      organization: row.querySelector('[name=organization]').value.trim(),
      position: row.querySelector('[name=position]').value.trim(),
    })).filter((member) => member.user_id || member.full_name),
  };
}

// --------------------------------------------------------------------------
//  Заявка на исправление (п. 2.3 ТЗ)
// --------------------------------------------------------------------------
export function openCorrectionForm({ entityType, entityId, entityLabel, onSaved }) {
  const reason = h('textarea', { placeholder: 'Опишите, что и почему следует исправить. Например: «В поле „Сумма“ указано 780 000 вместо 870 000 — опечатка».' });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Отправить заявку');

  const dialog = openModal({
    title: 'Запрос на исправление записи',
    body: h('div', {},
      errorBox,
      h('div', { class: 'callout info' },
        'Проектные менеджеры не могут изменять записи после создания. Заявка поступит администратору: ',
        'он применит исправление или отклонит запрос с пояснением. Все действия фиксируются в журнале.'),
      h('p', { class: 'small muted' }, `Запись: ${entityLabel}`),
      field('Что и почему нужно исправить', reason, { required: true })
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      await api.post('/api/corrections', {
        entity_type: entityType, entity_id: entityId, entity_label: entityLabel, reason: reason.value.trim(),
      });
      dialog.close();
      toastOk('Заявка отправлена администратору.');
      onSaved?.();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

// --------------------------------------------------------------------------
//  Загрузка файлов
// --------------------------------------------------------------------------
export function uploadZone({ entityType, entityId, onUploaded }) {
  const input = h('input', { type: 'file', multiple: true, class: 'hidden' });
  const zone = h('div', { class: 'dropzone', tabindex: 0, role: 'button' },
    'Перетащите файлы сюда или нажмите для выбора',
    h('div', { class: 'small mt-1' }, 'PDF, DOCX, XLSX, PPTX, изображения, архивы — до 25 МБ')
  );

  const upload = async (files) => {
    if (!files.length) return;
    zone.textContent = 'Загрузка…';
    try {
      const saved = await api.upload(entityType, entityId, files);
      onUploaded?.(saved);
      toastOk(`Загружено файлов: ${saved.length}`);
    } catch (error) {
      toastError(error.message);
    } finally {
      setChildren(zone, 'Перетащите файлы сюда или нажмите для выбора',
        h('div', { class: 'small mt-1' }, 'PDF, DOCX, XLSX, PPTX, изображения, архивы — до 25 МБ'));
    }
  };

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.click(); });
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    upload([...event.dataTransfer.files]);
  });
  input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });

  return h('div', {}, zone, input);
}

export function fileRow(file, { canDelete = false, onDelete = null } = {}) {
  const extension = (file.orig_name.split('.').pop() || '').toUpperCase().slice(0, 4);
  return h('div', { class: 'file-row' },
    h('div', { class: 'file-icon' }, extension),
    h('div', { style: { flex: '1', minWidth: '0' } },
      h('a', { class: 'file-name', href: `/api/attachments/${file.id}` }, file.orig_name),
      h('div', { class: 'file-meta' },
        `${formatSize(file.size)} · ${file.uploaded_by_name || '—'}`,
        file.version > 1 ? ` · версия ${file.version}${file.is_current ? ' (актуальная)' : ''}` : ''
      )
    ),
    canDelete && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => onDelete(file) }, 'Удалить')
  );
}

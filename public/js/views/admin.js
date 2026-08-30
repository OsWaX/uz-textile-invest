// ==========================================================================
//  Панель администратора (раздел 9 ТЗ): пользователи, конструктор форм,
//  справочники, настройки, журнал аудита, корзина.
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import {
  h, frag, field, select, formatDate, formatDateTime, formatNumber, empty, openModal,
  confirmDialog, toastOk, toastError, ROLE_LABELS, debounce, plural, setChildren,
} from '../ui.js';

const SECTIONS = {
  users: renderUsers,
  fields: renderCustomFields,
  dictionaries: renderDictionaries,
  settings: renderSettings,
  audit: renderAudit,
  bin: renderRecycleBin,
};

export async function renderAdmin({ params, query, navigate }) {
  const section = params[0];
  const view = SECTIONS[section];
  if (!view) return empty('Раздел не найден', 'Выберите раздел администрирования в меню слева.', '⚙');
  if (!store.isAdmin) return empty('Доступ ограничен', 'Раздел доступен только администратору системы.', '🔒');
  return view({ query, navigate });
}

// --------------------------------------------------------------------------
//  Пользователи
// --------------------------------------------------------------------------
async function renderUsers({ navigate }) {
  const container = h('div', {});
  const reload = async () => draw(await api.get('/api/admin/users'));

  function draw(users) {
    setChildren(container, 
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Пользователи'),
          h('div', { class: 'subtitle' }, 'Один администратор, девять проектных менеджеров по регионам, наблюдатели')
        ),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn btn-primary', onclick: () => openUserForm({ reload }) }, '+ Новый пользователь')
        )
      ),
      h('div', { class: 'callout info' },
        'Самостоятельная регистрация отключена. Учётные записи создаёт и отключает администратор; ' +
        'при создании пользователь получает временный пароль и обязан сменить его при первом входе.'),
      h('div', { class: 'card' },
        h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Сотрудник'), h('th', {}, 'Роль'), h('th', {}, 'Регион'),
                h('th', { class: 'num' }, 'Проектов'), h('th', {}, 'Состояние'), h('th', {}, 'Последний вход'), h('th', {}, '')
              )),
              h('tbody', {}, users.map((user) => userRow(user, reload)))
            )
          )
        )
      )
    );
  }

  await reload();
  return container;
}

function userRow(user, reload) {
  const locked = user.locked_until && new Date(`${user.locked_until.replace(' ', 'T')}Z`) > new Date();
  return h('tr', {},
    h('td', {},
      h('span', { class: 't-main' }, user.full_name),
      h('div', { class: 't-sub' }, `${user.email}${user.position ? ` · ${user.position}` : ''}`)
    ),
    h('td', {}, h('span', { class: `tag ${user.role === 'admin' ? 'tag-indigo' : user.role === 'team' ? 'tag-ok' : ''}` }, ROLE_LABELS[user.role])),
    h('td', {}, user.region_name || '—'),
    h('td', { class: 'num' }, formatNumber(user.projects_count)),
    h('td', {},
      user.is_active
        ? h('span', { class: 'tag tag-ok' }, 'Активна')
        : h('span', { class: 'tag tag-danger' }, 'Отключена'),
      locked ? h('div', { class: 't-sub', style: { color: 'var(--warn)' } }, 'заблокирована после неудачных входов') : null,
      user.totp_enabled ? h('div', { class: 't-sub' }, '2FA подключена') : null
    ),
    h('td', { class: 'nowrap' }, user.last_login_at ? formatDateTime(user.last_login_at) : h('span', { class: 'muted' }, 'не входил')),
    h('td', {},
      h('div', { class: 'flex', style: { gap: '4px' } },
        h('button', { class: 'btn btn-sm', title: 'Изменить', onclick: () => openUserForm({ user, reload }) }, '✎'),
        h('button', { class: 'btn btn-sm', title: 'Сбросить пароль', onclick: () => openPasswordReset(user, reload) }, '🔑'),
        user.totp_enabled
          ? h('button', {
              class: 'btn btn-sm', title: 'Сбросить 2FA',
              onclick: async () => {
                if (!await confirmDialog({ title: 'Сброс 2FA', message: `Сбросить двухфакторную аутентификацию для ${user.full_name}?`, confirmLabel: 'Сбросить' })) return;
                await api.post(`/api/admin/users/${user.id}/reset-2fa`);
                toastOk('Двухфакторная аутентификация сброшена.');
                reload();
              },
            }, '🔓')
          : null,
        locked
          ? h('button', {
              class: 'btn btn-sm', title: 'Снять блокировку',
              onclick: async () => {
                await api.post(`/api/admin/users/${user.id}/unlock`);
                toastOk('Блокировка снята.');
                reload();
              },
            }, '⏻')
          : null
      )
    )
  );
}

function openUserForm({ user = null, reload }) {
  const isEdit = Boolean(user);
  const email = h('input', { type: 'email', value: user?.email || '', disabled: isEdit, placeholder: 'ivanov@textile.gov.uz' });
  const fullName = h('input', { type: 'text', value: user?.full_name || '', maxlength: 200 });
  const position = h('input', { type: 'text', value: user?.position || '', maxlength: 200, placeholder: 'например, проектный менеджер по Европе' });
  const role = select(Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })), { value: user?.role || 'team' });
  const region = select(store.reference.regions.map((r) => ({ value: r.id, label: r.name_ru })),
    { value: user?.region_id || '', placeholder: '— без закрепления за регионом —' });
  const phone = h('input', { type: 'text', value: user?.phone || '', maxlength: 40 });
  const telegram = h('input', { type: 'text', value: user?.telegram_chat_id || '', maxlength: 40 });
  const password = h('input', { type: 'text', value: generatePassword(), maxlength: 60 });
  const isActive = h('input', { type: 'checkbox', checked: user ? Boolean(user.is_active) : true });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить' : 'Создать пользователя');

  const dialog = openModal({
    title: isEdit ? `Пользователь: ${user.full_name}` : 'Новый пользователь',
    body: h('div', {},
      errorBox,
      field('Адрес электронной почты', email, { required: true, help: isEdit ? 'Адрес изменить нельзя' : 'Используется как логин' }),
      field('ФИО', fullName, { required: true }),
      field('Должность', position),
      h('div', { class: 'form-row' },
        field('Роль', role, { required: true }),
        field('Регион ответственности', region)
      ),
      h('div', { class: 'form-row' },
        field('Телефон', phone),
        field('Telegram chat ID', telegram)
      ),
      !isEdit ? field('Временный пароль', password, { required: true, help: 'Пользователь обязан сменить его при первом входе' }) : null,
      isEdit ? h('label', { class: 'checkbox' }, isActive, h('span', {}, 'Учётная запись активна')) : null
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        full_name: fullName.value.trim(),
        position: position.value.trim(),
        role: role.value,
        region_id: region.value || null,
        phone: phone.value.trim(),
        telegram_chat_id: telegram.value.trim(),
      };
      if (isEdit) {
        payload.is_active = isActive.checked;
        await api.patch(`/api/admin/users/${user.id}`, payload);
      } else {
        payload.email = email.value.trim();
        payload.password = password.value;
        await api.post('/api/admin/users', payload);
      }
      dialog.close();
      toastOk(isEdit ? 'Данные пользователя сохранены.' : `Пользователь создан. Передайте временный пароль: ${password.value}`);
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

function openPasswordReset(user, reload) {
  const password = h('input', { type: 'text', value: generatePassword(), maxlength: 60 });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сбросить пароль');

  const dialog = openModal({
    title: `Сброс пароля: ${user.full_name}`,
    size: 'narrow',
    body: h('div', {}, errorBox,
      h('p', { class: 'small muted' }, 'Все активные сессии пользователя будут завершены. Передайте новый пароль лично или по защищённому каналу.'),
      field('Новый временный пароль', password, { required: true })
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    try {
      await api.post(`/api/admin/users/${user.id}/reset-password`, { password: password.value });
      dialog.close();
      toastOk(`Пароль сброшен. Новый пароль: ${password.value}`);
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };
}

function generatePassword() {
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const values = crypto.getRandomValues(new Uint8Array(12));
  return [...values].map((value, index) =>
    index % 3 === 2 ? digits[value % digits.length] : letters[value % letters.length]
  ).join('');
}

// --------------------------------------------------------------------------
//  Конструктор форм (п. 9.1 ТЗ)
// --------------------------------------------------------------------------
async function renderCustomFields() {
  const container = h('div', {});
  let data = null;
  const reload = async () => { data = await api.get('/api/admin/custom-fields'); draw(); };

  function draw() {
    setChildren(container, 
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Конструктор форм'),
          h('div', { class: 'subtitle' }, 'Добавление собственных полей в формы без участия программиста')
        ),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn btn-primary', onclick: () => openFieldForm({ data, reload }) }, '+ Новое поле')
        )
      ),
      h('div', { class: 'callout info' },
        'Добавленные поля появляются в форме, в фильтрах и в выгрузках Excel. ',
        'Отключённое поле скрывается в новых записях, но исторические данные сохраняются.'),
      Object.entries(data.forms).map(([form, formLabel]) =>
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('h2', {}, `Форма «${formLabel}»`),
            h('span', { class: 'muted small' }, `полей: ${data.fields[form].length}`)
          ),
          data.fields[form].length
            ? h('div', { class: 'card-body tight' },
                h('div', { class: 'table-wrap' },
                  h('table', { class: 'data' },
                    h('thead', {}, h('tr', {},
                      h('th', {}, 'Название'), h('th', {}, 'Системное имя'), h('th', {}, 'Тип'),
                      h('th', {}, 'Обязательное'), h('th', {}, 'Заполняет менеджер'), h('th', {}, 'Состояние'), h('th', {}, '')
                    )),
                    h('tbody', {}, data.fields[form].map((cf) =>
                      h('tr', {},
                        h('td', {},
                          h('span', { class: 't-main' }, cf.label_ru),
                          cf.help_text ? h('div', { class: 't-sub' }, cf.help_text) : null,
                          cf.options.length ? h('div', { class: 't-sub' }, `варианты: ${cf.options.join(', ')}`) : null
                        ),
                        h('td', { class: 'code' }, cf.field_key),
                        h('td', {}, data.types[cf.type] || cf.type),
                        h('td', {}, cf.required ? 'Да' : 'Нет'),
                        h('td', {}, cf.team_can_fill ? 'Да' : 'Только администратор'),
                        h('td', {}, cf.is_active
                          ? h('span', { class: 'tag tag-ok' }, 'Активно')
                          : h('span', { class: 'tag' }, 'Отключено')),
                        h('td', {},
                          h('div', { class: 'flex', style: { gap: '4px' } },
                            h('button', { class: 'btn btn-sm', onclick: () => openFieldForm({ data, cf, reload }) }, '✎'),
                            h('button', {
                              class: 'btn btn-sm',
                              onclick: async () => {
                                await api.patch(`/api/admin/custom-fields/${cf.id}`, { is_active: !cf.is_active });
                                toastOk(cf.is_active ? 'Поле отключено.' : 'Поле включено.');
                                reload();
                                await store.loadReference(true);
                              },
                            }, cf.is_active ? 'Отключить' : 'Включить')
                          )
                        )
                      )
                    ))
                  )
                )
              )
            : h('div', { class: 'card-body' }, h('p', { class: 'muted mb-0' }, 'Собственных полей нет.'))
        )
      )
    );
  }

  await reload();
  return container;
}

function openFieldForm({ data, cf = null, reload }) {
  const isEdit = Boolean(cf);
  const form = select(Object.entries(data.forms).map(([value, label]) => ({ value, label })), { value: cf?.form || 'project' });
  form.disabled = isEdit;
  const type = select(Object.entries(data.types).map(([value, label]) => ({ value, label })), { value: cf?.type || 'text' });
  type.disabled = isEdit;
  const labelRu = h('input', { type: 'text', value: cf?.label_ru || '', maxlength: 200 });
  const labelUz = h('input', { type: 'text', value: cf?.label_uz || '', maxlength: 200 });
  const labelEn = h('input', { type: 'text', value: cf?.label_en || '', maxlength: 200 });
  const helpText = h('input', { type: 'text', value: cf?.help_text || '', maxlength: 500 });
  const options = h('textarea', { placeholder: 'По одному варианту в строке' }, (cf?.options || []).join('\n'));
  const optionsField = h('div', {}, field('Варианты ответа', options, { help: 'Требуется для списков и голосований' }));
  const required = h('input', { type: 'checkbox', checked: Boolean(cf?.required) });
  const teamCanFill = h('input', { type: 'checkbox', checked: cf ? Boolean(cf.team_can_fill) : true });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить' : 'Добавить поле');

  const syncOptions = () => optionsField.classList.toggle('hidden', !['select', 'multiselect', 'poll'].includes(type.value));
  type.addEventListener('change', syncOptions);
  syncOptions();

  const dialog = openModal({
    title: isEdit ? `Поле: ${cf.label_ru}` : 'Новое поле формы',
    body: h('div', {},
      errorBox,
      h('div', { class: 'form-row' },
        field('Форма', form, { required: true, help: isEdit ? 'Изменить нельзя' : '' }),
        field('Тип поля', type, { required: true, help: isEdit ? 'Изменить нельзя' : '' })
      ),
      field('Название (русский)', labelRu, { required: true }),
      h('div', { class: 'form-row' },
        field('Название (узбекский)', labelUz),
        field('Название (английский)', labelEn)
      ),
      field('Подсказка для пользователя', helpText),
      optionsField,
      h('label', { class: 'checkbox' }, required, h('span', {}, 'Обязательное для заполнения')),
      h('label', { class: 'checkbox' }, teamCanFill, h('span', {}, 'Проектный менеджер может заполнять поле'))
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    saveButton.disabled = true;
    try {
      const payload = {
        label_ru: labelRu.value.trim(),
        label_uz: labelUz.value.trim(),
        label_en: labelEn.value.trim(),
        help_text: helpText.value.trim(),
        required: required.checked,
        team_can_fill: teamCanFill.checked,
        options: options.value.split('\n').map((line) => line.trim()).filter(Boolean),
      };
      if (isEdit) {
        await api.patch(`/api/admin/custom-fields/${cf.id}`, payload);
      } else {
        payload.form = form.value;
        payload.type = type.value;
        await api.post('/api/admin/custom-fields', payload);
      }
      dialog.close();
      toastOk(isEdit ? 'Поле изменено.' : 'Поле добавлено в форму.');
      await store.loadReference(true);
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
    }
  };
}

// --------------------------------------------------------------------------
//  Справочники (п. 9.2 ТЗ)
// --------------------------------------------------------------------------
const DICT_TITLES = {
  sector: 'Отрасли', record_type: 'Типы записей', project_status: 'Статусы проектов',
  visit_status: 'Статусы визитов', meeting_status: 'Статусы встреч', currency: 'Валюты',
};

async function renderDictionaries() {
  const container = h('div', {});
  let data = null;
  const reload = async () => { data = await api.get('/api/admin/dictionaries'); draw(); };

  function draw() {
    const countrySearch = h('input', { type: 'search', placeholder: 'Поиск страны' });
    const countryBody = h('tbody', {});
    const drawCountries = (term = '') => {
      const filtered = data.countries.filter((c) => c.name_ru.toLowerCase().includes(term.toLowerCase()));
      setChildren(countryBody, 
        filtered.slice(0, 200).map((country) =>
          h('tr', {},
            h('td', { class: 'code' }, country.iso2),
            h('td', { class: 'strong' }, country.name_ru),
            h('td', {}, select(data.regions.map((r) => ({ value: r.id, label: r.name_ru })), {
              value: country.region_id,
              onchange: async (event) => {
                try {
                  await api.patch(`/api/admin/countries/${country.id}`, { region_id: event.target.value });
                  toastOk(`Страна «${country.name_ru}» переведена в другой регион.`);
                  await store.loadReference(true);
                } catch (error) { toastError(error.message); }
              },
            }))
          )
        )
      );
    };
    countrySearch.addEventListener('input', debounce(() => drawCountries(countrySearch.value), 200));

    setChildren(container, 
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Справочники'),
          h('div', { class: 'subtitle' }, 'Отрасли, статусы, типы записей, валюты и привязка стран к регионам')
        )
      ),
      h('div', { class: 'grid grid-2' },
        Object.entries(DICT_TITLES).map(([kind, title]) =>
          h('div', { class: 'card' },
            h('div', { class: 'card-head' },
              h('h2', {}, title),
              h('button', { class: 'btn btn-sm', onclick: () => openDictForm({ kind, title, reload }) }, '+ Значение')
            ),
            h('div', { class: 'card-body tight' },
              h('div', { class: 'table-wrap' },
                h('table', { class: 'data' },
                  h('thead', {}, h('tr', {}, h('th', {}, 'Название'), h('th', {}, 'Код'), h('th', {}, 'Состояние'), h('th', {}, ''))),
                  h('tbody', {}, data[kind].map((item) =>
                    h('tr', {},
                      h('td', {},
                        h('span', {
                          class: 'tag', style: item.color ? { color: item.color, background: `color-mix(in srgb, ${item.color} 13%, transparent)` } : {},
                        }, h('span', { class: 'dot' }), item.name_ru),
                        item.name_uz || item.name_en ? h('div', { class: 't-sub' }, [item.name_uz, item.name_en].filter(Boolean).join(' · ')) : null
                      ),
                      h('td', { class: 'code' }, item.code),
                      h('td', {}, item.is_active ? h('span', { class: 'tag tag-ok' }, 'Активно') : h('span', { class: 'tag' }, 'Скрыто')),
                      h('td', {},
                        h('div', { class: 'flex', style: { gap: '4px' } },
                          h('button', { class: 'btn btn-sm', onclick: () => openDictForm({ kind, title, item, reload }) }, '✎'),
                          h('button', {
                            class: 'btn btn-sm',
                            onclick: async () => {
                              try {
                                await api.patch(`/api/admin/dictionaries/${item.id}`, { is_active: !item.is_active });
                                toastOk('Изменено.');
                                await store.loadReference(true);
                                reload();
                              } catch (error) { toastError(error.message); }
                            },
                          }, item.is_active ? 'Скрыть' : 'Вернуть')
                        )
                      )
                    )
                  ))
                )
              )
            )
          )
        )
      ),
      h('div', { class: 'card mt-2' },
        h('div', { class: 'card-head' },
          h('h2', {}, 'Регионы Узбекистана'),
          h('span', { class: 'muted small' }, `${data.uz_regions.length} административных единиц`)),
        h('div', { class: 'card-body' },
          h('p', { class: 'small muted mb-0' },
            'Места реализации инвестиционных проектов. Состав закрыт: значения переименовываются ' +
            'и скрываются, но не добавляются и не удаляются. Регион, указанный хотя бы в одном проекте, отключить нельзя.')),
        h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap' },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Название (рус.)'), h('th', {}, 'Название (узб.)'), h('th', {}, 'Название (англ.)'),
                h('th', {}, 'Код'), h('th', {}, 'Состояние'), h('th', {}, ''))),
              h('tbody', {}, data.uz_regions.map((region) => uzRegionRow(region, reload))))))),

      h('div', { class: 'card mt-2' },
        h('div', { class: 'card-head' },
          h('h2', {}, 'Страны и регионы мира'),
          h('span', { class: 'muted small' }, `всего стран: ${data.countries.length}`)
        ),
        h('div', { class: 'card-body' },
          h('p', { class: 'small muted' }, 'Регион проекта определяется автоматически по стране. Здесь можно изменить привязку.'),
          countrySearch
        ),
        h('div', { class: 'card-body tight' },
          h('div', { class: 'table-wrap', style: { maxHeight: '460px', overflowY: 'auto' } },
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Код'), h('th', {}, 'Страна'), h('th', {}, 'Регион ответственности'))),
              countryBody
            )
          )
        )
      )
    );
    drawCountries();
  }

  await reload();
  return container;
}

/** Строка справочника регионов Узбекистана (дополнение № 1 к ТЗ). */
function uzRegionRow(region, reload) {
  const patch = async (payload, message) => {
    try {
      await api.patch(`/api/admin/uz-regions/${region.id}`, payload);
      toastOk(message);
      await store.loadReference(true);
      reload();
    } catch (error) {
      toastError(error.message);
    }
  };

  return h('tr', {},
    h('td', { class: 'strong' }, region.name_ru),
    h('td', {}, region.name_uz || h('span', { class: 'muted' }, '—')),
    h('td', {}, region.name_en || h('span', { class: 'muted' }, '—')),
    h('td', { class: 'code' }, region.code),
    h('td', {}, region.is_active
      ? h('span', { class: 'tag tag-ok' }, 'Активен')
      : h('span', { class: 'tag' }, 'Скрыт')),
    h('td', {},
      h('div', { class: 'flex', style: { gap: '4px' } },
        h('button', { class: 'btn btn-sm', title: 'Изменить названия', onclick: () => openUzRegionForm(region, reload) }, '✎'),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => patch({ is_active: !region.is_active }, region.is_active ? 'Регион скрыт.' : 'Регион возвращён.'),
        }, region.is_active ? 'Скрыть' : 'Вернуть'))));
}

function openUzRegionForm(region, reload) {
  const nameRu = h('input', { type: 'text', value: region.name_ru, maxlength: 200 });
  const nameUz = h('input', { type: 'text', value: region.name_uz || '', maxlength: 200 });
  const nameEn = h('input', { type: 'text', value: region.name_en || '', maxlength: 200 });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить');

  const dialog = openModal({
    title: `Регион: ${region.name_ru}`,
    body: h('div', {}, errorBox,
      h('p', { class: 'small muted' }, `Код в базе данных: ${region.code}. Код изменить нельзя.`),
      field('Название (русский)', nameRu, { required: true }),
      h('div', { class: 'form-row' }, field('Название (узбекский)', nameUz), field('Название (английский)', nameEn))),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    try {
      await api.patch(`/api/admin/uz-regions/${region.id}`, {
        name_ru: nameRu.value.trim(), name_uz: nameUz.value.trim(), name_en: nameEn.value.trim(),
      });
      dialog.close();
      toastOk('Название региона изменено.');
      await store.loadReference(true);
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };
}

function openDictForm({ kind, title, item = null, reload }) {
  const isEdit = Boolean(item);
  const code = h('input', { type: 'text', value: item?.code || '', maxlength: 50, disabled: isEdit, placeholder: 'латиницей, например: joint_venture' });
  const nameRu = h('input', { type: 'text', value: item?.name_ru || '', maxlength: 200 });
  const nameUz = h('input', { type: 'text', value: item?.name_uz || '', maxlength: 200 });
  const nameEn = h('input', { type: 'text', value: item?.name_en || '', maxlength: 200 });
  const color = h('input', { type: 'color', value: item?.color || '#1f4e9e', style: { height: '34px', padding: '2px' } });
  const errorBox = h('div', { class: 'callout danger hidden' });
  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, isEdit ? 'Сохранить' : 'Добавить');

  const dialog = openModal({
    title: `${title}: ${isEdit ? item.name_ru : 'новое значение'}`,
    body: h('div', {}, errorBox,
      field('Код', code, { required: true, help: isEdit ? 'Код изменить нельзя' : 'Используется в базе данных и выгрузках' }),
      field('Название (русский)', nameRu, { required: true }),
      h('div', { class: 'form-row' }, field('Название (узбекский)', nameUz), field('Название (английский)', nameEn)),
      field('Цвет метки', color)
    ),
    footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), saveButton),
  });

  saveButton.onclick = async () => {
    errorBox.classList.add('hidden');
    try {
      const payload = { name_ru: nameRu.value.trim(), name_uz: nameUz.value.trim(), name_en: nameEn.value.trim(), color: color.value };
      if (isEdit) await api.patch(`/api/admin/dictionaries/${item.id}`, payload);
      else await api.post('/api/admin/dictionaries', { ...payload, kind, code: code.value.trim() });
      dialog.close();
      toastOk('Справочник обновлён.');
      await store.loadReference(true);
      reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  };
}

// --------------------------------------------------------------------------
//  Настройки
// --------------------------------------------------------------------------
async function renderSettings() {
  const data = await api.get('/api/admin/settings');
  const values = data.values;
  const controls = {};

  const numberField = (key, min = 0, max = 3650) => {
    controls[key] = h('input', { type: 'number', value: values[key] ?? 0, min, max });
    return field(data.labels[key], controls[key]);
  };
  const boolField = (key) => {
    controls[key] = h('input', { type: 'checkbox', checked: Boolean(values[key]) });
    return h('label', { class: 'checkbox' }, controls[key], h('span', {}, data.labels[key]));
  };
  const textField = (key) => {
    controls[key] = h('input', { type: 'text', value: values[key] ?? '', maxlength: 300 });
    return field(data.labels[key], controls[key]);
  };

  const reminderDays = h('input', {
    type: 'text', value: (values['reminders.days_before'] || []).join(', '), placeholder: '7, 3, 1',
  });

  const rates = values['currency.rates_to_usd'] || {};
  const rateInputs = {};
  const ratesGrid = h('div', { class: 'form-row' },
    Object.entries(rates).map(([currency, rate]) => {
      rateInputs[currency] = h('input', { type: 'number', step: '0.000001', value: rate });
      return field(`1 ${currency} = ? USD`, rateInputs[currency]);
    })
  );

  const saveButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить настройки');
  saveButton.onclick = async () => {
    saveButton.disabled = true;
    try {
      const payload = {
        'reminders.days_before': reminderDays.value.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0),
        'reminders.escalate_overdue': controls['reminders.escalate_overdue'].checked,
        'reminders.digest_weekday': Number(controls['reminders.digest_weekday'].value),
        'reminders.digest_hour': Number(controls['reminders.digest_hour'].value),
        'projects.stale_days': Number(controls['projects.stale_days'].value),
        'security.session_timeout_minutes': Number(controls['security.session_timeout_minutes'].value),
        'security.require_2fa': controls['security.require_2fa'].checked,
        'recycle_bin.retention_days': Number(controls['recycle_bin.retention_days'].value),
        'projects.locations_for_export': controls['projects.locations_for_export'].checked,
        'attention.meeting_tbc_days': Number(controls['attention.meeting_tbc_days'].value),
        'org.name': controls['org.name'].value.trim(),
        'org.ministry': controls['org.ministry'].value.trim(),
        'currency.rates_to_usd': Object.fromEntries(Object.entries(rateInputs).map(([currency, input]) => [currency, Number(input.value)])),
      };
      await api.patch('/api/admin/settings', payload);
      toastOk('Настройки сохранены.');
      await store.loadReference(true);
    } catch (error) {
      toastError(error.message);
    } finally {
      saveButton.disabled = false;
    }
  };

  const runChecks = h('button', { class: 'btn', type: 'button' }, 'Запустить проверку сроков сейчас');
  runChecks.onclick = async () => {
    runChecks.disabled = true;
    try {
      const result = await api.post('/api/notifications/run-checks');
      toastOk(`Создано уведомлений — напоминания: ${result.deadline_reminders}, просрочки: ${result.overdue}, «замершие»: ${result.stale}, сводки: ${result.digest}.`);
    } catch (error) {
      toastError(error.message);
    } finally {
      runChecks.disabled = false;
    }
  };

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Настройки системы'),
        h('div', { class: 'subtitle' }, 'Напоминания, безопасность, курсы валют и реквизиты организации')
      ),
      h('div', { class: 'page-actions' }, saveButton)
    ),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Напоминания и контроль сроков')),
        h('div', { class: 'card-body' },
          field(data.labels['reminders.days_before'], reminderDays, { help: 'Перечислите через запятую, например: 7, 3, 1' }),
          boolField('reminders.escalate_overdue'),
          h('div', { class: 'form-row mt-1' },
            numberField('reminders.digest_weekday', 0, 6),
            numberField('reminders.digest_hour', 0, 23)
          ),
          h('div', { class: 'form-row' },
            numberField('projects.stale_days', 1, 365),
            numberField('attention.meeting_tbc_days', 1, 60)
          ),
          h('div', { class: 'mt-1' }, runChecks)
        )
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Безопасность и хранение')),
        h('div', { class: 'card-body' },
          numberField('security.session_timeout_minutes', 5, 480),
          boolField('security.require_2fa'),
          numberField('recycle_bin.retention_days', 1, 365),
          boolField('projects.locations_for_export'),
          h('div', { class: 'callout mt-2' },
            h('b', {}, 'Каналы уведомлений: '),
            `почта — ${data.channels.email.enabled ? `настроена (${data.channels.email.host})` : 'не настроена'}; `,
            `Telegram — ${data.channels.telegram.enabled ? 'подключён' : 'не подключён'}.`,
            h('div', { class: 'small mt-1' }, 'Настраивается в файле .env на сервере.')
          ),
          h('div', { class: 'callout' },
            h('b', {}, 'Хранение файлов: '), data.storage.upload_dir,
            h('div', { class: 'small' }, `Предельный размер файла — ${data.storage.max_upload_mb} МБ.`))
        )
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Курсы валют к доллару США')),
        h('div', { class: 'card-body' },
          h('p', { class: 'small muted' }, 'Используются для сводных сумм на дашборде и в отчётах.'),
          ratesGrid
        )
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Реквизиты организации')),
        h('div', { class: 'card-body' }, textField('org.name'), textField('org.ministry'))
      )
    )
  );
}

// --------------------------------------------------------------------------
//  Журнал аудита (раздел 10 ТЗ)
// --------------------------------------------------------------------------
async function renderAudit({ query, navigate }) {
  const data = await api.get('/api/admin/audit', { ...query, limit: 100 });

  const searchInput = h('input', { type: 'search', value: query.search || '', placeholder: 'Поиск по описанию и значениям' });
  searchInput.addEventListener('input', debounce(() => navigate('/admin/audit', { ...query, search: searchInput.value, offset: 0 }), 400));

  const filters = h('div', { class: 'filters' },
    field('Поиск', searchInput),
    field('Действие', select(Object.entries(data.actions).map(([value, label]) => ({ value, label })),
      { value: query.action || '', placeholder: 'Все действия', onchange: (e) => navigate('/admin/audit', { ...query, action: e.target.value, offset: 0 }) })),
    field('Тип записи', select(Object.entries(data.entities).map(([value, label]) => ({ value, label })),
      { value: query.entity_type || '', placeholder: 'Все типы', onchange: (e) => navigate('/admin/audit', { ...query, entity_type: e.target.value, offset: 0 }) })),
    field('Пользователь', select(store.reference.users.map((u) => ({ value: u.id, label: u.full_name })),
      { value: query.user_id || '', placeholder: 'Все пользователи', onchange: (e) => navigate('/admin/audit', { ...query, user_id: e.target.value, offset: 0 }) })),
    field('С даты', h('input', { type: 'date', value: query.from || '', onchange: (e) => navigate('/admin/audit', { ...query, from: e.target.value, offset: 0 }) })),
    field('По дату', h('input', { type: 'date', value: query.to || '', onchange: (e) => navigate('/admin/audit', { ...query, to: e.target.value, offset: 0 }) }))
  );

  const offset = Number(query.offset) || 0;

  return frag(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Журнал аудита'),
        h('div', { class: 'subtitle' }, 'Кто, что и когда изменил — со старыми и новыми значениями полей')
      )
    ),
    filters,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Записей в журнале: ${formatNumber(data.total)}`)),
      data.rows.length
        ? h('div', { class: 'card-body tight' },
            h('div', { class: 'table-wrap' },
              h('table', { class: 'data' },
                h('thead', {}, h('tr', {},
                  h('th', {}, 'Дата и время'), h('th', {}, 'Пользователь'), h('th', {}, 'Действие'),
                  h('th', {}, 'Объект'), h('th', {}, 'Описание'), h('th', {}, 'Изменения')
                )),
                h('tbody', {}, data.rows.map((entry) =>
                  h('tr', {},
                    h('td', { class: 'nowrap' }, formatDateTime(entry.created_at)),
                    h('td', {}, entry.user_label, entry.ip ? h('div', { class: 't-sub mono' }, entry.ip) : null),
                    h('td', {}, h('span', { class: `tag ${auditTagClass(entry.action)}` }, entry.action_label)),
                    h('td', {},
                      entry.entity_label,
                      entry.entity_id ? h('div', { class: 't-sub mono' }, `№${entry.entity_id}`) : null
                    ),
                    h('td', { style: { maxWidth: '320px' } }, entry.summary),
                    h('td', { style: { maxWidth: '340px' } },
                      entry.changes.length
                        ? entry.changes.map((change) =>
                            h('div', { class: 'audit-change' },
                              h('b', {}, `${change.label}: `),
                              h('span', { class: 'from' }, formatValue(change.from)),
                              ' → ',
                              h('span', { class: 'to' }, formatValue(change.to))
                            )
                          )
                        : h('span', { class: 'muted' }, '—')
                    )
                  )
                ))
              )
            )
          )
        : h('div', { class: 'card-body' }, empty('Записей не найдено', 'Измените условия фильтрации.', '⧉')),
      data.total > 100
        ? h('div', { class: 'pagination' },
            h('button', { class: 'btn btn-sm', disabled: offset === 0, onclick: () => navigate('/admin/audit', { ...query, offset: Math.max(0, offset - 100) }) }, '← Назад'),
            h('span', { class: 'muted' }, `${offset + 1}–${Math.min(offset + 100, data.total)} из ${formatNumber(data.total)}`),
            h('button', { class: 'btn btn-sm', disabled: offset + 100 >= data.total, onclick: () => navigate('/admin/audit', { ...query, offset: offset + 100 }) }, 'Вперёд →')
          )
        : null
    )
  );
}

const auditTagClass = (action) => ({
  create: 'tag-ok', update: 'tag-indigo', delete: 'tag-danger', login: '',
  login_failed: 'tag-danger', status_change: 'tag-indigo', export: 'tag-gold',
}[action] || '');

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '(пусто)';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).slice(0, 90);
}

// --------------------------------------------------------------------------
//  Корзина (п. 9.2 ТЗ)
// --------------------------------------------------------------------------
async function renderRecycleBin() {
  const container = h('div', {});
  const reload = async () => draw(await api.get('/api/admin/recycle-bin'));

  function draw(data) {
    const total = Object.values(data.bins).reduce((sum, bin) => sum + bin.rows.length, 0);
    setChildren(container, 
      h('div', { class: 'page-head' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Корзина'),
          h('div', { class: 'subtitle' },
            `Удалённые записи хранятся ${data.retention_days} ${plural(data.retention_days, 'день', 'дня', 'дней')} и могут быть восстановлены`)
        )
      ),
      total === 0
        ? h('div', { class: 'card' }, h('div', { class: 'card-body' }, empty('Корзина пуста', 'Удалённые записи появятся здесь.', '🗑')))
        : Object.entries(data.bins).filter(([, bin]) => bin.rows.length).map(([type, bin]) =>
            h('div', { class: 'card' },
              h('div', { class: 'card-head' }, h('h2', {}, `${bin.label} — ${bin.rows.length}`)),
              h('div', { class: 'card-body tight' },
                h('div', { class: 'table-wrap' },
                  h('table', { class: 'data' },
                    h('thead', {}, h('tr', {}, h('th', {}, 'Запись'), h('th', {}, 'Удалена'), h('th', {}, 'Осталось дней'), h('th', {}, ''))),
                    h('tbody', {}, bin.rows.map((row) =>
                      h('tr', {},
                        h('td', { class: 'strong' }, row.title),
                        h('td', { class: 'nowrap' }, formatDate(row.deleted_at)),
                        h('td', {}, row.days_left > 0
                          ? `${row.days_left} ${plural(row.days_left, 'день', 'дня', 'дней')}`
                          : h('span', { style: { color: 'var(--danger)' } }, 'будет удалена')),
                        h('td', {},
                          h('div', { class: 'flex', style: { gap: '5px' } },
                            h('button', {
                              class: 'btn btn-sm btn-primary',
                              onclick: async () => {
                                await api.post(`/api/admin/recycle-bin/${type}/${row.id}/restore`);
                                toastOk('Запись восстановлена.');
                                reload();
                              },
                            }, 'Восстановить'),
                            h('button', {
                              class: 'btn btn-sm btn-danger',
                              onclick: async () => {
                                if (!await confirmDialog({
                                  title: 'Окончательное удаление',
                                  message: `Удалить «${row.title}» без возможности восстановления?`,
                                  confirmLabel: 'Удалить навсегда', danger: true,
                                })) return;
                                await api.delete(`/api/admin/recycle-bin/${type}/${row.id}`);
                                toastOk('Запись удалена окончательно.');
                                reload();
                              },
                            }, 'Удалить навсегда')
                          )
                        )
                      )
                    ))
                  )
                )
              )
            )
          )
    );
  }

  await reload();
  return container;
}

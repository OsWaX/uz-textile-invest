// ==========================================================================
//  Профиль пользователя: личные данные, каналы уведомлений, пароль, 2FA.
// ==========================================================================
import { api } from '../api.js';
import { store } from '../store.js';
import { 
  h, frag, field, select, formatDateTime, toastOk, toastError, ROLE_LABELS, initials,
  openModal, column,
 } from '../ui.js';

export async function renderProfile() {
  const me = await api.me();
  store.user = me.user;
  const notifications = await api.notifications({ limit: 1 });
  const user = me.user;

  const container = h('div', {});

  const fullName = h('input', { type: 'text', value: user.full_name, maxlength: 200 });
  const phone = h('input', { type: 'text', value: user.phone || '', maxlength: 40, placeholder: '+998 __ ___-__-__' });
  const telegram = h('input', { type: 'text', value: user.telegram_chat_id || '', maxlength: 40, placeholder: 'chat_id из Telegram-бота' });
  const language = select([
    { value: 'ru', label: 'Русский' },
    { value: 'uz', label: 'Ozbekcha (лат.)' },
    { value: 'en', label: 'English' },
  ], { value: user.language });

  const notifyInapp = h('input', { type: 'checkbox', checked: user.notify_inapp, disabled: true });
  const notifyEmail = h('input', { type: 'checkbox', checked: user.notify_email });
  const notifyTelegram = h('input', { type: 'checkbox', checked: user.notify_telegram, disabled: !notifications.channels.telegram });

  const saveProfile = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить профиль');
  saveProfile.onclick = async () => {
    saveProfile.disabled = true;
    try {
      const updated = await api.patch('/api/auth/profile', {
        full_name: fullName.value.trim(),
        phone: phone.value.trim(),
        telegram_chat_id: telegram.value.trim(),
        language: language.value,
        notify_inapp: true,
        notify_email: notifyEmail.checked,
        notify_telegram: notifyTelegram.checked,
      });
      store.user = updated;
      toastOk('Профиль сохранён.');
    } catch (error) {
      toastError(error.message);
    } finally {
      saveProfile.disabled = false;
    }
  };

  const profileCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Личные данные')),
    h('div', { class: 'card-body' },
      h('div', { class: 'flex mb-2' },
        h('span', { class: 'avatar', style: { width: '48px', height: '48px', fontSize: '17px' } }, initials(user.full_name)),
        h('div', {},
          h('div', { style: { fontWeight: '600', fontSize: '16px' } }, user.full_name),
          h('div', { class: 'small muted' }, `${user.email} · ${ROLE_LABELS[user.role]}${user.position ? ` · ${user.position}` : ''}`)
        )
      ),
      field('ФИО', fullName, { required: true }),
      h('div', { class: 'form-row' },
        field('Телефон', phone),
        field('Язык интерфейса', language, { help: 'Основной язык системы — русский' })
      ),
      field('Telegram chat ID', telegram, {
        help: notifications.channels.telegram
          ? 'Напишите боту офиса, чтобы получить свой chat_id'
          : 'Telegram-бот не настроен администратором',
      }),
      saveProfile
    )
  );

  const notificationsCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Каналы уведомлений')),
    h('div', { class: 'card-body' },
      h('label', { class: 'checkbox' }, notifyInapp,
        h('span', {}, h('b', {}, 'Центр уведомлений в системе'), h('div', { class: 'small muted' }, 'Включён всегда — колокольчик в верхней панели'))),
      h('label', { class: 'checkbox' }, notifyEmail,
        h('span', {}, h('b', {}, 'Электронная почта'),
          h('div', { class: 'small muted' }, notifications.channels.email ? `Письма на ${user.email}` : 'SMTP-сервер не настроен администратором'))),
      h('label', { class: 'checkbox' }, notifyTelegram,
        h('span', {}, h('b', {}, 'Telegram'),
          h('div', { class: 'small muted' }, notifications.channels.telegram ? 'Мгновенные сообщения от бота офиса' : 'Бот не настроен администратором'))),
      h('div', { class: 'callout mt-2' },
        h('b', {}, 'Что приходит: '),
        'напоминания за 7, 3 и 1 день до срока этапа; уведомление о просрочке; новые проекты в вашем регионе; ' +
        'смена статуса; назначенные вам этапы; решения по заявкам на исправление; подтверждение визитов; ' +
        'упоминания в комментариях; еженедельная сводка по понедельникам.')
    )
  );

  // ---- Пароль ----
  const currentPassword = h('input', { type: 'password', autocomplete: 'current-password' });
  const newPassword = h('input', { type: 'password', autocomplete: 'new-password' });
  const repeatPassword = h('input', { type: 'password', autocomplete: 'new-password' });
  const passwordError = h('div', { class: 'callout danger hidden' });
  const changePassword = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сменить пароль');

  changePassword.onclick = async () => {
    passwordError.classList.add('hidden');
    if (newPassword.value !== repeatPassword.value) {
      passwordError.textContent = 'Новый пароль и подтверждение не совпадают';
      passwordError.classList.remove('hidden');
      return;
    }
    changePassword.disabled = true;
    try {
      await api.post('/api/auth/password', {
        current_password: currentPassword.value,
        new_password: newPassword.value,
      });
      currentPassword.value = newPassword.value = repeatPassword.value = '';
      toastOk('Пароль изменён. Остальные сессии завершены.');
    } catch (error) {
      passwordError.textContent = error.message;
      passwordError.classList.remove('hidden');
    } finally {
      changePassword.disabled = false;
    }
  };

  const passwordCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Пароль')),
    h('div', { class: 'card-body' },
      user.must_change_pwd
        ? h('div', { class: 'callout danger' }, 'Вы используете пароль, выданный администратором. Смените его.')
        : null,
      passwordError,
      field('Текущий пароль', currentPassword, { required: true }),
      field('Новый пароль', newPassword, { required: true, help: 'Не менее 10 символов, буквы и цифры' }),
      field('Повторите новый пароль', repeatPassword, { required: true }),
      changePassword
    )
  );

  // ---- Двухфакторная аутентификация ----
  const twoFactorCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Двухфакторная аутентификация'),
      h('span', { class: `tag ${user.totp_enabled ? 'tag-ok' : 'tag-warn'}` }, user.totp_enabled ? 'Подключена' : 'Не подключена')
    ),
    h('div', { class: 'card-body' },
      h('p', { class: 'small muted' },
        'Одноразовый код из приложения-аутентификатора (Google Authenticator, Microsoft Authenticator, FreeOTP) ' +
        'запрашивается при каждом входе. Рекомендуется ввиду коммерческой чувствительности данных офиса.'),
      me.require_2fa && !user.totp_enabled
        ? h('div', { class: 'callout danger' }, 'Политика безопасности требует подключить двухфакторную аутентификацию.')
        : null,
      user.totp_enabled
        ? h('button', { class: 'btn', onclick: () => disableTotp() }, 'Отключить 2FA')
        : h('button', { class: 'btn btn-primary', onclick: () => setupTotp() }, 'Подключить 2FA')
    )
  );

  async function setupTotp() {
    const data = await api.post('/api/auth/2fa/setup');
    const codeInput = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: '000000' });
    const errorBox = h('div', { class: 'callout danger hidden' });
    const confirmButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Подтвердить');

    const dialog = openModal({
      title: 'Подключение двухфакторной аутентификации',
      body: h('div', {},
        errorBox,
        h('p', {}, '1. Откройте приложение-аутентификатор и добавьте новую учётную запись вручную.'),
        h('p', {}, '2. Введите секретный ключ:'),
        h('div', { class: 'mono', style: { fontSize: '17px', letterSpacing: '.08em', padding: '11px', background: 'var(--surface-3)', borderRadius: '6px', wordBreak: 'break-all' } }, data.secret),
        h('p', { class: 'small muted mt-1' }, 'Либо используйте ссылку otpauth:', h('br'), h('span', { class: 'mono small', style: { wordBreak: 'break-all' } }, data.uri)),
        h('p', { class: 'mt-2' }, '3. Введите шестизначный код из приложения:'),
        field('Одноразовый код', codeInput, { required: true })
      ),
      footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), confirmButton),
    });

    confirmButton.onclick = async () => {
      errorBox.classList.add('hidden');
      try {
        await api.post('/api/auth/2fa/confirm', { code: codeInput.value.trim() });
        dialog.close();
        toastOk('Двухфакторная аутентификация подключена.');
        location.reload();
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove('hidden');
      }
    };
  }

  async function disableTotp() {
    const passwordInput = h('input', { type: 'password', autocomplete: 'current-password' });
    const errorBox = h('div', { class: 'callout danger hidden' });
    const confirmButton = h('button', { class: 'btn btn-danger', type: 'button' }, 'Отключить');
    const dialog = openModal({
      title: 'Отключение двухфакторной аутентификации',
      size: 'narrow',
      body: h('div', {}, errorBox, field('Подтвердите текущий пароль', passwordInput, { required: true })),
      footer: frag(h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Отмена'), confirmButton),
    });
    confirmButton.onclick = async () => {
      try {
        await api.post('/api/auth/2fa/disable', { password: passwordInput.value });
        dialog.close();
        toastOk('Двухфакторная аутентификация отключена.');
        location.reload();
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove('hidden');
      }
    };
  }

  container.append(
    h('div', { class: 'page-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Профиль пользователя'),
        h('div', { class: 'subtitle' }, `Последний вход: ${formatDateTime(user.last_login_at)}`)
      )
    ),
    h('div', { class: 'grid grid-2' },
      column(profileCard, passwordCard),
      column(notificationsCard, twoFactorCard)
    )
  );
  return container;
}

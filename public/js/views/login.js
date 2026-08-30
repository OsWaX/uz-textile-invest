// ==========================================================================
//  Страница входа в систему (п. 2.4 ТЗ).
// ==========================================================================
import { api } from '../api.js';
import { h, field } from '../ui.js';

const DEMO_ACCOUNTS = [
  { email: 'admin@textile.gov.uz', label: 'Администратор — руководитель Проектного офиса' },
  { email: 'europe@textile.gov.uz', label: 'Проектный менеджер по Европе' },
  { email: 'observer@textile.gov.uz', label: 'Наблюдатель (только просмотр)' },
];

export function renderLogin({ onSuccess, message = '' }) {
  const emailInput = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, placeholder: 'ivanov@textile.gov.uz' });
  const passwordInput = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••••' });
  const codeInput = h('input', { type: 'text', name: 'code', inputmode: 'numeric', maxlength: 6, placeholder: '000000', autocomplete: 'one-time-code' });
  const codeField = h('div', { class: 'hidden' }, field('Одноразовый код из приложения-аутентификатора', codeInput, { required: true }));
  const errorBox = h('div', { class: `callout danger ${message ? '' : 'hidden'}` }, message);
  const submitButton = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Войти в систему');

  const form = h('form', {
    class: 'login-form',
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      errorBox.classList.add('hidden');
      submitButton.disabled = true;
      submitButton.textContent = 'Проверка…';
      try {
        const result = await api.login({
          email: emailInput.value.trim(),
          password: passwordInput.value,
          code: codeInput.value.trim(),
        });
        if (result.step === '2fa') {
          codeField.classList.remove('hidden');
          codeInput.focus();
          errorBox.textContent = result.message;
          errorBox.className = 'callout info';
          return;
        }
        await onSuccess(result);
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.className = 'callout danger';
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Войти в систему';
      }
    },
  },
    h('h2', {}, 'Вход в систему'),
    h('p', { class: 'hint' }, 'Учётные записи создаёт администратор. Самостоятельная регистрация не предусмотрена.'),
    errorBox,
    field('Адрес электронной почты', emailInput, { required: true }),
    field('Пароль', passwordInput, { required: true }),
    codeField,
    submitButton,
    h('div', { class: 'demo-box' },
      h('div', {}, h('b', {}, 'Демонстрационные учётные записи'), ' — пароль ', h('code', {}, 'Parol2026!')),
      h('div', { class: 'demo-accounts' },
        DEMO_ACCOUNTS.map((account) =>
          h('button', {
            type: 'button',
            onclick: () => {
              emailInput.value = account.email;
              passwordInput.value = 'Parol2026!';
              passwordInput.focus();
            },
          }, `${account.email} — ${account.label}`)
        )
      )
    )
  );

  return h('div', { class: 'login-page' },
    h('div', { class: 'login-hero' },
      h('div', {},
        h('div', { class: 'emblem' }, '🧵'),
        h('div', { class: 'ministry' }, 'Министерство инвестиций, промышленности и торговли Республики Узбекистан'),
        h('h1', {}, 'Портал Проектного офиса'),
        h('p', { class: 'lead' },
          'Единое рабочее пространство Проектного офиса заместителя министра по текстильной промышленности: ' +
          'экспортные и инвестиционные проекты, соглашения, дорожные карты и зарубежные визиты по девяти регионам мира.'
        ),
        h('ul', {},
          h('li', {}, 'Реестр проектов и соглашений с дорожными картами и сроками'),
          h('li', {}, 'Справочник иностранных компаний и контактных лиц'),
          h('li', {}, 'Планирование визитов, делегаций и программ встреч'),
          h('li', {}, 'Аналитика для руководства и выгрузка отчётов в Excel'),
          h('li', {}, 'Напоминания о сроках и полный журнал действий')
        )
      ),
      h('div', { class: 'foot' }, 'Данные системы размещаются на серверах на территории Республики Узбекистан.')
    ),
    h('div', { class: 'login-form-wrap' }, form)
  );
}

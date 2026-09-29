'use strict';
/**
 * Панель управления магазином Jayron Kids: заказы, товары и остатки,
 * фотографии, промокоды, цены доставки. Работает с API этого же сервера.
 */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const sum = (value) => `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} сум`;
  const date = (value) => new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const STATUS = { new: 'Новый', confirmed: 'Подтверждён', shipped: 'Передан в доставку', delivered: 'Доставлен', cancelled: 'Отменён' };
  const ACTIONS = { confirmed: 'Подтвердить', shipped: 'Передать в доставку', delivered: 'Доставлен', cancelled: 'Отменить заказ' };
  const PAYMENT_STATUS = { pending: 'Ожидает оплаты', paid: 'Оплачен', cancelled: 'Оплата отменена', refunded: 'Возврат' };
  const PAYMENT = { cash: 'Наличные', payme: 'Payme', click: 'Click' };
  const DELIVERY = { courier: 'Курьер', post: 'Почта / BTS', pickup: 'Самовывоз' };
  const HISTORY = { ...STATUS, paid: 'Оплачен' };
  const TX_STATE = { 1: 'создан', 2: 'проведён', [-1]: 'отменён', [-2]: 'возврат' };
  const PROVIDERS = { payme: 'Payme', click: 'Click', demo: 'учебная оплата' };
  const NOTES = { customer: 'покупателем в приложении', unpaid: 'не оплачен вовремя', cash: 'наличными при получении', payme: 'через Payme', click: 'через Click' };
  const KINDS = {
    bodysuit: 'Боди', romper: 'Слип / комбинезон', tshirt: 'Футболка', sweatshirt: 'Свитшот', hoodie: 'Худи',
    set: 'Костюм', pants: 'Брюки', shorts: 'Шорты', dress: 'Платье', pajama: 'Пижама', jacket: 'Куртка', cap: 'Кепка',
  };
  const GENDERS = { unisex: 'Для всех', boy: 'Мальчикам', girl: 'Девочкам' };
  const ERRORS = {
    invalid_password: 'Неверный пароль',
    too_many_attempts: 'Слишком много попыток. Подождите 15 минут',
    invalid_slug: 'Адрес товара: только латинские буквы, цифры и дефис',
    slug_taken: 'Товар с таким адресом уже есть',
    invalid_category: 'Выберите категорию',
    name_required: 'Заполните название на двух языках',
    invalid_price: 'Цена — целое число сумов больше нуля',
    invalid_mxik: 'ИКПУ (MXIK) — 17 цифр',
    invalid_gender: 'Выберите, для кого товар',
    invalid_kind: 'Выберите вид изделия',
    invalid_variant: 'Проверьте варианты: размер, код цвета латиницей, цвет #RRGGBB, названия цвета, остаток',
    sku_taken: 'Такой артикул уже есть у другого товара',
    invalid_image: 'Файл не похож на изображение',
    invalid_image_type: 'Поддерживаются JPG, PNG и WebP',
    payload_too_large: 'Файл слишком большой',
    invalid_transition: 'Такой переход статуса невозможен',
    invalid_promo_code: 'Промокод: 3–30 латинских букв или цифр',
    invalid_promo_value: 'Скидка: процент от 1 до 90 или сумма больше нуля',
    promo_exists: 'Такой промокод уже есть',
    order_not_found: 'Заказ не найден',
    product_not_found: 'Товар не найден',
  };

  let token = '';
  try { token = sessionStorage.getItem('jk-admin') || ''; } catch { /* хранилище недоступно */ }
  let categories = [];
  let currentTab = 'orders';
  const ordersFilter = { status: 'new', q: '' };

  // ------------------------------------------------------------------ API
  async function api(method, url, body, { contentType } = {}) {
    const headers = { authorization: `Bearer ${token}` };
    let payload;
    if (contentType) {
      headers['content-type'] = contentType;
      payload = body;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(url, { method, headers, body: payload });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && url !== '/api/admin/login') {
      showLogin();
      throw new Error('Сессия истекла — войдите снова');
    }
    if (!response.ok) throw new Error(ERRORS[data.error] || `Ошибка: ${data.error || response.status}`);
    return data;
  }

  let toastTimer;
  function toast(message, bad = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('bad', bad);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  const fail = (error) => toast(error.message, true);

  /** Цвета образцов задаются через DOM: политика безопасности запрещает атрибуты style. */
  function paintSwatches(root) {
    $$('[data-color]', root).forEach((el) => { el.style.background = el.dataset.color; });
  }

  // ------------------------------------------------------------------ вход
  function showLogin() {
    token = '';
    try { sessionStorage.removeItem('jk-admin'); } catch { /* ignore */ }
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-form [name=password]').focus();
  }

  async function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    categories = await api('GET', '/api/admin/categories');
    await Promise.all([renderSummary(), renderTab()]);
  }

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = event.target.password.value;
    $('#login-error').textContent = '';
    try {
      const data = await api('POST', '/api/admin/login', { password });
      token = data.token;
      try { sessionStorage.setItem('jk-admin', token); } catch { /* ignore */ }
      event.target.reset();
      await showApp();
    } catch (error) {
      $('#login-error').textContent = error.message;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/admin/logout').catch(() => {});
    showLogin();
  });

  $('#tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    currentTab = button.dataset.tab;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b === button));
    renderTab().catch(fail);
  });

  const renderTab = () => ({ orders: renderOrders, products: renderProducts, promo: renderPromo, delivery: renderDelivery }[currentTab])();

  // ------------------------------------------------------------------ сводка
  async function renderSummary() {
    const s = await api('GET', '/api/admin/summary');
    $('#summary').innerHTML = `
      <div class="stat new"><b>${s.newOrders}</b><span>новых заказов</span></div>
      <div class="stat progress"><b>${s.inProgress}</b><span>в работе</span></div>
      <div class="stat today"><b>${esc(sum(s.paidToday))}</b><span>оплачено сегодня</span></div>
      <div class="stat month"><b>${esc(sum(s.paid30d))}</b><span>оплачено за 30 дней</span></div>
      ${s.lowStock.length ? `
      <details class="low-stock">
        <summary>Заканчиваются на складе: ${s.lowStock.length}</summary>
        <ul>${s.lowStock.map((v) => `<li>${esc(v.productName)} — ${esc(v.color)}, ${esc(v.size)}: <b>${v.stock}</b> шт.</li>`).join('')}</ul>
      </details>` : ''}`;
  }

  // ------------------------------------------------------------------ заказы
  async function renderOrders() {
    const params = new URLSearchParams();
    if (ordersFilter.status) params.set('status', ordersFilter.status);
    if (ordersFilter.q) params.set('q', ordersFilter.q);
    const list = await api('GET', `/api/admin/orders?${params}`);
    const chips = [['', 'Все'], ...Object.entries(STATUS)]
      .map(([code, label]) => `<button type="button" class="chip ${ordersFilter.status === code ? 'active' : ''}" data-status="${code}">${label}</button>`)
      .join('');
    $('#view').innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="chips">${chips}</div>
          <input type="search" id="order-search" placeholder="Номер заказа или телефон" value="${esc(ordersFilter.q)}">
        </div>
        <div class="table-wrap">
        ${list.length ? `<table>
          <thead><tr><th>№</th><th>Дата</th><th>Получатель</th><th class="hide-sm">Доставка</th><th>Сумма</th><th>Оплата</th><th>Статус</th></tr></thead>
          <tbody>${list.map((o) => `
            <tr class="clickable" data-order="${o.id}" tabindex="0">
              <td><b>${o.id}</b></td>
              <td class="nowrap">${esc(date(o.createdAt))}</td>
              <td>${esc(o.recipientName)}<br><span class="muted nowrap">${esc(o.recipientPhoneFormatted)}</span></td>
              <td class="hide-sm">${esc(DELIVERY[o.deliveryMethod])}</td>
              <td class="nowrap"><b>${esc(sum(o.total))}</b><br><span class="muted">${o.itemCount} шт.</span></td>
              <td>${esc(PAYMENT[o.paymentMethod])}<br><span class="badge ${o.paymentStatus}">${PAYMENT_STATUS[o.paymentStatus]}</span></td>
              <td><span class="badge ${o.status}">${STATUS[o.status]}</span></td>
            </tr>`).join('')}
          </tbody></table>` : '<p class="empty">Заказов нет</p>'}
        </div>
      </div>`;

    $$('.chip', $('#view')).forEach((chip) => chip.addEventListener('click', () => {
      ordersFilter.status = chip.dataset.status;
      renderOrders().catch(fail);
    }));
    let searchTimer;
    $('#order-search').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        ordersFilter.q = event.target.value.trim();
        renderOrders().then(() => {
          const input = $('#order-search');
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }).catch(fail);
      }, 350);
    });
    $$('tr[data-order]').forEach((row) => {
      const open = () => openOrder(row.dataset.order).catch(fail);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
    });
  }

  function openModal(title, html) {
    const modal = $('#modal');
    $('#modal-body').innerHTML = `
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="btn ghost small" data-close>Закрыть</button></div>
      <div class="modal-content">${html}</div>`;
    $('[data-close]', modal).addEventListener('click', () => modal.close());
    paintSwatches(modal);
    if (!modal.open) modal.showModal();
    return $('.modal-content', modal);
  }

  async function openOrder(id) {
    const o = await api('GET', `/api/admin/orders/${id}`);
    const where = o.deliveryMethod === 'pickup'
      ? 'Самовывоз из магазина'
      : [o.regionName, o.city, o.address].filter(Boolean).map(esc).join(', ');
    const body = openModal(`Заказ №${o.id}`, `
      <div class="row">
        <span class="badge ${o.status}">${STATUS[o.status]}</span>
        <span class="badge ${o.paymentStatus}">${PAYMENT_STATUS[o.paymentStatus]} · ${esc(PAYMENT[o.paymentMethod])}</span>
        <span class="muted">${esc(date(o.createdAt))}</span>
      </div>
      <div class="grid two">
        <div class="section">
          <h3>Получатель</h3>
          <p>${esc(o.recipientName)}<br><a href="tel:+${esc(o.recipientPhone)}">${esc(o.recipientPhoneFormatted)}</a></p>
          <p class="muted">Аккаунт: ${esc(o.customer.phone)}${o.customer.name ? ` · ${esc(o.customer.name)}` : ''}</p>
        </div>
        <div class="section">
          <h3>${esc(DELIVERY[o.deliveryMethod])}</h3>
          <p>${where}</p>
          ${o.comment ? `<p class="muted">Комментарий: ${esc(o.comment)}</p>` : ''}
        </div>
      </div>
      <div class="section">
        <h3>Товары</h3>
        <ul class="lines">${o.items.map((i) => `
          <li><span><span class="swatch" data-color="${esc(i.color.hex)}"></span> ${esc(i.name.ru)} — ${esc(i.color.name.ru)}, размер ${esc(i.size)} × ${i.quantity}</span>
          <b class="nowrap">${esc(sum(i.price * i.quantity))}</b></li>`).join('')}
        </ul>
        <hr>
        <div class="totals">
          <div><span>Товары</span><span>${esc(sum(o.subtotal))}</span></div>
          ${o.discount ? `<div><span>Скидка${o.promoCode ? ` (${esc(o.promoCode)})` : ''}</span><span>−${esc(sum(o.discount))}</span></div>` : ''}
          <div><span>Доставка</span><span>${o.deliveryPrice ? esc(sum(o.deliveryPrice)) : 'бесплатно'}</span></div>
          <div class="grand"><span>Итого</span><span>${esc(sum(o.total))}</span></div>
        </div>
      </div>
      <div class="section">
        <h3>История</h3>
        <ul class="timeline">${o.history.map((h) => `
          <li><span class="muted">${esc(date(h.at))}</span> — ${esc(HISTORY[h.status] || h.status)}${h.note ? `: ${esc(NOTES[h.note] || h.note)}` : ''}</li>`).join('')}
        </ul>
        ${o.payments.length ? `<p class="muted">Платежи: ${o.payments.map((p) => `${esc(PROVIDERS[p.provider] || p.provider)} — ${esc(sum(p.amount))}, ${TX_STATE[p.state] || p.state}`).join('; ')}</p>` : ''}
      </div>
      ${o.transitions.length ? `
      <div class="section">
        <h3>Изменить статус</h3>
        <label class="field">Комментарий к смене статуса (необязательно)<input id="status-note" maxlength="300"></label>
        <div class="row">
          ${o.transitions.map((s) => `<button type="button" class="btn ${s === 'cancelled' ? 'danger' : 'primary'}" data-status="${s}">${ACTIONS[s]}</button>`).join('')}
        </div>
      </div>` : ''}`);

    $$('button[data-status]', body).forEach((button) => button.addEventListener('click', async () => {
      const status = button.dataset.status;
      if (status === 'cancelled' && !confirm('Отменить заказ? Товар вернётся на склад.')) return;
      try {
        await api('PATCH', `/api/admin/orders/${o.id}`, { status, note: $('#status-note').value });
        toast(`Заказ №${o.id}: ${STATUS[status].toLowerCase()}`);
        await Promise.all([openOrder(o.id), renderSummary(), renderOrders()]);
      } catch (error) { fail(error); }
    }));
  }

  // ------------------------------------------------------------------ товары
  async function renderProducts() {
    const list = await api('GET', '/api/admin/products');
    $('#view').innerHTML = `
      <div class="card">
        <div class="toolbar spread">
          <h2>Товары: ${list.length}</h2>
          <button type="button" class="btn primary" id="new-product">+ Новый товар</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Название</th><th class="hide-sm">Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th></tr></thead>
          <tbody>${list.map((p) => `
            <tr class="clickable" data-product="${p.id}" tabindex="0">
              <td>${p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="">` : '<span class="thumb"></span>'}</td>
              <td><b>${esc(p.name_ru)}</b><br><span class="muted">${esc(p.name_uz)} · ${esc(KINDS[p.kind] || p.kind)}</span></td>
              <td class="hide-sm">${esc(p.category)}</td>
              <td class="nowrap">${esc(sum(p.price))}${p.old_price ? `<br><s class="muted">${esc(sum(p.old_price))}</s>` : ''}</td>
              <td>${p.stock} шт.<br><span class="muted">${p.variant_count} вариантов</span></td>
              <td>${p.is_active ? '<span class="badge paid">В продаже</span>' : '<span class="badge off">Скрыт</span>'}
                ${p.is_new ? '<span class="badge confirmed">Новинка</span>' : ''}${p.is_hit ? '<span class="badge shipped">Хит</span>' : ''}
                ${p.mxik ? '' : '<br><span class="muted">нет ИКПУ</span>'}</td>
            </tr>`).join('')}
          </tbody></table></div>
      </div>`;
    $('#new-product').addEventListener('click', () => openProduct(null).catch(fail));
    $$('tr[data-product]').forEach((row) => {
      const open = () => openProduct(row.dataset.product).catch(fail);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
    });
  }

  const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

  function variantRow(v = {}) {
    return `<tr>
      <td><input name="colorCode" value="${esc(v.color_code || '')}" placeholder="sky" size="7" aria-label="Код цвета"></td>
      <td><input type="color" name="colorHex" value="${esc(v.color_hex || '#4FB6F2')}" aria-label="Цвет"></td>
      <td><input name="colorNameUz" value="${esc(v.color_name_uz || '')}" placeholder="Osmon rang" aria-label="Цвет (узб.)"></td>
      <td><input name="colorNameRu" value="${esc(v.color_name_ru || '')}" placeholder="Голубой" aria-label="Цвет (рус.)"></td>
      <td><input name="size" value="${esc(v.size || '')}" placeholder="104" size="4" aria-label="Размер"></td>
      <td><input name="stock" type="number" min="0" value="${esc(v.stock ?? 0)}" size="4" aria-label="Остаток"></td>
      <td><button type="button" class="btn ghost small" data-remove-row aria-label="Удалить строку">✕</button></td>
    </tr>`;
  }

  async function openProduct(id) {
    const p = id ? await api('GET', `/api/admin/products/${id}`) : null;
    const v = (key, fallback = '') => esc(p ? (p[key] ?? fallback) : fallback);
    const body = openModal(p ? p.name.ru : 'Новый товар', `
      <form id="product-form" class="grid">
        <div class="grid two">
          <label class="field">Название (узбекский)<input name="nameUz" required maxlength="120" value="${esc(p?.name.uz)}"></label>
          <label class="field">Название (русский)<input name="nameRu" required maxlength="120" value="${esc(p?.name.ru)}"></label>
        </div>
        <div class="grid three">
          <label class="field">Адрес в каталоге (латиницей)<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${v('slug')}" placeholder="futbolka-yulduz"></label>
          <label class="field">Категория<select name="categoryId">${categories.map((c) => option(c.id, c.name_ru, p?.categoryId === c.id)).join('')}</select></label>
          <label class="field">Вид изделия<select name="kind">${Object.entries(KINDS).map(([k, l]) => option(k, l, p?.kind === k)).join('')}</select></label>
        </div>
        <div class="grid three">
          <label class="field">Для кого<select name="gender">${Object.entries(GENDERS).map(([k, l]) => option(k, l, (p?.gender || 'unisex') === k)).join('')}</select></label>
          <label class="field">Цена, сум<input name="price" type="number" min="1" step="1000" required value="${v('price')}"></label>
          <label class="field">Старая цена (для скидки)<input name="oldPrice" type="number" min="1" step="1000" value="${v('oldPrice')}"></label>
        </div>
        <div class="grid two">
          <label class="field">Описание (узбекский)<textarea name="descriptionUz" maxlength="2000">${esc(p?.description.uz)}</textarea></label>
          <label class="field">Описание (русский)<textarea name="descriptionRu" maxlength="2000">${esc(p?.description.ru)}</textarea></label>
          <label class="field">Состав (узбекский)<input name="materialUz" maxlength="300" value="${esc(p?.material.uz)}"></label>
          <label class="field">Состав (русский)<input name="materialRu" maxlength="300" value="${esc(p?.material.ru)}"></label>
        </div>
        <div class="grid three">
          <label class="field">ИКПУ (MXIK) для чека<input name="mxik" inputmode="numeric" pattern="\\d{17}" value="${v('mxik')}" placeholder="17 цифр с tasnif.soliq.uz"></label>
          <label class="field">Код упаковки<input name="packageCode" inputmode="numeric" value="${v('packageCode')}"></label>
          <label class="field">Порядок в каталоге<input name="sort" type="number" value="${v('sort', 0)}"></label>
        </div>
        <div class="row">
          <label class="field check"><input type="checkbox" name="isActive" ${!p || p.isActive ? 'checked' : ''}> В продаже</label>
          <label class="field check"><input type="checkbox" name="isNew" ${p?.isNew ? 'checked' : ''}> Новинка</label>
          <label class="field check"><input type="checkbox" name="isHit" ${p?.isHit ? 'checked' : ''}> Хит продаж</label>
        </div>
        <div class="row"><button class="btn primary" type="submit">${p ? 'Сохранить' : 'Создать товар'}</button></div>
      </form>
      ${p ? `
      <div class="section">
        <h3>Фотографии</h3>
        <div class="images">${p.images.map((url) => `
          <figure><img src="${esc(url)}" alt=""><button type="button" class="btn danger small" data-remove-image="${esc(url)}" aria-label="Удалить фото">✕</button></figure>`).join('') || '<p class="muted">Фотографий пока нет — в приложении показывается рисунок изделия.</p>'}
        </div>
        <label class="btn ghost small">+ Добавить фото<input type="file" id="image-input" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
        <p class="muted">JPG, PNG или WebP до 5 МБ. Лучше всего — квадратные фото на светлом фоне.</p>
      </div>
      <div class="section">
        <h3>Цвета, размеры и остатки</h3>
        <div class="table-wrap"><table class="variants">
          <thead><tr><th>Код цвета</th><th>Цвет</th><th>Название (узб.)</th><th>Название (рус.)</th><th>Размер</th><th>Остаток</th><th></th></tr></thead>
          <tbody id="variant-rows">${p.variantRows.map(variantRow).join('')}</tbody>
        </table></div>
        <div class="row">
          <button type="button" class="btn ghost small" id="add-variant">+ Строка</button>
          <input id="bulk-sizes" placeholder="Размеры через запятую: 92,98,104" size="28">
          <button type="button" class="btn ghost small" id="bulk-add">+ Цвет с этими размерами</button>
        </div>
        <div class="row"><button type="button" class="btn primary" id="save-variants">Сохранить остатки</button></div>
      </div>` : '<p class="muted">Фотографии, цвета и размеры добавляются после создания товара.</p>'}`);

    $('#product-form', body).addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = event.target;
      const data = {
        nameUz: f.nameUz.value, nameRu: f.nameRu.value, slug: f.slug.value,
        categoryId: Number(f.categoryId.value), kind: f.kind.value, gender: f.gender.value,
        price: Number(f.price.value), oldPrice: f.oldPrice.value ? Number(f.oldPrice.value) : null,
        descriptionUz: f.descriptionUz.value, descriptionRu: f.descriptionRu.value,
        materialUz: f.materialUz.value, materialRu: f.materialRu.value,
        mxik: f.mxik.value, packageCode: f.packageCode.value, sort: Number(f.sort.value) || 0,
        isActive: f.isActive.checked, isNew: f.isNew.checked, isHit: f.isHit.checked,
      };
      try {
        const saved = p
          ? await api('PATCH', `/api/admin/products/${p.id}`, data)
          : await api('POST', '/api/admin/products', data);
        toast(p ? 'Товар сохранён' : 'Товар создан — добавьте фото и размеры');
        await Promise.all([openProduct(saved.id), renderProducts()]);
      } catch (error) { fail(error); }
    });

    if (!p) return;

    $('#image-input', body).addEventListener('change', async (event) => {
      try {
        for (const file of event.target.files) {
          await api('POST', `/api/admin/products/${p.id}/images`, file, { contentType: file.type });
        }
        toast('Фото добавлены');
        await Promise.all([openProduct(p.id), renderProducts()]);
      } catch (error) { fail(error); }
    });
    $$('[data-remove-image]', body).forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Удалить фото?')) return;
      try {
        await api('DELETE', `/api/admin/products/${p.id}/images?url=${encodeURIComponent(button.dataset.removeImage)}`);
        await Promise.all([openProduct(p.id), renderProducts()]);
      } catch (error) { fail(error); }
    }));

    const rows = $('#variant-rows', body);
    rows.addEventListener('click', (event) => {
      if (event.target.closest('[data-remove-row]')) event.target.closest('tr').remove();
    });
    $('#add-variant', body).addEventListener('click', () => rows.insertAdjacentHTML('beforeend', variantRow()));
    $('#bulk-add', body).addEventListener('click', () => {
      const sizes = $('#bulk-sizes', body).value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!sizes.length) { toast('Укажите размеры через запятую', true); return; }
      rows.insertAdjacentHTML('beforeend', sizes.map((size) => variantRow({ size })).join(''));
    });
    $('#save-variants', body).addEventListener('click', async () => {
      const variants = $$('tr', rows).map((tr) => ({
        colorCode: $('[name=colorCode]', tr).value,
        colorHex: $('[name=colorHex]', tr).value,
        colorNameUz: $('[name=colorNameUz]', tr).value,
        colorNameRu: $('[name=colorNameRu]', tr).value,
        size: $('[name=size]', tr).value,
        stock: Number($('[name=stock]', tr).value),
      }));
      try {
        await api('PUT', `/api/admin/products/${p.id}/variants`, { variants });
        toast('Остатки сохранены');
        await Promise.all([openProduct(p.id), renderProducts(), renderSummary()]);
      } catch (error) { fail(error); }
    });
  }

  // ------------------------------------------------------------------ промокоды
  async function renderPromo() {
    const list = await api('GET', '/api/admin/promo-codes');
    $('#view').innerHTML = `
      <div class="card">
        <h2>Промокоды</h2>
        <form id="promo-form" class="toolbar">
          <input name="code" required placeholder="Код, например YOZ2026" maxlength="30">
          <select name="kind">${option('percent', 'Процент')}${option('fixed', 'Сумма, сум')}</select>
          <input name="value" type="number" min="1" required placeholder="Скидка">
          <input name="minTotal" type="number" min="0" placeholder="Мин. сумма заказа">
          <input name="maxUses" type="number" min="1" placeholder="Лимит использований">
          <input name="endsAt" type="date" aria-label="Действует до">
          <button class="btn primary" type="submit">Создать</button>
        </form>
        <div class="table-wrap">${list.length ? `<table>
          <thead><tr><th>Код</th><th>Скидка</th><th>От суммы</th><th>Использован</th><th>До</th><th></th></tr></thead>
          <tbody>${list.map((p) => `<tr>
            <td><b>${esc(p.code)}</b></td>
            <td>${p.kind === 'percent' ? `${p.value}%` : esc(sum(p.value))}</td>
            <td>${p.minTotal ? esc(sum(p.minTotal)) : '—'}</td>
            <td>${p.usedCount}${p.maxUses ? ` из ${p.maxUses}` : ''}</td>
            <td>${p.endsAt ? esc(new Date(p.endsAt).toLocaleDateString('ru-RU')) : 'бессрочно'}</td>
            <td><button type="button" class="btn small ${p.isActive ? 'ghost' : 'primary'}" data-toggle="${esc(p.code)}" data-active="${p.isActive}">
              ${p.isActive ? 'Выключить' : 'Включить'}</button></td>
          </tr>`).join('')}</tbody></table>` : '<p class="empty">Промокодов нет</p>'}</div>
      </div>`;
    $('#promo-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = event.target;
      try {
        await api('POST', '/api/admin/promo-codes', {
          code: f.code.value, kind: f.kind.value, value: Number(f.value.value),
          minTotal: Number(f.minTotal.value) || 0, maxUses: f.maxUses.value ? Number(f.maxUses.value) : null,
          endsAt: f.endsAt.value ? `${f.endsAt.value}T23:59:59+05:00` : null,
        });
        toast('Промокод создан');
        await renderPromo();
      } catch (error) { fail(error); }
    });
    $$('[data-toggle]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/admin/promo-codes/${encodeURIComponent(button.dataset.toggle)}`, { isActive: button.dataset.active !== 'true' });
        await renderPromo();
      } catch (error) { fail(error); }
    }));
  }

  // ------------------------------------------------------------------ доставка
  async function renderDelivery() {
    const regions = await api('GET', '/api/admin/regions');
    $('#view').innerHTML = `
      <div class="card">
        <h2>Стоимость доставки</h2>
        <p class="muted">Пустая цена курьера — курьерской доставки в регион нет. Бесплатная доставка от суммы задаётся в настройках сервера.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Регион</th><th>Курьер, сум</th><th>Почта / BTS, сум</th><th>Срок, дней</th><th></th></tr></thead>
          <tbody>${regions.map((r) => `<tr data-region="${esc(r.code)}">
            <td>${esc(r.name.ru)}<br><span class="muted">${esc(r.name.uz)}</span></td>
            <td><input name="courierPrice" type="number" min="0" step="1000" value="${r.courierPrice ?? ''}" aria-label="Курьер"></td>
            <td><input name="postPrice" type="number" min="0" step="1000" value="${r.postPrice}" aria-label="Почта"></td>
            <td><input name="postDays" value="${esc(r.postDays)}" size="5" aria-label="Срок"></td>
            <td><button type="button" class="btn ghost small" data-save-region>Сохранить</button></td>
          </tr>`).join('')}</tbody></table></div>
      </div>`;
    $$('[data-save-region]').forEach((button) => button.addEventListener('click', async () => {
      const tr = button.closest('tr');
      try {
        await api('PATCH', `/api/admin/regions/${tr.dataset.region}`, {
          courierPrice: $('[name=courierPrice]', tr).value === '' ? null : Number($('[name=courierPrice]', tr).value),
          postPrice: Number($('[name=postPrice]', tr).value),
          postDays: $('[name=postDays]', tr).value,
        });
        toast('Цены доставки сохранены');
      } catch (error) { fail(error); }
    }));
  }

  // ------------------------------------------------------------------ запуск
  if (token) showApp().catch(() => showLogin());
  else showLogin();
})();

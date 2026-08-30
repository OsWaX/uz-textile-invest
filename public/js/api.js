// ==========================================================================
//  Обращения к серверному API.
// ==========================================================================

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body = null, options = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение к сети.');
  }

  if (response.status === 401 && !options.skipAuthRedirect) {
    onUnauthorized?.();
    throw new ApiError(401, 'Сессия истекла. Войдите в систему заново.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, `Ошибка ${response.status}`);
    return response;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error || `Ошибка ${response.status}`, payload.details);
  return payload;
}

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  query,
  get: (path, params) => request('GET', `${path}${query(params)}`),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  delete: (path) => request('DELETE', path),

  // --- Аутентификация ---
  login: (payload) => request('POST', '/api/auth/login', payload, { skipAuthRedirect: true }),
  logout: () => request('POST', '/api/auth/logout', {}),
  me: () => request('GET', '/api/auth/me', null, { skipAuthRedirect: true }),

  // --- Справочники ---
  reference: () => request('GET', '/api/reference'),

  // --- Проекты ---
  projects: (params) => request('GET', `/api/projects${query(params)}`),
  project: (id) => request('GET', `/api/projects/${id}`),

  // --- Компании ---
  companies: (params) => request('GET', `/api/companies${query(params)}`),
  company: (id) => request('GET', `/api/companies/${id}`),
  similarCompanies: (name) => request('GET', `/api/companies/similar${query({ name })}`),

  // --- Визиты ---
  visits: (params) => request('GET', `/api/visits${query(params)}`),
  visit: (id) => request('GET', `/api/visits/${id}`),

  // --- Аналитика ---
  dashboard: (params) => request('GET', `/api/dashboard${query(params)}`),
  managers: () => request('GET', '/api/dashboard/managers'),
  kanban: (params) => request('GET', `/api/kanban${query(params)}`),
  calendar: (params) => request('GET', `/api/calendar${query(params)}`),
  search: (q) => request('GET', `/api/search${query({ q })}`),

  // --- Уведомления ---
  notifications: (params) => request('GET', `/api/notifications${query(params)}`),

  // --- Файлы ---
  upload(entityType, entityId, files) {
    const form = new FormData();
    form.set('entity_type', entityType);
    form.set('entity_id', String(entityId));
    for (const file of files) form.append('file', file, file.name);
    return request('POST', '/api/attachments', form);
  },

  /** Скачивание файла выгрузки. */
  async download(path, params, fallbackName) {
    const response = await fetch(`${path}${query(params)}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(response.status, payload.error || 'Не удалось сформировать файл');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = match ? match[1] : fallbackName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

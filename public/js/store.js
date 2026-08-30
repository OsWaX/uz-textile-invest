// ==========================================================================
//  Состояние приложения: текущий пользователь, права, справочники.
// ==========================================================================
import { api } from './api.js';

export const store = {
  user: null,
  permissions: {},
  reference: null,
  unread: 0,

  can(permission) { return Boolean(this.permissions[permission]); },
  get isAdmin() { return this.user?.role === 'admin'; },
  get isViewer() { return this.user?.role === 'viewer'; },

  async loadReference(force = false) {
    if (this.reference && !force) return this.reference;
    this.reference = await api.reference();
    return this.reference;
  },

  /** Поиск значения справочника по коду. */
  dict(kind, code) {
    const source = {
      sector: this.reference?.sectors,
      record_type: this.reference?.record_types,
      project_status: this.reference?.project_statuses,
      visit_status: this.reference?.visit_statuses,
      meeting_status: this.reference?.meeting_statuses,
      currency: this.reference?.currencies,
    }[kind] || [];
    return source.find((item) => item.code === code) || null;
  },

  country(id) { return this.reference?.countries.find((c) => c.id === Number(id)) || null; },
  region(id) { return this.reference?.regions.find((r) => r.id === Number(id)) || null; },
  userById(id) { return this.reference?.users.find((u) => u.id === Number(id)) || null; },

  /** Активные сотрудники, которые могут быть ответственными. */
  get staff() { return (this.reference?.users || []).filter((u) => u.role !== 'viewer'); },
};

'use strict';
/**
 * Матрица прав доступа (раздел 2.2 ТЗ). Проверки выполняются на сервере,
 * интерфейс лишь скрывает недоступные действия.
 *
 * Роли: admin — полный доступ; team — проектный менеджер; viewer — только чтение.
 */
const { forbidden } = require('./lib/http');

const ROLES = ['admin', 'team', 'viewer'];

const PERMISSIONS = {
  // Проекты и соглашения
  'project.view':          ['admin', 'team', 'viewer'],
  'project.create':        ['admin', 'team'],
  'project.edit':          ['admin'],
  'project.delete':        ['admin'],
  'project.status_change': ['admin', 'team'],   // team — только по своим записям
  'project.comment':       ['admin', 'team'],

  // Дорожная карта
  'step.view':      ['admin', 'team', 'viewer'],
  'step.create':    ['admin', 'team'],
  'step.edit':      ['admin'],
  'step.delete':    ['admin'],
  'step.complete':  ['admin', 'team'],          // team — только по своим этапам

  // Компании
  'company.view':   ['admin', 'team', 'viewer'],
  'company.create': ['admin', 'team'],
  'company.edit':   ['admin'],
  'company.delete': ['admin'],
  'company.merge':  ['admin'],

  // Визиты и встречи
  'visit.view':          ['admin', 'team', 'viewer'],
  'visit.create':        ['admin', 'team'],
  'visit.edit':          ['admin'],
  'visit.delete':        ['admin'],
  'meeting.create':      ['admin', 'team'],
  'meeting.edit':        ['admin'],
  'meeting.delete':      ['admin'],
  'meeting.status_change': ['admin', 'team'],

  // Вложения
  'attachment.upload': ['admin', 'team'],
  'attachment.delete': ['admin'],

  // Заявки на исправление (п. 2.3)
  'correction.request': ['team'],
  'correction.decide':  ['admin'],

  // Отчёты и экспорт
  'report.export': ['admin', 'team', 'viewer'],

  // Администрирование
  'admin.users':       ['admin'],
  'admin.dictionaries':['admin'],
  'admin.custom_fields':['admin'],
  'admin.settings':    ['admin'],
  'admin.audit':       ['admin'],
  'admin.recycle_bin': ['admin'],
};

function can(user, permission) {
  if (!user) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Неизвестное право доступа: ${permission}`);
  return allowed.includes(user.role);
}

function require_(user, permission) {
  if (!can(user, permission)) throw forbidden(`Недостаточно прав: ${permission}`);
}

/** Проектный менеджер меняет статус/отмечает выполнение только по своим записям. */
function isOwnRecord(user, record) {
  if (!user || !record) return false;
  return record.responsible_user_id === user.id || record.created_by === user.id;
}

function requireOwnOrAdmin(user, record, permission) {
  require_(user, permission);
  if (user.role === 'admin') return;
  if (!isOwnRecord(user, record)) {
    throw forbidden('Действие доступно только по записям, за которые вы отвечаете');
  }
}

/** Сводка прав для интерфейса — фронтенд не принимает решений сам. */
function permissionsFor(user) {
  const result = {};
  for (const key of Object.keys(PERMISSIONS)) result[key] = can(user, key);
  return result;
}

module.exports = { ROLES, PERMISSIONS, can, require: require_, isOwnRecord, requireOwnOrAdmin, permissionsFor };

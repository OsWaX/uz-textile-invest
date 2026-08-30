'use strict';
/** Центр уведомлений (раздел 7 ТЗ). */
const { Router, notFound } = require('../lib/http');
const { all, get, run } = require('../db');
const notify = require('../notify');
const rbac = require('../rbac');
const config = require('../config');

const router = new Router();

router.get('/api/notifications', async (ctx) => {
  const user = ctx.requireUser();
  const onlyUnread = ctx.query.unread === '1';
  const rows = all(
    `SELECT * FROM notifications WHERE user_id = ? ${onlyUnread ? 'AND is_read = 0' : ''}
     ORDER BY id DESC LIMIT ?`,
    user.id, Math.min(Number(ctx.query.limit) || 50, 200)
  );
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', user.id)?.n ?? 0;
  return {
    rows: rows.map((row) => ({ ...row, type_label: notify.TYPE_LABELS[row.type] || row.type })),
    unread,
    channels: { email: config.smtp.enabled, telegram: config.telegram.enabled },
  };
});

router.post('/api/notifications/:id/read', async (ctx) => {
  const user = ctx.requireUser();
  const row = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', Number(ctx.params.id), user.id);
  if (!row) throw notFound('Уведомление не найдено');
  run('UPDATE notifications SET is_read = 1 WHERE id = ?', row.id);
  return { ok: true };
});

router.post('/api/notifications/read-all', async (ctx) => {
  const user = ctx.requireUser();
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', user.id);
  return { ok: true };
});

/** Ручной запуск проверок — для администратора и приёмочных испытаний. */
router.post('/api/notifications/run-checks', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'admin.settings');
  return {
    deadline_reminders: notify.runDeadlineReminders(),
    overdue: notify.runOverdueChecks(),
    stale: notify.runStaleChecks(),
    digest: notify.runWeeklyDigest(),
  };
});

module.exports = router;

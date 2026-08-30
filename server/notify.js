'use strict';
/**
 * Уведомления и напоминания (раздел 7 ТЗ).
 * Каналы: центр уведомлений в системе, электронная почта, Telegram-бот.
 * Планировщик: напоминания за 7/3/1 день, просроченные этапы с эскалацией,
 * еженедельный дайджест по понедельникам.
 */
const config = require('./config');
const { all, get, run, getSetting } = require('./db');
const { sendMail } = require('./lib/mailer');
const { sendTelegramMessage, escapeHtml } = require('./lib/telegram');

const TYPE_LABELS = {
  deadline_soon: 'Приближается срок этапа',
  deadline_overdue: 'Просрочен этап дорожной карты',
  deadline_escalation: 'Эскалация: просроченный этап',
  project_created: 'Создан новый проект',
  project_status: 'Изменён статус проекта',
  step_assigned: 'Вам назначен этап дорожной карты',
  correction_request: 'Заявка на исправление',
  correction_decision: 'Решение по заявке на исправление',
  visit_confirmed: 'Визит подтверждён',
  meeting_status: 'Изменён статус встречи',
  mention: 'Вас упомянули в комментарии',
  digest: 'Еженедельная сводка',
  stale_project: 'Проект без активности',
};

/**
 * Создаёт уведомление и отправляет его по выбранным пользователем каналам.
 * dedupeKey защищает от повторной отправки одного и того же напоминания.
 */
function notify({ userId, type, title, body = '', link = '', severity = 'info', dedupeKey = '' }) {
  const user = get('SELECT * FROM users WHERE id = ? AND is_active = 1', userId);
  if (!user) return null;

  if (dedupeKey && get('SELECT id FROM notifications WHERE dedupe_key = ?', dedupeKey)) return null;

  const result = run(
    `INSERT INTO notifications (user_id, type, title, body, link, severity, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, type, title, body, link, severity, dedupeKey
  );
  const notificationId = Number(result.lastInsertRowid);

  if (user.notify_email && config.smtp.enabled) {
    deliver(notificationId, 'email', () =>
      sendMail(config.smtp, {
        to: user.email,
        subject: title,
        text: `${title}\n\n${body}\n\n${link ? `${config.publicUrl}${link}` : ''}`.trim(),
        html: emailTemplate({ title, body, link }),
      })
    );
  }

  if (user.notify_telegram && config.telegram.enabled && user.telegram_chat_id) {
    const text =
      `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}` +
      (link ? `\n\n${escapeHtml(config.publicUrl + link)}` : '');
    deliver(notificationId, 'telegram', () =>
      sendTelegramMessage(config.telegram.token, user.telegram_chat_id, text)
    );
  }

  return notificationId;
}

/** Внешние каналы отправляются асинхронно; результат фиксируется в журнале доставки. */
function deliver(notificationId, channel, sendFn) {
  Promise.resolve()
    .then(sendFn)
    .then(() => {
      run(
        'INSERT INTO notification_deliveries (notification_id, channel, status) VALUES (?, ?, ?)',
        notificationId, channel, 'sent'
      );
    })
    .catch((error) => {
      run(
        'INSERT INTO notification_deliveries (notification_id, channel, status, error) VALUES (?, ?, ?, ?)',
        notificationId, channel, 'failed', String(error?.message || error).slice(0, 500)
      );
    });
}

function emailTemplate({ title, body, link }) {
  const url = link ? `${config.publicUrl}${link}` : '';
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1c2536">
<div style="max-width:620px;margin:24px auto;background:#fff;border:1px solid #e2e6ef;border-radius:10px;overflow:hidden">
  <div style="background:#1f4e9e;color:#fff;padding:18px 24px;font-size:14px;letter-spacing:.04em">
    ПРОЕКТНЫЙ ОФИС &middot; ТЕКСТИЛЬНАЯ ПРОМЫШЛЕННОСТЬ
  </div>
  <div style="padding:24px">
    <h1 style="font-size:19px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;white-space:pre-line">${escapeHtml(body)}</p>
    ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#1f4e9e;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px">Открыть в системе</a>` : ''}
  </div>
  <div style="padding:14px 24px;background:#f7f8fb;border-top:1px solid #e9ecf3;font-size:12px;color:#6b7280">
    Письмо сформировано автоматически. Настроить каналы уведомлений можно в профиле пользователя.
  </div>
</div></body></html>`;
}

/** Уведомить нескольких пользователей (дубликаты по id отбрасываются). */
function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    notify({ ...payload, userId, dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${userId}` : '' });
  }
}

const adminIds = () => all("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").map((r) => r.id);

const todayIso = () => new Date().toISOString().slice(0, 10);
const shiftDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** Напоминания о приближающихся сроках этапов дорожной карты. */
function runDeadlineReminders() {
  const daysBefore = getSetting('reminders.days_before', [7, 3, 1]);
  let created = 0;

  for (const days of daysBefore) {
    const target = shiftDays(days);
    const steps = all(
      `SELECT s.*, p.title AS project_title, p.code AS project_code
       FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
       WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.state <> 'done' AND s.due_date = ?`,
      target
    );
    for (const step of steps) {
      const id = notify({
        userId: step.responsible_user_id,
        type: 'deadline_soon',
        title: `Через ${days} ${days === 1 ? 'день' : 'дн.'}: ${step.title}`,
        body: `Проект ${step.project_code} — «${step.project_title}».\nСрок: ${formatDate(step.due_date)}.`,
        link: `/#/projects/${step.project_id}`,
        severity: days === 1 ? 'warning' : 'info',
        dedupeKey: `step:${step.id}:before:${days}`,
      });
      if (id) created += 1;
    }
  }
  return created;
}

/** Просроченные этапы: уведомление ответственному и эскалация руководству. */
function runOverdueChecks() {
  const today = todayIso();
  const escalate = getSetting('reminders.escalate_overdue', true);
  const overdue = all(
    `SELECT s.*, p.title AS project_title, p.code AS project_code, p.responsible_user_id AS project_owner
     FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
     WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.state <> 'done'
       AND s.due_date IS NOT NULL AND s.due_date < ?`,
    today
  );

  let created = 0;
  for (const step of overdue) {
    const dedupe = `step:${step.id}:overdue:${today}`;
    const body = `Проект ${step.project_code} — «${step.project_title}».\nСрок истёк ${formatDate(step.due_date)}.`;
    if (notify({
      userId: step.responsible_user_id,
      type: 'deadline_overdue',
      title: `Просрочен этап: ${step.title}`,
      body,
      link: `/#/projects/${step.project_id}`,
      severity: 'danger',
      dedupeKey: dedupe,
    })) created += 1;

    if (escalate) {
      notifyMany(adminIds().filter((id) => id !== step.responsible_user_id), {
        type: 'deadline_escalation',
        title: `Эскалация: просрочен этап «${step.title}»`,
        body: `${body}\nОтветственный: ${userName(step.responsible_user_id)}.`,
        link: `/#/projects/${step.project_id}`,
        severity: 'danger',
        dedupeKey: `step:${step.id}:escalation:${today}`,
      });
    }
  }
  return created;
}

/** Проекты без активности дольше порогового значения. */
function runStaleChecks() {
  const staleDays = Number(getSetting('projects.stale_days', 30));
  const threshold = new Date(Date.now() - staleDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const stale = all(
    `SELECT id, code, title, responsible_user_id, last_activity_at FROM projects
     WHERE is_deleted = 0 AND status_code NOT IN ('completed','cancelled') AND last_activity_at < ?`,
    threshold
  );
  let created = 0;
  const week = `${new Date().getFullYear()}-w${Math.ceil(new Date().getDate() / 7)}-${new Date().getMonth()}`;
  for (const project of stale) {
    if (notify({
      userId: project.responsible_user_id,
      type: 'stale_project',
      title: `Нет активности по проекту ${project.code}`,
      body: `«${project.title}» — без изменений более ${staleDays} дн. Обновите статус или добавьте комментарий.`,
      link: `/#/projects/${project.id}`,
      severity: 'warning',
      dedupeKey: `project:${project.id}:stale:${week}`,
    })) created += 1;
  }
  return created;
}

/** Еженедельная сводка: сроки недели, встречи, «замершие» проекты. */
function runWeeklyDigest() {
  const users = all("SELECT * FROM users WHERE is_active = 1 AND role IN ('admin','team')");
  const weekEnd = shiftDays(7);
  const today = todayIso();
  let sent = 0;

  for (const user of users) {
    const isAdmin = user.role === 'admin';
    const scope = isAdmin ? '' : 'AND s.responsible_user_id = ?';
    const params = isAdmin ? [today, weekEnd] : [today, weekEnd, user.id];
    const steps = all(
      `SELECT s.title, s.due_date, p.code FROM roadmap_steps s JOIN projects p ON p.id = s.project_id
       WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND s.state <> 'done'
         AND s.due_date BETWEEN ? AND ? ${scope} ORDER BY s.due_date`,
      ...params
    );
    const meetings = all(
      `SELECT m.meet_date, m.company_name, v.code FROM meetings m JOIN visits v ON v.id = m.visit_id
       WHERE m.is_deleted = 0 AND v.is_deleted = 0 AND m.meet_date BETWEEN ? AND ?
         ${isAdmin ? '' : 'AND v.responsible_user_id = ?'} ORDER BY m.meet_date`,
      ...(isAdmin ? [today, weekEnd] : [today, weekEnd, user.id])
    );

    if (!steps.length && !meetings.length) continue;

    const lines = [];
    if (steps.length) {
      lines.push('Сроки этапов на ближайшую неделю:');
      for (const s of steps) lines.push(`  • ${formatDate(s.due_date)} — ${s.code}: ${s.title}`);
    }
    if (meetings.length) {
      lines.push('', 'Запланированные встречи:');
      for (const m of meetings) lines.push(`  • ${formatDate(m.meet_date)} — ${m.company_name} (${m.code})`);
    }

    if (notify({
      userId: user.id,
      type: 'digest',
      title: isAdmin ? 'Сводка по офису на неделю' : 'Ваша сводка на неделю',
      body: lines.join('\n'),
      link: '/#/dashboard',
      dedupeKey: `digest:${user.id}:${today}`,
    })) sent += 1;
  }
  return sent;
}

/** Автоматический перевод просроченных этапов в состояние «просрочен» — вычисляется на лету. */
function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function userName(userId) {
  return get('SELECT full_name FROM users WHERE id = ?', userId)?.full_name || 'не назначен';
}

/** Ежечасный планировщик: напоминания, эскалации, дайджест. */
let timer = null;
function startScheduler() {
  const tick = () => {
    try {
      const now = new Date(Date.now() + config.displayOffsetMinutes * 60000); // время Ташкента
      runDeadlineReminders();
      runOverdueChecks();
      if (now.getUTCHours() === Number(getSetting('reminders.digest_hour', 8))) {
        if (now.getUTCDay() === Number(getSetting('reminders.digest_weekday', 1))) runWeeklyDigest();
        runStaleChecks();
      }
    } catch (error) {
      console.error('[планировщик] ошибка:', error.message);
    }
  };
  tick();
  timer = setInterval(tick, 3600 * 1000);
  timer.unref?.();
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  notify, notifyMany, adminIds, TYPE_LABELS,
  runDeadlineReminders, runOverdueChecks, runStaleChecks, runWeeklyDigest,
  startScheduler, stopScheduler, formatDate,
};

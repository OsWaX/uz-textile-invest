'use strict';
/** Загрузка, выдача и удаление вложений. */
const fs = require('node:fs');
const path = require('node:path');
const { Router, notFound, badRequest, sendBuffer } = require('../lib/http');
const { get } = require('../db');
const config = require('../config');
const rbac = require('../rbac');
const entities = require('../entities');
const v = require('../lib/validate');

const router = new Router();

router.post('/api/attachments', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'attachment.upload');
  const { fields, files } = await ctx.readMultipart();
  if (!files.length) throw badRequest('Файл не передан');

  const entityType = v.oneOf(fields.entity_type, 'Тип записи', ['project', 'company', 'visit', 'step', 'meeting']);
  const entityId = v.int(fields.entity_id, 'Запись', { required: true });

  return files.map((file) =>
    entities.saveAttachment({ entityType, entityId, file, user, req: ctx.req })
  );
});

router.get('/api/attachments/:id', async (ctx) => {
  ctx.requireUser();
  const attachment = get('SELECT * FROM attachments WHERE id = ? AND is_deleted = 0', Number(ctx.params.id));
  if (!attachment) throw notFound('Файл не найден');

  // Защита от выхода за пределы каталога загрузок.
  const filePath = path.resolve(config.uploadDir, path.basename(attachment.stored_name));
  if (!filePath.startsWith(path.resolve(config.uploadDir)) || !fs.existsSync(filePath)) {
    throw notFound('Файл отсутствует в хранилище');
  }

  const data = fs.readFileSync(filePath);
  const inline = ctx.query.inline === '1' && /^image\//.test(attachment.mime);
  const encodedName = encodeURIComponent(attachment.orig_name);
  sendBuffer(ctx.res, 200, data, {
    'Content-Type': attachment.mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  });
  return undefined;
});

router.delete('/api/attachments/:id', async (ctx) => {
  const user = ctx.requireUser();
  rbac.require(user, 'attachment.delete');
  return entities.deleteAttachment(Number(ctx.params.id), user, ctx.req);
});

module.exports = router;

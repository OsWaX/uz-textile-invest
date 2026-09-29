'use strict';
/** Адреса для платёжных систем и страницы оплаты. */
const payme = require('../payments/payme');
const click = require('../payments/click');
const demo = require('../payments/demo');
const { Router } = require('../http');

const router = new Router();

// Эти адреса указываются в кабинетах Payme Business и Click Merchant
router.post('/api/payments/payme', payme.handle);
router.post('/api/payments/click/prepare', click.prepare);
router.post('/api/payments/click/complete', click.complete);

router.get('/pay/demo/:id', demo.showDemo);
router.post('/pay/demo/:id', demo.payDemo);
router.get('/pay/return/:id', demo.showReturn);

module.exports = router;

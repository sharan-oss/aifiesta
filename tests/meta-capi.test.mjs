import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { purchaseEvent, sendPurchase } from '../lib/meta-capi.js';
import handler from '../api/cashfree-webhook.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

const paid = (over = {}) => ({
  type: 'PAYMENT_FORM_ORDER_WEBHOOK',
  event_time: '2026-11-22T10:00:00+05:30',
  data: {
    form: { form_id: 'x', form_url: 'https://payments.cashfree.com/forms/anniversary-monthly-basic', form_currency: 'INR' },
    order: {
      order_id: 'CFPay_anniversary-monthly-ba_ab12_1795000000000', order_status: 'PAID', order_amount: '999.00',
      customer_details: {
        customer_email: ' Asha@Example.COM ', customer_phone: '09876543210', customer_name: 'Asha  K. Rao',
        customer_fields: [{ title: 'Pincode', value: '560 001' }],
      },
    },
  },
  ...over,
});

beforeEach(() => {
  delete process.env.META_CAPI_TOKEN;
  delete process.env.META_TEST_EVENT_CODE;
});

test('builds one Purchase per paid form order, any form, with hashed customer data', () => {
  const e = purchaseEvent(paid());
  assert.equal(e.event_name, 'Purchase');
  assert.equal(e.event_id, 'CFPay_anniversary-monthly-ba_ab12_1795000000000');
  assert.equal(e.event_time, Math.floor(Date.parse('2026-11-22T10:00:00+05:30') / 1000));
  assert.deepEqual(e.custom_data, {
    currency: 'INR', value: 999, order_id: e.event_id, content_name: 'anniversary-monthly-basic',
    content_ids: ['anniversary-monthly-basic'], content_type: 'product', plan: 'monthly',
  });
  assert.deepEqual(e.user_data.em, [sha('asha@example.com')]);
  assert.deepEqual(e.user_data.ph, [sha('919876543210')]);
  assert.deepEqual(e.user_data.fn, [sha('asha')]);
  assert.deepEqual(e.user_data.ln, [sha('rao')]);
  assert.deepEqual(e.user_data.zp, [sha('560001')]);
  assert.deepEqual(e.user_data.country, [sha('in')]);
  assert.ok(!JSON.stringify(e).includes('Asha'), 'no raw customer data in the event');
});

test('yearly ₹7,999 orders are labelled yearly', () => {
  const p = paid();
  p.data.form.form_url = 'https://payments.cashfree.com/forms/sx-7999-yearly-plan-ga-offer';
  p.data.order.order_amount = '7999.00';
  const e = purchaseEvent(p);
  assert.equal(e.custom_data.value, 7999);
  assert.equal(e.custom_data.plan, 'yearly');
});

test('skips unpaid orders, renewals and other event types', () => {
  const unpaid = paid(); unpaid.data.order.order_status = 'ACTIVE';
  assert.equal(purchaseEvent(unpaid), null);
  assert.equal(purchaseEvent({ ...paid(), type: 'SUBSCRIPTION_PAYMENT_SUCCESS' }), null);
  assert.equal(purchaseEvent({ type: 'SUBSCRIPTION_PAYMENT_FAILED', data: {} }), null);
  const free = paid(); free.data.order.order_amount = '0';
  assert.equal(purchaseEvent(free), null);
});

test('sends nothing without a token', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const r = await sendPurchase(paid(), {});
  assert.equal(r.sent, false);
  assert.equal(called, false);
});

test('posts to the dataset with the test code when set', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ events_received: 1 }) }; };
  const r = await sendPurchase(paid(), { META_CAPI_TOKEN: 'tkn', META_TEST_EVENT_CODE: 'TEST123' });
  assert.equal(r.sent, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.0\/1636798967975428\/events\?access_token=tkn$/);
  assert.equal(calls[0].body.test_event_code, 'TEST123');
  assert.equal(calls[0].body.data[0].action_source, 'website');
});

test('falls back to a server event if Meta wants a browser user agent', async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const ev = JSON.parse(init.body).data[0]; sent.push(ev.action_source);
    if (ev.action_source === 'website') return { ok: false, status: 400, json: async () => ({ error: { message: 'client_user_agent is required for website events' } }) };
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  };
  const r = await sendPurchase(paid(), { META_CAPI_TOKEN: 'tkn' });
  assert.equal(r.sent, true);
  assert.deepEqual(sent, ['website', 'system_generated']);
});

test('never throws when Meta is down', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  const r = await sendPurchase(paid(), { META_CAPI_TOKEN: 'tkn' });
  assert.equal(r.sent, false);
  assert.match(r.reason, /network down/);
});

function callWebhook(body) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { method: 'POST', url: '/api/cashfree-webhook?t=tok' });
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(o) { out.body = o; return this; } };
  return handler(req, res).then(() => out);
}

test('webhook: Sheet write and Meta send both happen; a Meta failure still answers 200', async () => {
  Object.assign(process.env, { CASHFREE_WEBHOOK_TOKEN: 'tok', APPS_SCRIPT_URL: 'https://script.example/exec', APPS_SCRIPT_SECRET: 'shh', META_CAPI_TOKEN: 'tkn' });
  const hits = [];
  globalThis.fetch = async (url) => {
    hits.push(String(url).startsWith('https://graph.facebook.com') ? 'meta' : 'sheet');
    if (String(url).startsWith('https://graph.facebook.com')) return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
    return { json: async () => ({ ok: true }) };
  };
  const r = await callWebhook(JSON.stringify(paid()));
  assert.equal(r.status, 200);
  assert.deepEqual(hits.sort(), ['meta', 'sheet']);
});

test('webhook: a Sheet failure still answers 500 so Cashfree retries (Meta merges the resend by event_id)', async () => {
  Object.assign(process.env, { CASHFREE_WEBHOOK_TOKEN: 'tok', APPS_SCRIPT_URL: 'https://script.example/exec', APPS_SCRIPT_SECRET: 'shh', META_CAPI_TOKEN: 'tkn' });
  globalThis.fetch = async (url) => String(url).startsWith('https://graph.facebook.com')
    ? { ok: true, status: 200, json: async () => ({ events_received: 1 }) }
    : { json: async () => ({ ok: false, error: 'locked' }) };
  const r = await callWebhook(JSON.stringify(paid()));
  assert.equal(r.status, 500);
});

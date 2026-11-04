import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler from '../api/cashfree-webhook.js';

const SAMPLE = JSON.stringify({
  data: {
    form: { form_id: 'f1', cf_form_id: 1, form_url: 'https://payments.cashfree.com/forms/f1', form_currency: 'INR' },
    order: {
      order_amount: 3999, order_id: 'CFPay_1', order_status: 'PAID', transaction_id: 99,
      customer_details: { customer_phone: '9999999999', customer_email: 'a@b.co', customer_name: 'A B', customer_fields: [] },
      amount_details: [],
    },
  },
  event_time: '2026-11-04T10:00:00+05:30',
  type: 'PAYMENT_FORM_ORDER_WEBHOOK',
});

function call({ method = 'POST', url = '/api/cashfree-webhook?t=tok', body = SAMPLE } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, url });
  const out = { headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(code) { out.status = code; return this; },
    json(obj) { out.body = obj; return this; },
  };
  return handler(req, res).then(() => out);
}

let fetchCalls;
beforeEach(() => {
  process.env.CASHFREE_WEBHOOK_TOKEN = 'tok';
  process.env.APPS_SCRIPT_URL = 'https://script.example/exec';
  process.env.APPS_SCRIPT_SECRET = 'shh';
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return { json: async () => ({ ok: true }) };
  };
});

test('rejects non-POST', async () => {
  assert.equal((await call({ method: 'GET' })).status, 405);
});

test('rejects wrong or missing token without calling Apps Script', async () => {
  assert.equal((await call({ url: '/api/cashfree-webhook?t=nope' })).status, 401);
  assert.equal((await call({ url: '/api/cashfree-webhook' })).status, 401);
  assert.equal(fetchCalls.length, 0);
});

test('forwards raw body + secret and answers 200 when the sheet confirms', async () => {
  const r = await call();
  assert.equal(r.status, 200);
  const sent = JSON.parse(fetchCalls[0].init.body);
  assert.equal(sent.secret, 'shh');
  assert.equal(sent.raw, SAMPLE);
});

test('answers 500 (so Cashfree retries) when Apps Script says not ok', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'boom' }) });
  assert.equal((await call()).status, 500);
});

test('answers 500 when Apps Script is unreachable', async () => {
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal((await call()).status, 500);
});

test('answers 500 when env is missing', async () => {
  delete process.env.APPS_SCRIPT_URL;
  assert.equal((await call()).status, 500);
});

test('400 on empty body', async () => {
  assert.equal((await call({ body: '' })).status, 400);
});

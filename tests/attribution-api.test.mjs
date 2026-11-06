import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler from '../api/attribution.js';

const ORDER = 'CFPay_am-ads-yearly-basic-plan_7ef8_1793889956289';

function call({ method = 'POST', body } = {}) {
  const raw = body === undefined ? JSON.stringify({ order_id: ORDER, utm_source: 'fb', landing_lp: 'home' }) : body;
  const req = Readable.from(raw ? [Buffer.from(raw)] : []);
  Object.assign(req, { method, url: '/api/attribution' });
  const out = { headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(code) { out.status = code; return this; },
    json(obj) { out.body = obj; return this; },
  };
  return handler(req, res).then(() => out);
}

let sent;
beforeEach(() => {
  process.env.APPS_SCRIPT_URL = 'https://script.example/exec';
  process.env.APPS_SCRIPT_SECRET = 'shh';
  sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { json: async () => ({ ok: true, stored: 'attribution' }) }; };
});

test('forwards a valid record with the secret, only known fields, trimmed', async () => {
  const r = await call({ body: JSON.stringify({ order_id: ORDER, utm_source: 'fb', utm_campaign: 'x'.repeat(900), evil: 'nope', fbclid: 42 }) });
  assert.equal(r.status, 200);
  assert.equal(sent[0].kind, 'attribution');
  assert.equal(sent[0].secret, 'shh');
  assert.equal(sent[0].data.order_id, ORDER);
  assert.equal(sent[0].data.utm_source, 'fb');
  assert.equal(sent[0].data.utm_campaign.length, 500);
  assert.equal(sent[0].data.fbclid, ''); // not a string -> dropped
  assert.equal('evil' in sent[0].data, false);
});

test('all three landing-page order ids are accepted', async () => {
  for (const f of ['am-ads-yearly-basic-plan', 'am-yearly-basic-plan-ga', 'am-yearly-basic-plan-meta']) {
    assert.equal((await call({ body: JSON.stringify({ order_id: `CFPay_${f}_ab12_123` }) })).status, 200, f);
  }
});

test('rejects other forms, placeholders and junk without calling Apps Script', async () => {
  for (const order_id of ['CFPay_anniversary-yearly-basic_e346_1', '{order_id}', '', 'CFPay_am-ads-yearly-basic-plan_x_1"; DROP']) {
    assert.equal((await call({ body: JSON.stringify({ order_id }) })).status, 400, order_id);
  }
  assert.equal((await call({ body: 'not json' })).status, 400);
  assert.equal((await call({ body: '' })).status, 400);
  assert.equal((await call({ body: JSON.stringify({ order_id: ORDER, pad: 'x'.repeat(9000) }) })).status, 400);
  assert.equal(sent.length, 0);
});

test('rejects non-POST', async () => {
  assert.equal((await call({ method: 'GET' })).status, 405);
});

test('500 when Apps Script fails or is unreachable', async () => {
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'boom' }) });
  assert.equal((await call()).status, 500);
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal((await call()).status, 500);
});

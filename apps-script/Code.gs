/**
 * Cashfree webhooks -> Google Sheet.
 *
 * Called ONLY by api/cashfree-webhook.js (Vercel), never by Cashfree directly:
 * Apps Script can't set an HTTP status, so it can't tell Cashfree to retry.
 *
 * Bound to the Sheet (Extensions > Apps Script), so it writes to that Sheet.
 * Script Properties (Project Settings > Script properties):
 *   SHARED_SECRET  same value as APPS_SCRIPT_SECRET in Vercel
 *
 * Tabs (created on first write):
 *   Payments_Raw   every delivery, untouched, for audit
 *   Payments       one row per (order_id, status), parsed
 *
 * Cashfree sends every form on the account; only our landing-page forms
 * (LP_FORMS) are kept, everything else is acknowledged and dropped.
 * Their subscription events (autopay auth success/failed) go to Payments_Raw
 * only: they carry no customer details.
 *
 * One-time cleanup of rows from other forms: run removeOtherForms() from the
 * Apps Script editor.
 */

// Cashfree form ids of our landing pages.
var LP_FORMS = ['am-ads-yearly-basic-plan', 'am-yearly-basic-plan-ga', 'am-yearly-basic-plan-meta'];

var RAW_TAB = 'Payments_Raw';
var PAYMENTS_TAB = 'Payments';

var FORM_EVENT = 'PAYMENT_FORM_ORDER_WEBHOOK';
var PG_EVENTS = ['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'];

// The 10 params the landing pages append to the Cashfree form link.
var TAG_KEYS = [
  'lead_id', 'lp_name', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'ad_id', 'gclid', 'fbclid',
];

var RAW_HEADERS = ['received_at', 'dedupe_key', 'type', 'raw_body'];
var PAYMENT_HEADERS = [
  'received_at', 'event_type', 'event_time', 'order_id', 'status', 'payment_id',
  'amount', 'currency', 'name', 'email', 'phone', 'payment_method', 'error', 'form_id',
].concat(TAG_KEYS, ['order_tags', 'customer_fields', 'amount_details', 'dedupe_key']);
var KEY_COLUMN = PAYMENT_HEADERS.indexOf('dedupe_key') + 1;

function doGet() {
  return json_({ ok: true, service: 'cashfree-webhook-sink' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    if (!body.secret || body.secret !== props.getProperty('SHARED_SECRET')) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    var payload = JSON.parse(body.raw);
    if (!isOurs_(payload)) return json_({ ok: true, stored: 'ignored' });
    var p = parse_(payload);
    var key = p ? p.order_id + '|' + p.status : '';
    var receivedAt = body.received_at || new Date().toISOString();

    lock.waitLock(20000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Raw log first: even a payload we can't parse is kept.
    sheet_(ss, RAW_TAB, RAW_HEADERS)
      .appendRow([receivedAt, key, payload.type || '', body.raw].map(safe_));

    if (!p) return json_({ ok: true, stored: 'raw_only' });

    var tags = p.tags || {};
    var row = [
      receivedAt, payload.type, payload.event_time || '', p.order_id, p.status, p.payment_id,
      p.amount, p.currency, p.name, p.email, phoneCell_(p.phone), p.method, p.error, p.form_id,
    ].concat(
      TAG_KEYS.map(function (k) { return tags[k] || ''; }),
      [
        p.tags ? JSON.stringify(p.tags) : '',
        p.customer_fields ? JSON.stringify(p.customer_fields) : '',
        p.amount_details ? JSON.stringify(p.amount_details) : '',
        key,
      ]
    ).map(safe_);

    var paySheet = sheet_(ss, PAYMENTS_TAB, PAYMENT_HEADERS);
    var existing = findRow_(paySheet, key);
    if (existing) {
      // Form + PG webhooks both report the same payment; keep one row and
      // fill in whatever the earlier one lacked (e.g. order_tags).
      return json_({ ok: true, stored: fillBlanks_(paySheet, existing, row) ? 'merged' : 'duplicate' });
    }
    paySheet.appendRow(row);
    return json_({ ok: true, stored: 'payment' });
  } catch (err) {
    // ok:false makes the Vercel function answer 500, so Cashfree retries.
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Normalise both webhook shapes. Returns null for events we only keep raw.
function parse_(payload) {
  var d = payload.data || {};
  var order = d.order || {};
  if (!order.order_id) return null;

  if (payload.type === FORM_EVENT) {
    var c = order.customer_details || {};
    var form = d.form || {};
    return {
      order_id: order.order_id, status: status_(order.order_status), payment_id: order.transaction_id || '',
      amount: order.order_amount, currency: form.form_currency || '',
      name: c.customer_name || '', email: c.customer_email || '', phone: c.customer_phone || '',
      method: '', error: '', form_id: form.form_id || '',
      tags: order.order_tags || null, customer_fields: c.customer_fields, amount_details: order.amount_details,
    };
  }

  if (PG_EVENTS.indexOf(payload.type) !== -1) {
    var pay = d.payment || {};
    var cust = d.customer_details || {};
    var tags = order.order_tags || null;
    var err = pay.error_details || {};
    return {
      order_id: order.order_id, status: status_(pay.payment_status), payment_id: pay.cf_payment_id || '',
      amount: pay.payment_amount !== undefined ? pay.payment_amount : order.order_amount,
      currency: pay.payment_currency || order.order_currency || '',
      name: cust.customer_name || '', email: cust.customer_email || '', phone: cust.customer_phone || '',
      method: pay.payment_group || '', error: err.error_description || pay.payment_message || '',
      form_id: '', tags: tags, customer_fields: null, amount_details: null,
    };
  }
  return null;
}

// Is this event about one of our landing-page forms?
function isOurs_(payload) {
  var d = payload.data || {};
  var type = payload.type || '';
  if (type === FORM_EVENT) {
    return LP_FORMS.indexOf((d.form || {}).form_id) !== -1;
  }
  if (type.indexOf('SUBSCRIPTION_') === 0) {
    // subscription_id looks like form_<n>_<form id>
    var m = /^form_\d+_(.+)$/.exec(d.subscription_id || '');
    return !!m && LP_FORMS.indexOf(m[1]) !== -1;
  }
  if (PG_EVENTS.indexOf(type) !== -1) {
    var order = d.order || {};
    var tags = order.order_tags || {};
    if (tags.lead_id || tags.lp_name) return true;
    // Form order ids look like CFPay_<form id>_<hex>_<n>
    return LP_FORMS.some(function (f) { return String(order.order_id || '').indexOf('CFPay_' + f + '_') === 0; });
  }
  return false;
}

// Run once by hand (Apps Script editor > removeOtherForms > Run): drops rows
// written before LP_FORMS filtering, from both tabs.
function removeOtherForms() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName(RAW_TAB);
    if (raw) {
      var rawCol = RAW_HEADERS.indexOf('raw_body');
      keepRows_(raw, function (r) {
        try { return isOurs_(JSON.parse(r[rawCol])); } catch (e) { return false; }
      });
    }
    var pay = ss.getSheetByName(PAYMENTS_TAB);
    if (pay) {
      var formCol = PAYMENT_HEADERS.indexOf('form_id');
      var orderCol = PAYMENT_HEADERS.indexOf('order_id');
      keepRows_(pay, function (r) {
        return LP_FORMS.indexOf(r[formCol]) !== -1 ||
          LP_FORMS.some(function (f) { return String(r[orderCol]).indexOf('CFPay_' + f + '_') === 0; });
      });
    }
  } finally {
    lock.releaseLock();
  }
}

// Rewrites a tab with the header plus the rows `keep` accepts. Values are
// re-escaped: getValues drops the apostrophes that kept phones and
// formula-looking text as plain text.
function keepRows_(sh, keep) {
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var phoneCol = header.indexOf('phone');
  var kept = values.slice(1).filter(keep).map(function (r) {
    return r.map(function (v, i) {
      if (i === phoneCol && v !== '') return phoneCell_(String(v));
      return safe_(v);
    });
  });
  sh.getRange(2, 1, Math.max(values.length - 1, 1), header.length).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, header.length).setValues(kept);
  return kept.length;
}

// Form webhook says PAID, PG says SUCCESS: same thing, one row.
function status_(s) {
  s = String(s || '').toUpperCase();
  return s === 'SUCCESS' ? 'PAID' : s;
}

function sheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, KEY_COLUMN, last - 1, 1)
    .createTextFinder(key).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function fillBlanks_(sh, rowIndex, row) {
  var range = sh.getRange(rowIndex, 1, 1, row.length);
  var current = range.getValues()[0];
  var changed = false;
  for (var i = 0; i < row.length; i++) {
    if (current[i] === '' && row[i] !== '') {
      current[i] = row[i];
      changed = true;
    }
  }
  if (changed) range.setValues([current]);
  return changed;
}

// Customers type these values on Cashfree's form. appendRow would run text
// starting with = + - @ as a formula (e.g. =IMPORTXML to leak rows), so
// prefix an apostrophe to keep it as plain text.
function safe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

// Leading apostrophe stops Sheets turning 9999999999 into a number / dropping a +.
function phoneCell_(phone) {
  return phone ? "'" + phone : '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

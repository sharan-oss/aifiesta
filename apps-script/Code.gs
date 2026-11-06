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
 * only (no customer details), and enrich the paid order's row: payment method,
 * UPI id, paid_at and failed attempts. They join on cf_txn_id = transaction_id.
 *
 * Attribution (UTMs, click ids, landing page) comes from our thank-you page via
 * api/attribution.js: appended to the Attribution tab (first record per order
 * wins) and copied into the order's Payments row, whichever arrives first.
 *
 * Run by hand from the Apps Script editor when needed:
 *   removeOtherForms()  drop rows from forms that aren't ours
 *   backfill()          fill lp_name + payment details on existing rows
 */

// Cashfree form id -> landing page. Each landing page has its own form.
var LP_NAMES = {
  'am-ads-yearly-basic-plan': 'home',
  'am-yearly-basic-plan-ga': 'ga',
  'am-yearly-basic-plan-meta': 'meta',
};
var LP_FORMS = Object.keys(LP_NAMES);

var RAW_TAB = 'Payments_Raw';
var PAYMENTS_TAB = 'Payments';
var ATTR_TAB = 'Attribution';

var FORM_EVENT = 'PAYMENT_FORM_ORDER_WEBHOOK';
var PG_EVENTS = ['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'];
var SUB_SUCCESS = 'SUBSCRIPTION_PAYMENT_SUCCESS';
var SUB_FAILED = 'SUBSCRIPTION_PAYMENT_FAILED';

// The 10 params the landing pages append to the Cashfree form link.
var TAG_KEYS = [
  'lead_id', 'lp_name', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'ad_id', 'gclid', 'fbclid',
];

var RAW_HEADERS = ['received_at', 'dedupe_key', 'type', 'raw_body'];
var AD_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ad_id', 'adset_content', 'device', 'gclid', 'gbraid', 'wbraid', 'fbclid',
];
var ATTR_HEADERS = ['received_at', 'order_id', 'thank_you_page', 'landing_lp', 'landing_url', 'referrer', 'landed_at']
  .concat(AD_PARAMS);
var PAYMENT_HEADERS = [
  'received_at', 'event_type', 'event_time', 'order_id', 'status', 'payment_id',
  'amount', 'currency', 'name', 'email', 'phone', 'payment_method', 'error', 'form_id',
].concat(TAG_KEYS, ['order_tags', 'customer_fields', 'amount_details', 'dedupe_key'],
  // From the autopay auth events. New columns only ever go at the end.
  ['payment_channel', 'upi_id', 'paid_at', 'failed_attempts', 'last_failure', 'cf_subscription_id'],
  // From the Attribution tab.
  ['adset_content', 'device', 'gbraid', 'wbraid', 'landing_lp', 'landing_url', 'referrer', 'landed_at', 'attribution']);
var KEY_COLUMN = PAYMENT_HEADERS.indexOf('dedupe_key') + 1;
var PAYMENT_ID_COLUMN = PAYMENT_HEADERS.indexOf('payment_id') + 1;

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

    if (body.kind === 'attribution') {
      lock.waitLock(20000);
      return json_(saveAttribution_(SpreadsheetApp.getActiveSpreadsheet(), body));
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

    if (!p) {
      // Autopay auth success: add its payment details to the order it paid
      // for, if that order's webhook already arrived (usually it comes after).
      var paid = payload.type === SUB_SUCCESS && ss.getSheetByName(PAYMENTS_TAB);
      var paidRow = paid && findRow_(paid, String((payload.data || {}).cf_txn_id || ''), PAYMENT_ID_COLUMN);
      if (paidRow) enrich_(ss, paid, paidRow);
      return json_({ ok: true, stored: 'raw_only' });
    }

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
      var merged = fillBlanks_(paySheet, existing, row);
      enrich_(ss, paySheet, existing);
      return json_({ ok: true, stored: merged ? 'merged' : 'duplicate' });
    }
    paySheet.appendRow(row);
    enrich_(ss, paySheet, paySheet.getLastRow());
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
    return sh;
  }
  // Columns added in a later version: extend the header row. Refuse to write
  // into a sheet whose existing columns don't match, rather than misplace data.
  var have = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var stale = false;
  for (var i = 0; i < headers.length; i++) {
    var h = have[i] === undefined ? '' : have[i];
    if (h === headers[i]) continue;
    if (h !== '') throw new Error('Header mismatch in ' + name + ' column ' + (i + 1) + ': ' + h);
    stale = true;
  }
  if (stale) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function findRow_(sh, text, column) {
  var last = sh.getLastRow();
  if (last < 2 || !text) return 0;
  var hit = sh.getRange(2, column || KEY_COLUMN, last - 1, 1)
    .createTextFinder(text).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function lpName_(formId, orderId) {
  if (LP_NAMES[formId]) return LP_NAMES[formId];
  for (var i = 0; i < LP_FORMS.length; i++) {
    if (String(orderId || '').indexOf('CFPay_' + LP_FORMS[i] + '_') === 0) return LP_NAMES[LP_FORMS[i]];
  }
  return '';
}

// Subscription events in Payments_Raw whose body mentions `text`.
function subscriptionEvents_(raw, text) {
  var last = raw.getLastRow();
  if (last < 2 || !text) return [];
  var col = RAW_HEADERS.indexOf('raw_body') + 1;
  return raw.getRange(2, col, last - 1, 1).createTextFinder(text).findAll()
    .map(function (cell) { try { return JSON.parse(cell.getValue()); } catch (e) { return null; } })
    .filter(function (d) { return d && String(d.type || '').indexOf('SUBSCRIPTION_') === 0 && d.data; });
}

// Fills blank lp_name and payment-detail cells of a Payments row. Never
// overwrites, so it is safe to run any number of times.
function enrich_(ss, paySheet, rowIndex) {
  var col = function (h) { return PAYMENT_HEADERS.indexOf(h); };
  var cur = paySheet.getRange(rowIndex, 1, 1, PAYMENT_HEADERS.length).getValues()[0];
  var add = PAYMENT_HEADERS.map(function () { return ''; });
  add[col('lp_name')] = lpName_(cur[col('form_id')], cur[col('order_id')]);

  var txn = String(cur[col('payment_id')] === undefined ? '' : cur[col('payment_id')]);
  var raw = ss.getSheetByName(RAW_TAB);
  var auth = raw && txn ? subscriptionEvents_(raw, txn).filter(function (d) {
    return d.type === SUB_SUCCESS && String(d.data.cf_txn_id) === txn;
  })[0] : null;
  if (auth) {
    var a = auth.data;
    var ad = a.authorization_details || {};
    var pm = ad.payment_method || {};
    var kind = Object.keys(pm)[0] || '';
    var m = pm[kind] || {};
    var subId = String(a.cf_subscription_id || '');
    var fails = subscriptionEvents_(raw, subId).filter(function (d) {
      return d.type === SUB_FAILED && String(d.data.cf_subscription_id) === subId;
    }).sort(function (x, y) { return String(x.event_time).localeCompare(String(y.event_time)); });
    var lastFail = fails.length ? fails[fails.length - 1].data.failure_details || {} : {};
    add[col('payment_method')] = ad.payment_group || kind;
    add[col('payment_channel')] = m.channel || '';
    add[col('upi_id')] = m.upi_id || '';
    add[col('paid_at')] = ad.authorization_time || auth.event_time || '';
    add[col('failed_attempts')] = fails.length;
    add[col('last_failure')] = lastFail.failure_reason || '';
    add[col('cf_subscription_id')] = subId;
  }

  var attr = ss.getSheetByName(ATTR_TAB);
  var attrRow = attr && findRow_(attr, String(cur[col('order_id')] || ''), ATTR_HEADERS.indexOf('order_id') + 1);
  if (attrRow) {
    var av = attr.getRange(attrRow, 1, 1, ATTR_HEADERS.length).getValues()[0];
    var a2 = {};
    ATTR_HEADERS.forEach(function (h, i) { a2[h] = av[i]; });
    ATTR_HEADERS.forEach(function (h) {
      if (h !== 'received_at' && h !== 'order_id' && col(h) !== -1) add[col(h)] = a2[h] === undefined ? '' : String(a2[h]);
    });
    // ad: arrived from an ad click; organic: we saw the landing but no ad
    // params; unknown: thank-you page reached with nothing stored.
    var fromAd = AD_PARAMS.some(function (k) { return a2[k] !== '' && a2[k] !== undefined; });
    add[col('attribution')] = fromAd ? 'ad' : (a2.landing_lp ? 'organic' : 'unknown');
  }
  return fillBlanks_(paySheet, rowIndex, add.map(safe_));
}

// Thank-you page record -> Attribution tab (first per order wins) -> the
// order's Payments rows, if its webhook already arrived.
function saveAttribution_(ss, body) {
  var d = body.data || {};
  var orderId = String(d.order_id || '');
  if (!lpName_('', orderId)) return { ok: true, stored: 'ignored' };
  var attr = sheet_(ss, ATTR_TAB, ATTR_HEADERS);
  if (findRow_(attr, orderId, ATTR_HEADERS.indexOf('order_id') + 1)) return { ok: true, stored: 'duplicate' };
  attr.appendRow(ATTR_HEADERS.map(function (h) {
    if (h === 'received_at') return body.received_at || new Date().toISOString();
    return d[h] === undefined || d[h] === null ? '' : String(d[h]);
  }).map(safe_));

  var pay = ss.getSheetByName(PAYMENTS_TAB);
  var last = pay ? pay.getLastRow() : 0;
  if (last >= 2) {
    pay.getRange(2, PAYMENT_HEADERS.indexOf('order_id') + 1, last - 1, 1)
      .createTextFinder(orderId).matchEntireCell(true).findAll()
      .forEach(function (cell) { enrich_(ss, pay, cell.getRow()); });
  }
  return { ok: true, stored: 'attribution' };
}

// Run once by hand after deploying: fills lp_name and payment details on
// rows written before enrichment existed.
function backfill() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss.getSheetByName(PAYMENTS_TAB)) return 0;
    var pay = sheet_(ss, PAYMENTS_TAB, PAYMENT_HEADERS);
    var changed = 0;
    for (var r = 2; r <= pay.getLastRow(); r++) if (enrich_(ss, pay, r)) changed++;
    return changed;
  } finally {
    lock.releaseLock();
  }
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
// Also: digit strings of 15+ chars (Meta ad ids are ~18) would be rounded as
// numbers, so they stay text too.
function safe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && (/^[=+\-@\t\r]/.test(v) || /^\d{15,}$/.test(v))) return "'" + v;
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

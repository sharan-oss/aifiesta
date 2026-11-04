// Sends a fake Cashfree webhook so you can watch rows land in the Sheet.
//
// Straight to Apps Script (needs SHARED_SECRET):
//   read -s "SECRET?Shared secret: " && SECRET=$SECRET node apps-script/send-test.mjs '<apps-script /exec url>'
//
// Through Vercel, exactly like Cashfree (token is in the URL):
//   node apps-script/send-test.mjs 'https://<domain>/api/cashfree-webhook?t=<CASHFREE_WEBHOOK_TOKEN>'
//   Protected preview? also set VERCEL_BYPASS=<Protection Bypass for Automation secret>.
//
// Sends: form PAID (no tags), the same again (duplicate), PG SUCCESS with tags
// (merges into the same row), and a PG USER_DROPPED for a second order.
// Test rows are named "TEST - delete me" with order ids starting TEST_.

const url = process.argv[2];
if (!url) {
  console.error('usage: node apps-script/send-test.mjs <url>');
  process.exit(1);
}
const viaVercel = url.includes('/api/cashfree-webhook');
if (!viaVercel && !process.env.SECRET) {
  console.error('SECRET env var is required when posting straight to Apps Script');
  process.exit(1);
}

const stamp = Date.now();
const tags = {
  lead_id: `TEST_lead_${stamp}`, lp_name: 'test', utm_source: 'fb', utm_medium: 'feed',
  utm_campaign: 'test-campaign', utm_content: 'test-adset', ad_id: '123',
};
const customer = { customer_name: 'TEST - delete me', customer_email: 'test@example.com', customer_phone: '9999999999' };
const now = new Date().toISOString();

const form = (orderId) => ({
  data: {
    form: { form_id: 'test-form', cf_form_id: 1, form_url: 'https://payments.cashfree.com/forms/test-form', form_currency: 'INR' },
    order: {
      order_amount: 1, order_id: orderId, order_status: 'PAID', transaction_id: stamp,
      customer_details: { ...customer, customer_fields: [] }, amount_details: [],
    },
  },
  event_time: now, type: 'PAYMENT_FORM_ORDER_WEBHOOK',
});
const pg = (orderId, type, status) => ({
  data: {
    order: { order_id: orderId, order_amount: 1, order_currency: 'INR', order_tags: tags },
    payment: { cf_payment_id: stamp, payment_status: status, payment_amount: 1, payment_currency: 'INR', payment_group: 'upi' },
    customer_details: customer,
  },
  event_time: now, type,
});

const A = `TEST_${stamp}_a`;
const B = `TEST_${stamp}_b`;
const steps = [
  ['form PAID', form(A), 'payment'],
  ['same again', form(A), 'duplicate'],
  ['PG SUCCESS + tags', pg(A, 'PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS'), 'merged'],
  ['PG USER_DROPPED', pg(B, 'PAYMENT_USER_DROPPED_WEBHOOK', 'USER_DROPPED'), 'payment'],
];

for (const [label, payload, expect] of steps) {
  const raw = JSON.stringify(payload);
  const headers = { 'Content-Type': viaVercel ? 'application/json' : 'text/plain;charset=utf-8' };
  if (process.env.VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS;
  const body = viaVercel ? raw : JSON.stringify({ secret: process.env.SECRET, raw, received_at: new Date().toISOString() });
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const text = (await res.text()).slice(0, 200);
  // Vercel only says ok/not ok; Apps Script also says what it stored.
  const pass = viaVercel ? res.status === 200 : text.includes(`"stored":"${expect}"`);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(18)} ${res.status} ${text} (${Date.now() - t0}ms)`);
}
console.log(`\nIn the Sheet: Payments should have 2 rows (${A} PAID with tags, ${B} USER_DROPPED); Payments_Raw 4.`);

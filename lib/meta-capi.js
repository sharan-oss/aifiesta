// Meta Conversions API: one Purchase per paid Cashfree form order, for every form on the
// account (our landing pages, other teams' pages, monthly and yearly plans).
//
// - Only PAYMENT_FORM_ORDER_WEBHOOK with order_status PAID. Autopay renewals arrive as
//   SUBSCRIPTION_* events and are skipped, so Meta sees each customer's first payment once.
// - event_id = Cashfree order id. Our thank-you pages fire the browser Purchase with the same
//   eventID, so Meta merges the two for our own orders; Cashfree retries are merged the same way.
// - Customer email, phone, name and pincode are normalised and SHA-256 hashed before they leave
//   this function; nothing is stored.
//
// Env (Vercel): META_CAPI_TOKEN (required; without it nothing is sent)
//               META_DATASET_ID (default: our pixel), META_TEST_EVENT_CODE (optional: send as
//               test events, visible under Events Manager > Test events), META_API_VERSION.

import { createHash } from 'node:crypto';

const DEFAULT_DATASET_ID = '1636798967975428';
const DEFAULT_API_VERSION = 'v23.0';
const META_TIMEOUT_MS = 8000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s ?? '').trim().toLowerCase();

function phoneDigits(raw) {
  let d = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = '91' + d; // Indian mobile without country code
  return d.length >= 11 ? d : '';
}

function nameParts(raw) {
  const words = clean(raw).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return { fn: words[0] || '', ln: words.length > 1 ? words[words.length - 1] : '' };
}

function pincode(fields) {
  const f = (fields || []).find((x) => /pin|zip|postal/i.test(String(x?.title || '')));
  const d = String(f?.value ?? '').replace(/\D/g, '');
  return d.length === 6 ? d : '';
}

function formSlug(form) {
  const fromUrl = String(form?.form_url || '').split('?')[0].split('/').filter(Boolean).pop();
  return fromUrl || String(form?.form_id || '') || 'unknown';
}

// Returns a Conversions API event for a paid form order, or null for anything else.
export function purchaseEvent(payload) {
  if (!payload || payload.type !== 'PAYMENT_FORM_ORDER_WEBHOOK') return null;
  const order = payload.data?.order;
  const form = payload.data?.form;
  if (!order || order.order_status !== 'PAID' || !order.order_id) return null;
  const value = Number(order.order_amount);
  if (!(value > 0)) return null;

  const c = order.customer_details || {};
  const user = {};
  const email = clean(c.customer_email);
  const phone = phoneDigits(c.customer_phone);
  const { fn, ln } = nameParts(c.customer_name);
  const zp = pincode(c.customer_fields);
  if (email) user.em = [sha256(email)];
  if (phone) user.ph = [sha256(phone)];
  if (fn) user.fn = [sha256(fn)];
  if (ln) user.ln = [sha256(ln)];
  if (zp) user.zp = [sha256(zp)];
  user.country = [sha256('in')];
  if (email || phone) user.external_id = [sha256(email || phone)];
  if (!user.em && !user.ph) return null; // nothing Meta could match on

  const slug = formSlug(form);
  const t = Date.parse(payload.event_time);
  return {
    event_name: 'Purchase',
    event_time: Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000),
    event_id: String(order.order_id),
    action_source: 'website',
    event_source_url: form?.form_url || undefined,
    user_data: user,
    custom_data: {
      currency: form?.form_currency || 'INR',
      value,
      order_id: String(order.order_id),
      content_name: slug,
      content_ids: [slug],
      content_type: 'product',
      plan: /month/i.test(slug) ? 'monthly' : 'yearly',
    },
  };
}

async function post(event, { token, datasetId, version, testCode }) {
  const body = { data: [event] };
  if (testCode) body.test_event_code = testCode;
  const res = await fetch(`https://graph.facebook.com/${version}/${datasetId}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json.error, status: res.status, json };
}

// Sends the Purchase for this webhook payload. Never throws: the Sheet write must not depend on
// Meta. Resolves with a short status for logs (no customer data).
export async function sendPurchase(payload, env = process.env) {
  const event = purchaseEvent(payload);
  if (!event) return { sent: false, reason: 'not a paid form order' };
  const token = env.META_CAPI_TOKEN;
  if (!token) return { sent: false, reason: 'META_CAPI_TOKEN not set' };
  const opts = {
    token,
    datasetId: env.META_DATASET_ID || DEFAULT_DATASET_ID,
    version: env.META_API_VERSION || DEFAULT_API_VERSION,
    testCode: env.META_TEST_EVENT_CODE || '',
  };
  try {
    let r = await post(event, opts);
    // Website events normally carry the buyer's browser user agent, which Cashfree's webhook
    // doesn't include. If Meta insists on it, resend the same purchase as a server event.
    if (!r.ok && /user_agent|action_source/i.test(JSON.stringify(r.json))) {
      r = await post({ ...event, action_source: 'system_generated', event_source_url: undefined }, opts);
    }
    if (!r.ok) return { sent: false, reason: `meta ${r.status}: ${r.json?.error?.message || 'error'}`, order_id: event.event_id };
    return { sent: true, order_id: event.event_id, test: Boolean(opts.testCode), received: r.json.events_received };
  } catch (err) {
    return { sent: false, reason: String(err), order_id: event.event_id };
  }
}

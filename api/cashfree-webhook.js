// Cashfree Payment Forms webhook -> Apps Script -> Google Sheet.
//
// Why this sits between Cashfree and Apps Script: Cashfree retries (2, 10, 30 min)
// on anything but a 200, and Apps Script can't set a status code. Here we answer
// 200 only after the Sheet has confirmed the write, 500 otherwise. Apps Script
// de-duplicates, so retries are safe.
//
// Env (Vercel): CASHFREE_WEBHOOK_TOKEN, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET, META_CAPI_TOKEN
//
// Every paid form order (all forms on the account) is also sent to Meta as a Purchase
// (lib/meta-capi.js), in parallel with the Sheet write. Meta never decides the reply: a Meta
// failure is logged, and only a Sheet failure makes Cashfree retry.
// Cashfree URL: https://<domain>/api/cashfree-webhook?t=<CASHFREE_WEBHOOK_TOKEN>
//
// No Cashfree API keys, so the x-webhook-signature header can't be verified;
// the secret token in the URL is the only gate.

import { timingSafeEqual } from 'node:crypto';
import { forwardToAppsScript, readRawBody } from '../lib/apps-script.js';
import { sendPurchase } from '../lib/meta-capi.js';

function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const { CASHFREE_WEBHOOK_TOKEN } = process.env;
  if (!CASHFREE_WEBHOOK_TOKEN) {
    console.error('cashfree-webhook: missing env vars');
    return res.status(500).json({ ok: false });
  }

  const token = new URL(req.url, 'http://x').searchParams.get('t');
  if (!tokenMatches(token, CASHFREE_WEBHOOK_TOKEN)) {
    return res.status(401).json({ ok: false });
  }

  const raw = await readRawBody(req);
  if (!raw) return res.status(400).json({ ok: false });

  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* the Sheet still gets the raw body */ }

  const [sheet, meta] = await Promise.allSettled([
    forwardToAppsScript({ raw }),
    payload ? sendPurchase(payload) : Promise.resolve({ sent: false, reason: 'not json' }),
  ]);

  const m = meta.status === 'fulfilled' ? meta.value : { sent: false, reason: String(meta.reason) };
  if (m.sent) console.log('meta-capi sent', m.order_id, m.test ? '(test event)' : '');
  else if (m.order_id) console.error('meta-capi failed', m.order_id, m.reason);

  if (sheet.status === 'fulfilled') return res.status(200).json({ ok: true });
  // 500 -> Cashfree retries. The raw body is in the log in case all retries fail.
  console.error('cashfree-webhook failed', String(sheet.reason), raw);
  return res.status(500).json({ ok: false });
}

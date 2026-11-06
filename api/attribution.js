// Thank-you page -> Apps Script: how the buyer arrived (UTMs, click ids, landing page),
// keyed by the Cashfree order id from the return URL. Sent by src/components/Attribution.astro
// with sendBeacon, from the browser, so there is no secret: everything is validated here
// and Apps Script keeps only the first record per order.
//
// Env (Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

import { forwardToAppsScript, readRawBody } from '../lib/apps-script.js';

// Order ids of our three landing-page forms (same list as LP_NAMES in apps-script/Code.gs).
const ORDER_ID = /^CFPay_(am-ads-yearly-basic-plan|am-yearly-basic-plan-ga|am-yearly-basic-plan-meta)_[A-Za-z0-9]+_\d+$/;
const FIELDS = [
  'thank_you_page', 'landing_lp', 'landing_url', 'referrer', 'landed_at',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ad_id', 'adset_content', 'device', 'gclid', 'gbraid', 'wbraid', 'fbclid',
];
const MAX_BODY = 8192;
const MAX_FIELD = 500;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const raw = await readRawBody(req);
  if (!raw || raw.length > MAX_BODY) return res.status(400).json({ ok: false });
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ ok: false }); }
  if (!body || typeof body.order_id !== 'string' || !ORDER_ID.test(body.order_id)) {
    return res.status(400).json({ ok: false });
  }

  const data = { order_id: body.order_id };
  for (const k of FIELDS) data[k] = typeof body[k] === 'string' ? body[k].slice(0, MAX_FIELD) : '';

  try {
    const result = await forwardToAppsScript({ kind: 'attribution', data });
    return res.status(200).json({ ok: true, stored: result.stored });
  } catch (err) {
    // sendBeacon won't retry; the log keeps the record for a manual fix.
    console.error('attribution failed', String(err), JSON.stringify(data));
    return res.status(500).json({ ok: false });
  }
}

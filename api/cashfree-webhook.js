// Cashfree Payment Forms webhook -> Apps Script -> Google Sheet.
//
// Why this sits between Cashfree and Apps Script: Cashfree retries (2, 10, 30 min)
// on anything but a 200, and Apps Script can't set a status code. Here we answer
// 200 only after the Sheet has confirmed the write, 500 otherwise. Apps Script
// de-duplicates, so retries are safe.
//
// Env (Vercel): CASHFREE_WEBHOOK_TOKEN, APPS_SCRIPT_URL, APPS_SCRIPT_SECRET
// Cashfree URL: https://<domain>/api/cashfree-webhook?t=<CASHFREE_WEBHOOK_TOKEN>
//
// No Cashfree API keys, so the x-webhook-signature header can't be verified;
// the secret token in the URL is the only gate.

import { timingSafeEqual } from 'node:crypto';
import { forwardToAppsScript, readRawBody } from '../lib/apps-script.js';

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

  try {
    await forwardToAppsScript({ raw });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // 500 -> Cashfree retries. The raw body is in the log in case all retries fail.
    console.error('cashfree-webhook failed', String(err), raw);
    return res.status(500).json({ ok: false });
  }
}

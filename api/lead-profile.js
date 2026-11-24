// Thank-you page card: optional "I'm a…" / "I'll mostly use it for…" answers, saved on tap.
// Keyed by the Cashfree order id (from the return URL) and the popup's lead_id when there is
// one. Browser-sent, so validated here; only answers from the fixed lists are stored.
//
// Env (Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

import { LP_ORDER_ID, forwardToAppsScript, readRawBody } from '../lib/apps-script.js';
import { PERSONAS, PURPOSES } from '../lib/lead-options.js';

export function cleanProfile(b) {
  if (!b || typeof b !== 'object' || typeof b.order_id !== 'string' || !LP_ORDER_ID.test(b.order_id)) return null;
  const persona = PERSONAS.includes(b.persona) ? b.persona : '';
  const purpose = PURPOSES.includes(b.purpose) ? b.purpose : '';
  if (!persona && !purpose) return null;
  const lead_id = typeof b.lead_id === 'string' && /^L[a-z0-9]{8,32}$/i.test(b.lead_id) ? b.lead_id : '';
  return { order_id: b.order_id, lead_id, persona, purpose };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const raw = await readRawBody(req);
  if (!raw || raw.length > 2048) return res.status(400).json({ ok: false });
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ ok: false }); }
  const data = cleanProfile(body);
  if (!data) return res.status(400).json({ ok: false });
  try {
    const result = await forwardToAppsScript({ kind: 'profile', data });
    return res.status(200).json({ ok: true, stored: result.stored });
  } catch (err) {
    console.error('lead-profile failed', String(err), JSON.stringify(data));
    return res.status(500).json({ ok: false });
  }
}

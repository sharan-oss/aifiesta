// Home B popup -> Apps Script "Leads" tab: contact details + two qualifying answers, sent from
// the browser just before it redirects to the pre-filled Cashfree form. No secret is possible
// in the browser, so everything is validated here and unknown fields are dropped.
//
// Env (Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

import { forwardToAppsScript, readRawBody } from '../lib/apps-script.js';
import { PERSONAS, PURPOSES } from '../lib/lead-options.js';

const MAX_BODY = 8192;
const MAX_FIELD = 500;
const EXTRA = [
  'landing_lp', 'landing_url', 'referrer', 'landed_at', 'page_url',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ad_id', 'adset_content', 'device', 'gclid', 'gbraid', 'wbraid', 'fbclid',
];

const str = (v, max = MAX_FIELD) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Returns the cleaned lead, or null if a required field is missing or malformed.
export function cleanLead(b) {
  if (!b || typeof b !== 'object') return null;
  const lead_id = str(b.lead_id, 40);
  const name = str(b.name, 100).replace(/\s+/g, ' ');
  const phone = str(b.phone, 20).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const email = str(b.email, 120).toLowerCase();
  const pincode = str(b.pincode, 10).replace(/\D/g, '');
  if (!/^L[a-z0-9]{8,32}$/i.test(lead_id)) return null;
  if (name.length < 2 || !/^[6-9]\d{9}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^[1-9]\d{5}$/.test(pincode)) return null;
  const lead = {
    lead_id, name, phone, email, pincode,
    variant: b.variant === 'a' ? 'a' : 'b',
    persona: PERSONAS.includes(b.persona) ? b.persona : '',
    purpose: PURPOSES.includes(b.purpose) ? b.purpose : '',
    consent: b.consent === true ? 'yes' : 'no',
  };
  for (const k of EXTRA) lead[k] = str(b[k]);
  return lead;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const raw = await readRawBody(req);
  if (!raw || raw.length > MAX_BODY) return res.status(400).json({ ok: false });
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ ok: false }); }
  const data = cleanLead(body);
  if (!data) return res.status(400).json({ ok: false });

  try {
    const result = await forwardToAppsScript({ kind: 'lead', data });
    return res.status(200).json({ ok: true, stored: result.stored });
  } catch (err) {
    // The buyer is already on their way to Cashfree; the log keeps the lead for a manual fix.
    console.error('lead failed', String(err), JSON.stringify(data));
    return res.status(500).json({ ok: false });
  }
}

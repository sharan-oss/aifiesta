// Shared by the api/ functions: talk to the Apps Script web app that writes the Sheet.
// Env (Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

// Cashfree form ids of our landing pages, old and new (same list as LP_NAMES in apps-script/Code.gs).
export const LP_FORM_IDS = [
  'am-ads-yearly-basic-plan-offer', 'am-yearly-basic-plan-ga-offer', 'am-yearly-basic-plan-meta-offer',
  'am-ads-yearly-basic-plan', 'am-yearly-basic-plan-ga', 'am-yearly-basic-plan-meta',
];

// Their order ids: Cashfree embeds only the first 25 chars of the form id, e.g.
// am-ads-yearly-basic-plan-offer -> CFPay_am-ads-yearly-basic-plan-_01ea_1794384828921
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const prefixes = [...new Set(LP_FORM_IDS.map((f) => escape(f.slice(0, 25))))];
export const LP_ORDER_ID = new RegExp(`^CFPay_(${prefixes.join('|')})_[A-Za-z0-9]+_\\d+$`);

// Apps Script cold start + waiting for its lock can take several seconds.
const APPS_SCRIPT_TIMEOUT_MS = 15000;

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw) return raw;
  return req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';
}

// Resolves with Apps Script's reply; throws unless it confirms the write ({ ok: true }).
export async function forwardToAppsScript(body) {
  const { APPS_SCRIPT_URL, APPS_SCRIPT_SECRET } = process.env;
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) throw new Error('missing APPS_SCRIPT_URL / APPS_SCRIPT_SECRET');
  const upstream = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, secret: APPS_SCRIPT_SECRET, received_at: new Date().toISOString() }),
    redirect: 'follow',
    signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS),
  });
  const result = await upstream.json();
  if (!result.ok) throw new Error(`apps script: ${result.error || 'not ok'}`);
  return result;
}

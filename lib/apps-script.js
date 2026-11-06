// Shared by the api/ functions: talk to the Apps Script web app that writes the Sheet.
// Env (Vercel): APPS_SCRIPT_URL, APPS_SCRIPT_SECRET

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

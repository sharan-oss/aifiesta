// Home A/B test (Vercel Routing Middleware, runs before the CDN cache, only for "/").
// A = the current Home page. B = /home-b (sales video + lead popup), served at "/" so the URL,
// ads and UTMs stay the same. A visitor keeps their variant for 30 days (cookie af_ab).
// ?ab=a or ?ab=b forces a variant (for checking both). Bots and link previews always get A.

export const config = { matcher: ['/'] };

const COOKIE = 'af_ab';
const MAX_AGE = 30 * 24 * 3600;
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|preview|lighthouse|headless/i;

export function pickVariant({ cookie = '', query = '', userAgent = '', random = Math.random } = {}) {
  const forced = /(?:^|[?&])ab=(a|b)(?:&|$)/.exec(query);
  if (forced) return { variant: forced[1], setCookie: true };
  if (BOT.test(userAgent)) return { variant: 'a', setCookie: false };
  const saved = new RegExp(`(?:^|;\\s*)${COOKIE}=(a|b)(?:;|$)`).exec(cookie);
  if (saved) return { variant: saved[1], setCookie: false };
  return { variant: random() < 0.5 ? 'a' : 'b', setCookie: true };
}

export default function middleware(request) {
  const url = new URL(request.url);
  const { variant, setCookie } = pickVariant({
    cookie: request.headers.get('cookie') || '',
    query: url.search,
    userAgent: request.headers.get('user-agent') || '',
  });
  const headers = new Headers();
  if (setCookie) headers.append('set-cookie', `${COOKIE}=${variant}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax; Secure`);
  if (variant === 'b') {
    headers.set('x-middleware-rewrite', new URL(`/home-b${url.search}`, url).toString());
  } else {
    headers.set('x-middleware-next', '1');
  }
  return new Response(null, { headers });
}

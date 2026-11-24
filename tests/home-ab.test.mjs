import { test } from 'node:test';
import assert from 'node:assert/strict';
import middleware, { pickVariant } from '../middleware.js';
import { cleanLead } from '../api/lead.js';

test('split: new visitors get a or b by coin flip, and keep it via cookie', () => {
  assert.deepEqual(pickVariant({ random: () => 0.2 }), { variant: 'a', setCookie: true });
  assert.deepEqual(pickVariant({ random: () => 0.7 }), { variant: 'b', setCookie: true });
  assert.deepEqual(pickVariant({ cookie: 'x=1; af_ab=b', random: () => 0 }), { variant: 'b', setCookie: false });
});

test('split: ?ab= forces a variant; bots always get a', () => {
  assert.equal(pickVariant({ query: '?utm_source=fb&ab=b', cookie: 'af_ab=a' }).variant, 'b');
  assert.equal(pickVariant({ userAgent: 'facebookexternalhit/1.1', random: () => 0.9 }).variant, 'a');
  assert.equal(pickVariant({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)', random: () => 0.9 }).variant, 'a');
});

test('middleware rewrites b to /home-b keeping the query string; a passes through', () => {
  const b = middleware(new Request('https://super.aifiesta.ai/?ab=b&utm_source=fb'));
  assert.equal(b.headers.get('x-middleware-rewrite'), 'https://super.aifiesta.ai/home-b?ab=b&utm_source=fb');
  assert.match(b.headers.get('set-cookie'), /^af_ab=b; Path=\/; Max-Age=2592000/);
  const a = middleware(new Request('https://super.aifiesta.ai/', { headers: { cookie: 'af_ab=a' } }));
  assert.equal(a.headers.get('x-middleware-next'), '1');
  assert.equal(a.headers.get('x-middleware-rewrite'), null);
  assert.equal(a.headers.get('set-cookie'), null);
});

const LEAD = { lead_id: 'Lmabc12345xy', name: ' Asha  Rao ', phone: '+91 98765 43210', email: 'Asha@Example.com', pincode: '560 001',
  persona: 'Student', purpose: 'Coding', consent: true, variant: 'b', utm_source: 'fb', evil: 'x' };

test('lead: cleans and validates contact details, keeps only known answers and fields', () => {
  const l = cleanLead(LEAD);
  assert.equal(l.name, 'Asha Rao');
  assert.equal(l.phone, '9876543210');
  assert.equal(l.email, 'asha@example.com');
  assert.equal(l.pincode, '560001');
  assert.equal(l.consent, 'yes');
  assert.equal(l.utm_source, 'fb');
  assert.equal('evil' in l, false);
  assert.equal(cleanLead({ ...LEAD, persona: 'Hacker' }).persona, '');
});

test('lead: rejects bad phone, email, pincode or id', () => {
  for (const bad of [{ phone: '12345' }, { phone: '5876543210' }, { email: 'nope' }, { pincode: '012345' }, { lead_id: 'x' }, { name: 'A' }]) {
    assert.equal(cleanLead({ ...LEAD, ...bad }), null, JSON.stringify(bad));
  }
});

import { cleanProfile } from '../api/lead-profile.js';

test('lead: answers are optional (popup sends only contact details)', () => {
  const { persona, purpose, ...contactOnly } = LEAD;
  const l = cleanLead(contactOnly);
  assert.equal(l.persona, '');
  assert.equal(l.purpose, '');
  assert.equal(l.phone, '9876543210');
});

test('profile: needs a landing-page order id and at least one known answer', () => {
  const order_id = 'CFPay_am-yearly-basic-plan-meta_c3d4_1795600000000';
  assert.deepEqual(cleanProfile({ order_id, persona: 'Student', lead_id: 'Lmabc12345xy' }), { order_id, lead_id: 'Lmabc12345xy', persona: 'Student', purpose: '' });
  assert.equal(cleanProfile({ order_id, purpose: 'Something else' }).purpose, 'Something else');
  assert.equal(cleanProfile({ order_id, persona: 'Hacker' }), null);
  assert.equal(cleanProfile({ order_id: 'CFPay_anniversary-yearly-basic_e346_1', persona: 'Student' }), null);
  assert.equal(cleanProfile({ order_id, persona: 'Student', lead_id: 'x"; DROP' }).lead_id, '');
});

// Who can open which dashboard. Each account has its own passcode, set as a
// Vercel environment variable (never in a front-end file).
//
//   /alice   owner      ALICE_TOKEN, or the existing ADMIN_TOKEN
//   /nalani  therapist  NALANI_TOKEN
//
// To add a therapist later: add a line here with their name and passcode
// variable, then copy nalani.html to <slug>.html.
import { timingSafeEqual } from 'node:crypto';

export const THERAPISTS = ['Nalani S.', 'Alice S.', 'Seraphim S.'];

export const ACCOUNTS = [
  { slug: 'alice', name: 'Alice S.', role: 'owner', envVars: ['ALICE_TOKEN', 'ADMIN_TOKEN'] },
  { slug: 'nalani', name: 'Nalani S.', role: 'therapist', envVars: ['NALANI_TOKEN'] },
];

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns the account for this request's passcode, or null.
// `slug` limits the check to one account, so Nalani's passcode can't open /alice.
export function authenticate(req, slug) {
  const supplied = req.headers['x-admin-token'];
  if (!supplied) return null;
  for (const account of ACCOUNTS) {
    if (slug && account.slug !== slug) continue;
    for (const name of account.envVars) {
      const expected = process.env[name];
      if (expected && same(supplied, expected)) return account;
    }
  }
  return null;
}

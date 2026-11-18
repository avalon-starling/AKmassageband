// POST /api/waitlist  { name, contact }  — public, from the booking page's waitlist tab.
// Returns { ok, position } where position is the place among people still waiting.
import { randomUUID } from 'node:crypto';
import { addToWaitlist, listWaitlist } from './_store.js';

const MAX_ENTRIES = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const name = String(req.body?.name || '').trim().slice(0, 60);
  const contact = String(req.body?.contact || '').trim().slice(0, 80);
  if (!name || !contact) {
    return res.status(400).json({ error: 'Add your name and mobile number.' });
  }

  try {
    if ((await listWaitlist()).length >= MAX_ENTRIES) {
      return res.status(503).json({ error: 'The waitlist is full. Come to the booth and we will fit you in.' });
    }
    const entry = { id: `wl-${randomUUID()}`, name, contact, createdAt: new Date().toISOString() };
    const position = await addToWaitlist(entry);
    return res.status(200).json({ ok: true, position });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add you. Try again or come to the booth.' });
  }
}

// /api/dashboard?account=<slug>   (header x-admin-token: that account's passcode)
//
// GET   alice  -> every booking with money and assignments, the waitlist, payout totals
//       nalani -> only the sessions she's assigned to, and what she's owed
// POST  alice only, JSON { action, ... }:
//   assign     { id, assigned: [name | ''] }  one entry per pair of hands
//   payout     { id, therapist, paid }        mark one therapist's share paid / unpaid
//   payoutAll  { therapist }                  mark everything owed to them as paid
//   waitlist   { id, status }                 waiting | called | served | removed
//   settings   { payoutPercent }              0–100, the therapist's share of their time
import { authenticate, THERAPISTS } from './_auth.js';
import {
  listAllBookings, listWaitlist, setWaitlistStatus, WAITLIST_STATUSES,
  getAllMeta, setMeta, getSettings, setSettings, EVENT_DAYS, RATE_PER_MINUTE,
} from './_store.js';

// Who is working each pair of hands. The guest's request fills the first seat
// until Alice assigns people herself.
function assignedFor(booking, meta) {
  const hands = booking.hands || 1;
  const requested = booking.therapist && booking.therapist !== 'any' ? booking.therapist : '';
  return Array.from({ length: hands }, (_, i) => {
    if (meta && Array.isArray(meta.assigned)) return meta.assigned[i] || '';
    return i === 0 ? requested : '';
  });
}

function decorate(booking, meta, payoutPercent) {
  const minutes = booking.minutes || 0;
  const hands = booking.hands || 1;
  const totalCents = minutes * RATE_PER_MINUTE * 100 * hands;
  const paidOnlineCents = booking.amountCents || 0;
  return {
    id: booking.id,
    dayId: booking.dayId,
    day: booking.day,
    slot: booking.slot,
    startMin: booking.startMin,
    minutes,
    hands,
    session: booking.session,
    requested: booking.therapist || 'any',
    name: booking.name,
    contact: booking.contact,
    notes: booking.notes,
    mode: booking.mode,
    createdAt: booking.createdAt,
    totalCents,
    paidOnlineCents,
    balanceCents: Math.max(0, totalCents - paidOnlineCents),
    shareCents: Math.round(minutes * RATE_PER_MINUTE * 100 * payoutPercent / 100),
    assigned: assignedFor(booking, meta),
    paidOut: (meta && meta.paidOut) || {},
  };
}

function summarise(bookings, name) {
  const mine = bookings.filter((b) => b.assigned.includes(name));
  const seats = (b) => b.assigned.filter((n) => n === name).length;
  const earnedCents = mine.reduce((sum, b) => sum + b.shareCents * seats(b), 0);
  const paidCents = mine.reduce((sum, b) => sum + (b.paidOut[name] ? b.shareCents * seats(b) : 0), 0);
  return {
    name,
    sessions: mine.length,
    minutes: mine.reduce((sum, b) => sum + b.minutes * seats(b), 0),
    earnedCents,
    paidCents,
    owedCents: earnedCents - paidCents,
  };
}

async function load() {
  const [raw, metaById, settings] = await Promise.all([listAllBookings(EVENT_DAYS), getAllMeta(), getSettings()]);
  const bookings = raw.map((b) => decorate(b, metaById[b.id], settings.payoutPercent));
  return { bookings, metaById, settings };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const slug = String(req.query.account || '');
  const account = authenticate(req, slug);
  if (!account) return res.status(401).json({ error: 'That passcode did not work.' });

  try {
    if (req.method === 'GET') return res.status(200).json(await view(account));
    if (req.method === 'POST') {
      if (account.role !== 'owner') return res.status(403).json({ error: 'Only the owner can change this.' });
      const error = await act(req.body || {});
      if (error) return res.status(400).json({ error });
      return res.status(200).json(await view(account));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load the dashboard. Try again.' });
  }
}

async function view(account) {
  const { bookings, settings } = await load();

  if (account.role === 'owner') {
    const waitlist = (await listWaitlist()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      role: 'owner',
      name: account.name,
      therapists: THERAPISTS,
      settings,
      bookings,
      waitlist,
      payouts: THERAPISTS.map((n) => summarise(bookings, n)),
    };
  }

  // A therapist sees only their own sessions, and not the house's takings.
  const mine = bookings
    .filter((b) => b.assigned.includes(account.name))
    .map((b) => ({
      id: b.id, dayId: b.dayId, day: b.day, slot: b.slot, startMin: b.startMin, minutes: b.minutes,
      hands: b.hands, session: b.session, name: b.name, contact: b.contact, notes: b.notes,
      with: b.assigned.filter((n) => n && n !== account.name),
      shareCents: b.shareCents * b.assigned.filter((n) => n === account.name).length,
      paidOutAt: b.paidOut[account.name] || null,
    }));
  return {
    role: 'therapist',
    name: account.name,
    payoutPercent: settings.payoutPercent,
    ratePerMinute: RATE_PER_MINUTE,
    bookings: mine,
    summary: summarise(bookings, account.name),
  };
}

async function act(body) {
  const { action } = body;

  if (action === 'settings') {
    const pct = Number(body.payoutPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'Payout must be between 0 and 100%.';
    await setSettings({ payoutPercent: Math.round(pct) });
    return null;
  }

  if (action === 'waitlist') {
    if (!WAITLIST_STATUSES.includes(body.status)) return 'Unknown waitlist status.';
    const entry = (await listWaitlist()).find((w) => w.id === body.id);
    if (!entry) return 'That waitlist entry is gone.';
    await setWaitlistStatus(body.id, body.status);
    return null;
  }

  const { bookings, metaById } = await load();

  if (action === 'payoutAll') {
    if (!THERAPISTS.includes(body.therapist)) return 'Unknown therapist.';
    const now = new Date().toISOString();
    for (const b of bookings) {
      if (b.assigned.includes(body.therapist) && !b.paidOut[body.therapist]) {
        const meta = metaById[b.id] || {};
        await setMeta(b.id, { ...meta, assigned: b.assigned, paidOut: { ...b.paidOut, [body.therapist]: now } });
      }
    }
    return null;
  }

  const booking = bookings.find((b) => b.id === body.id);
  if (!booking) return 'That booking is gone.';
  const meta = metaById[booking.id] || {};

  if (action === 'assign') {
    const assigned = Array.isArray(body.assigned) ? body.assigned.map((n) => String(n || '')) : null;
    if (!assigned || assigned.length !== booking.hands) return `This session needs ${booking.hands} therapist slot(s).`;
    if (assigned.some((n) => n && !THERAPISTS.includes(n))) return 'Unknown therapist.';
    const named = assigned.filter(Boolean);
    if (new Set(named).size !== named.length) return 'The same therapist can’t take two seats in one session.';
    // Keep payout marks only for people still on the session.
    const paidOut = Object.fromEntries(Object.entries(booking.paidOut).filter(([n]) => named.includes(n)));
    await setMeta(booking.id, { ...meta, assigned, paidOut });
    return null;
  }

  if (action === 'payout') {
    if (!booking.assigned.includes(body.therapist)) return 'That therapist isn’t on this session.';
    const paidOut = { ...booking.paidOut };
    if (body.paid) paidOut[body.therapist] = new Date().toISOString();
    else delete paidOut[body.therapist];
    await setMeta(booking.id, { ...meta, assigned: booking.assigned, paidOut });
    return null;
  }

  return 'Unknown action.';
}

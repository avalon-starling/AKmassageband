// Shared storage for bookings. Uses Vercel KV (Upstash Redis) when configured,
// and an in-memory map otherwise so local dev / preview still works.
//
// Data model, per event day:
//   amb:bookings:<dayId>  -> Redis list of JSON booking records
//   amb:hold:<dayId>      -> Redis hash, field "<startMin>-<n>" so a hold is unique
//
// A booking record:
//   { id, dayId, startMin, endMin, minutes, hands, therapist, session,
//     name, contact, notes, amountCents, mode, paymentId, createdAt }

const TOTAL_HANDS = 3; // three therapists = three "hands" units of capacity

let kv = null;
let kvTried = false;
const memory = new Map();

async function store() {
  if (process.env.KV_REST_API_URL && !kvTried) {
    kvTried = true;
    try {
      const mod = await import('@vercel/kv');
      kv = mod.kv;
    } catch (err) {
      kv = null;
    }
  }
  return kv;
}

export async function listBookings(dayId) {
  const db = await store();
  if (db) {
    const raw = await db.lrange(`amb:bookings:${dayId}`, 0, -1);
    return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
  }
  return memory.get(dayId) || [];
}

export async function listAllBookings(dayIds) {
  const all = await Promise.all(dayIds.map((d) => listBookings(d)));
  return all.flat().sort((a, b) => (a.dayId + String(a.startMin)).localeCompare(b.dayId + String(b.startMin)));
}

// Capacity check + write, as close to atomic as this storage gets.
// Returns { ok } or { ok: false, reason }.
export async function reserve(record) {
  const existing = await listBookings(record.dayId);
  const overlapping = existing.filter((b) => b.startMin < record.endMin && b.endMin > record.startMin);

  const handsInUse = overlapping.reduce((sum, b) => sum + (b.hands || 1), 0);
  if (handsInUse + record.hands > TOTAL_HANDS) {
    return { ok: false, reason: 'That time just filled up. Pick another slot.' };
  }
  if (record.therapist && record.therapist !== 'any') {
    const clash = overlapping.some((b) => b.therapist === record.therapist || (b.hands || 1) >= TOTAL_HANDS);
    if (clash) {
      return { ok: false, reason: `${record.therapist} is booked then. Try another time or let us pick.` };
    }
  }

  const db = await store();
  if (db) {
    // hsetnx gives us a single-writer guarantee for this exact start + hand count.
    const won = await db.hsetnx(`amb:hold:${record.dayId}`, `${record.startMin}-${record.id}`, record.id);
    if (!won) return { ok: false, reason: 'That slot was taken a second ago. Pick another.' };
    await db.rpush(`amb:bookings:${record.dayId}`, JSON.stringify(record));
  } else {
    memory.set(record.dayId, existing.concat([record]));
  }
  return { ok: true };
}

export async function release(record) {
  const db = await store();
  if (db) {
    await db.hdel(`amb:hold:${record.dayId}`, `${record.startMin}-${record.id}`);
    const raw = await db.lrange(`amb:bookings:${record.dayId}`, 0, -1);
    const match = raw.find((r) => (typeof r === 'string' ? r : JSON.stringify(r)).includes(record.id));
    if (match) await db.lrem(`amb:bookings:${record.dayId}`, 1, match);
  } else {
    memory.set(record.dayId, (memory.get(record.dayId) || []).filter((b) => b.id !== record.id));
  }
}

export { TOTAL_HANDS };

// Shared storage for bookings. Uses Upstash Redis (Vercel Marketplace → Storage)
// when configured, and an in-memory map otherwise so local dev / preview still works.
//
// Credentials: the Upstash integration injects either
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   or
//   KV_REST_API_URL        / KV_REST_API_TOKEN          (older Vercel KV naming)
// Both are accepted.
//
// Data model, per event day:
//   amb:bookings:<dayId>  -> Redis list of JSON booking records
//
// A booking record:
//   { id, dayId, startMin, endMin, minutes, hands, therapist, session,
//     name, contact, notes, amountCents, mode, paymentId, createdAt }

const TOTAL_HANDS = 3; // three therapists = three "hands" units of capacity

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis = null;
let redisTried = false;
const memory = new Map();

async function store() {
  if (REDIS_URL && REDIS_TOKEN && !redisTried) {
    redisTried = true;
    try {
      const { Redis } = await import('@upstash/redis');
      redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
    } catch (err) {
      redis = null;
    }
  }
  return redis;
}

const key = (dayId) => `amb:bookings:${dayId}`;

const parse = (r) => (typeof r === 'string' ? JSON.parse(r) : r);

export async function listBookings(dayId) {
  const db = await store();
  if (db) {
    const raw = await db.lrange(key(dayId), 0, -1);
    return raw.map(parse);
  }
  return memory.get(dayId) || [];
}

export async function listAllBookings(dayIds) {
  const all = await Promise.all(dayIds.map((d) => listBookings(d)));
  return all.flat().sort((a, b) => (a.dayId + String(a.startMin)).localeCompare(b.dayId + String(b.startMin)));
}

// The capacity rules, shared by the in-memory path and mirrored in the Lua script.
// Returns null when the booking fits, or the reason it doesn't.
function conflict(existing, record) {
  const overlapping = existing.filter((b) => b.startMin < record.endMin && b.endMin > record.startMin);
  const handsInUse = overlapping.reduce((sum, b) => sum + (b.hands || 1), 0);
  if (handsInUse + record.hands > TOTAL_HANDS) return 'full';
  if (record.therapist && record.therapist !== 'any') {
    const clash = overlapping.some((b) => b.therapist === record.therapist || (b.hands || 1) >= TOTAL_HANDS);
    if (clash) return 'therapist';
  }
  return null;
}

// Runs inside Redis as one atomic step: read the day's bookings, check capacity,
// and append only if the new booking fits. No other request can write in between.
// KEYS[1] = day list, ARGV[1] = booking JSON, ARGV[2] = TOTAL_HANDS
const RESERVE_LUA = `
local rec = cjson.decode(ARGV[1])
local total = tonumber(ARGV[2])
local used = 0
local clash = false
for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local b = cjson.decode(raw)
  if b.startMin < rec.endMin and b.endMin > rec.startMin then
    local h = tonumber(b.hands) or 1
    used = used + h
    if rec.therapist and rec.therapist ~= 'any' and (b.therapist == rec.therapist or h >= total) then
      clash = true
    end
  end
end
if used + (tonumber(rec.hands) or 1) > total then return 'full' end
if clash then return 'therapist' end
redis.call('RPUSH', KEYS[1], ARGV[1])
return 'ok'
`;

// Removes the booking whose id matches. KEYS[1] = day list, ARGV[1] = booking id
const RELEASE_LUA = `
for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local ok, b = pcall(cjson.decode, raw)
  if ok and b.id == ARGV[1] then
    return redis.call('LREM', KEYS[1], 1, raw)
  end
end
return 0
`;

function reasonFor(code, record) {
  if (code === 'therapist') return `${record.therapist} is booked then. Try another time or let us pick.`;
  return 'That time just filled up. Pick another slot.';
}

// Capacity check + write, atomic. Returns { ok } or { ok: false, reason }.
export async function reserve(record) {
  const db = await store();
  if (db) {
    const result = await db.eval(RESERVE_LUA, [key(record.dayId)], [JSON.stringify(record), String(TOTAL_HANDS)]);
    return result === 'ok' ? { ok: true } : { ok: false, reason: reasonFor(result, record) };
  }

  // In-memory: no await between the check and the write, so it's atomic within this process.
  const existing = memory.get(record.dayId) || [];
  const code = conflict(existing, record);
  if (code) return { ok: false, reason: reasonFor(code, record) };
  memory.set(record.dayId, existing.concat([record]));
  return { ok: true };
}

export async function release(record) {
  const db = await store();
  if (db) {
    await db.eval(RELEASE_LUA, [key(record.dayId)], [record.id]);
  } else {
    memory.set(record.dayId, (memory.get(record.dayId) || []).filter((b) => b.id !== record.id));
  }
}

export { TOTAL_HANDS };

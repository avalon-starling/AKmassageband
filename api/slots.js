// GET /api/slots?day=sf-sat
// Returns what is already booked for that day so the page can grey out real conflicts
// instead of guessing. No personal data goes out on this route.
import { listBookings, TOTAL_HANDS } from './_store.js';

export default async function handler(req, res) {
  const day = String(req.query.day || '');
  if (!day) return res.status(400).json({ error: 'Missing day' });

  try {
    const bookings = await listBookings(day);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      day,
      totalHands: TOTAL_HANDS,
      booked: bookings.map((b) => ({
        startMin: b.startMin,
        endMin: b.endMin,
        hands: b.hands || 1,
        therapist: b.therapist || 'any',
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not read availability' });
  }
}

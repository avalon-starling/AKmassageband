// GET /api/bookings  — admin only. Requires header  x-admin-token: <ADMIN_TOKEN>
// Set ADMIN_TOKEN in Vercel → Settings → Environment Variables.
import { listAllBookings } from './_store.js';

const DAYS = ['ww-fri', 'ww-sat', 'ww-sun', 'sf-fri', 'sf-sat', 'sf-sun'];

export default async function handler(req, res) {
  const supplied = req.headers['x-admin-token'] || req.query.token;
  if (!process.env.ADMIN_TOKEN || supplied !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Not authorised' });
  }

  try {
    const bookings = await listAllBookings(DAYS);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ bookings });
  } catch (err) {
    return res.status(500).json({ error: 'Could not read bookings' });
  }
}

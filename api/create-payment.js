// POST /api/create-payment
// Reserves the slot FIRST (so two people can't hold the same hands at the same time),
// then charges through Square. If Square declines, the reservation is released.
//
// Vercel → Settings → Environment Variables:
//   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENV (sandbox|production)
//   KV_REST_API_URL + KV_REST_API_TOKEN come free with a Vercel KV store.
import { reserve, release } from './_store.js';

const HOSTS = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const {
    sourceId, amountCents,
    dayId = '', startMin = null, minutes = 0, hands = 1, therapist = 'any',
    name = '', contact = '', day = '', slot = '', session = '', notes = '', mode = 'deposit',
  } = req.body || {};

  if (!sourceId || !Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: 'Missing card token or amount.' });
  }
  if (!dayId || startMin === null || !minutes) {
    return res.status(400).json({ error: 'Missing slot details.' });
  }

  const record = {
    id: `amb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dayId, startMin, endMin: startMin + minutes, minutes, hands, therapist,
    session, name, contact, notes, amountCents, mode,
    day, slot, paymentId: null, createdAt: new Date().toISOString(),
  };

  // 1. Claim the slot before touching money.
  const claim = await reserve(record);
  if (!claim.ok) return res.status(409).json({ error: claim.reason });

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    await release(record);
    return res.status(500).json({ error: 'Square is not configured on the server.' });
  }

  const host = HOSTS[process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox'];
  const note = [
    `${session} ${minutes}min`,
    hands > 1 ? `${hands * 2} hands` : '2 hands',
    `${day} ${slot}`,
    name, contact,
    mode === 'full' ? 'paid in full' : 'deposit',
    notes,
  ].filter(Boolean).join(' | ').slice(0, 500);

  try {
    const response = await fetch(`${host}/v2/payments`, {
      method: 'POST',
      headers: {
        'Square-Version': '2025-01-23',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: record.id,
        source_id: sourceId,
        location_id: locationId,
        amount_money: { amount: amountCents, currency: 'USD' },
        // Deposits are authorised now and captured when the session happens.
        autocomplete: mode === 'full',
        note,
        buyer_email_address: contact.includes('@') ? contact : undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      await release(record);
      const detail = data?.errors?.[0]?.detail || 'Square declined the payment.';
      return res.status(response.status).json({ error: detail });
    }

    return res.status(200).json({
      ok: true,
      bookingId: record.id,
      paymentId: data.payment?.id,
      status: data.payment?.status,
      receiptUrl: data.payment?.receipt_url,
    });
  } catch (err) {
    await release(record);
    return res.status(502).json({ error: 'Could not reach Square. Try again or pay at the booth.' });
  }
}

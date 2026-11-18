# Deploying to Vercel with Square payments

## 1. Get your Square IDs

In the [Square Developer dashboard](https://developer.squareup.com/apps), create an application. You need four values:

| Value | Where it goes |
|---|---|
| **Application ID** (`sandbox-sq0idb-…` / `sq0idp-…`) | Tweaks panel → `squareAppId` (this one is public, it's safe in the page) |
| **Location ID** | Tweaks panel → `squareLocationId` **and** the `SQUARE_LOCATION_ID` env var |
| **Access token** | Vercel env var `SQUARE_ACCESS_TOKEN` only — never in the page |
| Sandbox or production | Tweaks `squareSandbox` (true/false) **and** env var `SQUARE_ENV` |

Test with the sandbox pair first. Square's test card is `4111 1111 1111 1111`, any future expiry, CVV `111`.

## 2. Environment variables in Vercel

Project → Settings → Environment Variables:

```
SQUARE_ACCESS_TOKEN = <your access token>
SQUARE_LOCATION_ID  = <your location id>
SQUARE_ENV          = sandbox        # switch to "production" when you go live
ADMIN_TOKEN         = <a long random string>   # the passcode for the Bookings page
```

Also add a **KV store**: Vercel → Storage → Create → KV, connect it to this project. That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Then `npm i @vercel/kv`. Without a KV store the booking list lives in memory and resets on every deploy — fine for testing, not for a real weekend.

## 3. Deploy

The repo needs two things: the site as `index.html` at the root (already here — the bundled, self-contained page; the editable source is in `design/`), and `api/create-payment.js` (already written here — Vercel picks up anything in `/api` automatically, no config file needed).

Ask me to **export the standalone HTML** and I'll produce a single self-contained `index.html` with the images and fonts inlined. Then:

```
vercel            # preview deploy
vercel --prod     # live
```

Add your domain under Project → Settings → Domains and follow the DNS instructions Vercel gives you.

## 4. How money actually moves

- **Deposit** (default, 25%): the card is *authorised*, not captured. You collect the balance at the booth and the hold releases or captures from your Square dashboard. Square authorisations expire after ~6 days, so only take deposits inside that window.
- **Pay in full**: charged immediately.
- Either way the payment note carries the name, day, time, session type, and hand count, so it's readable in your Square dashboard next to the booth sales.

## 5. How double-booking is prevented

Capacity is three therapists — three "hands units." A two-hand session uses one, four-handed uses two, six-handed uses all three.

- `GET /api/slots?day=sf-sat` returns what's already booked (times and hand counts only, no names). The page greys out any start time where the overlap would exceed capacity, or where the specific therapist you asked for is already working.
- `POST /api/create-payment` **claims the slot before charging.** If someone beat you to it you get a 409, the page sends you back to the time grid with refreshed availability, and no card is charged. If Square then declines, the claim is released.

With no API reachable (local preview, static-only hosting) the grid shows sample occupancy so the flow still demos.

## 6. The Bookings page

Footer → **Band login**. Enter `ADMIN_TOKEN` and it reads `GET /api/bookings`. Until deployed it shows sample rows with a yellow notice. Walk-ups added at the booth aren't in here.

## 7. Still to wire up

The waitlist and hire-us forms are still front-end only — say the word and I'll point them at an email service or the same API.

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

Also add a database: Vercel → Storage → **Upstash Redis** (Marketplace), connected to this project. That injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the older `KV_REST_API_URL` / `KV_REST_API_TOKEN`; `api/_store.js` accepts either). Without it the booking list lives in memory and resets on every deploy: fine for testing, not for a real weekend.

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
- `POST /api/create-payment` **claims the slot before charging.** The capacity check and the write run as one Lua script inside Redis, so two simultaneous requests can't both take the last hands. If someone beat you to it you get a 409, the page sends you back to the time grid with refreshed availability, and no card is charged. If Square then declines, the claim is released.

With no API reachable (local preview, static-only hosting) the grid shows sample occupancy so the flow still demos.

## 6. Dashboards

| Page | Who | Passcode (Vercel env var) | Sees |
|---|---|---|---|
| `/alice` | Owner | `ALICE_TOKEN`, or the existing `ADMIN_TOKEN` | Every booking with money, the day-of waitlist, payouts for every therapist |
| `/nalani` | Therapist | `NALANI_TOKEN` | Only the sessions she's assigned to, and what she's earned, been paid and is owed |

- **Assigning:** a booking for a named therapist fills the first seat; "Whoever is free" and the extra seats on four- and six-handed sessions start unassigned. Alice picks therapists in the Bookings tab, and a session shows on a therapist's dashboard once they're on it.
- **Payouts:** a therapist earns the payout percentage (set on Alice's Payouts tab, 100% until she changes it) of $2/min for their time on each session. Alice marks each share paid, or all of a therapist's owed shares at once.
- **Waitlist:** people join from the booking page's waitlist tab. Alice marks them called, served or removed; the list refreshes every 30 seconds while open.
- **Adding a therapist:** add them to `ACCOUNTS` in `api/_auth.js` with a passcode variable, copy `nalani.html` to `<name>.html` and change `data-account`, and set the variable in Vercel.

The footer's **Band login** still opens the older bookings list with `ADMIN_TOKEN`.

## 7. Still to wire up

The hire-us form is still front-end only.

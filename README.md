# FOXXY

Landing site for the FOXXY NFT project — Ethereum.

## Files
- `index.html` — intro narrative with typewriter story and hero video
- `world.html` — four eras, how-it-works utility breakdown, tiers
- `waitlist.html` — pre-launch FOMO page: countdown, benefits, Connect X, task checklist, wallet submission
- `assets/` — all videos, posters, wordmark and fox art
- `server.js` — Express server: serves the site, handles Sign-In with X, and the waitlist API (SQLite)
- `scripts/check-follow-access.js` — one-off script to test whether your paid X API token can check follows (see below)
- `waitlist.sqlite` — created automatically on first run (not committed to git)

## Local setup
```bash
cd foxxy-final
npm install
cp .env.example .env   # then fill in the values, see below
npm start
```
Then open `http://localhost:3000`.

The old `python3 -m http.server` approach still works for just browsing pages,
but `npm start` is required for the waitlist form (Connect X + saving entries)
to actually work.

## Setting up "Connect X" (Sign-In with X)
This uses OAuth 2.0 login, which is free — it's separate from the paid X Data
API and is not affected by the 2026 follow/like restrictions.

1. Go to developer.x.com → your app → **User authentication settings** → enable
   OAuth 2.0.
2. Set **Type of App** to "Web App" and add a callback URL:
   - local dev: `http://localhost:3000/auth/x/callback`
   - production: `https://yourdomain.com/auth/x/callback`
3. Copy the **Client ID** and **Client Secret** shown there (not the Bearer
   Token — that's a different credential) into `.env` / your Railway
   variables as `X_CLIENT_ID` and `X_CLIENT_SECRET`.
4. Set `X_REDIRECT_URI` to match exactly whichever callback URL you used.
5. Set `FOXXY_X_HANDLE` to the account people should follow (no `@`).
6. Set `WAITLIST_DEADLINE` to a fixed ISO timestamp for the countdown, e.g.
   `2026-10-01T18:00:00Z`. Leaving it unset means the countdown resets to
   "24h from now" every time the server restarts, which you don't want for a
   real campaign.

Until `X_CLIENT_ID`/`X_CLIENT_SECRET` are set, clicking "Connect X" on the
page will show a friendly error instead of crashing.

## Why "followed" and "notifications" are checkboxes, not live checks
As of April 2026, X removed follow/like data from self-serve API access —
there is currently no way to programmatically verify someone followed an
account, at any price, without an Enterprise contract. The "turned on
notifications" toggle has never been exposed through any X API tier, ever.
So both are honest self-report checkboxes, with copy on the page noting that
spots are "subject to verification" — this is the standard approach other
projects use for the same reason.

If you want to double check whether your specific paid token (the Bearer
Token from your buybot) still has any follow-related access:
```bash
X_BEARER_TOKEN=your_token_here TARGET_USERNAME=Foxxy_ethn node scripts/check-follow-access.js
```
This makes exactly one test request — it won't run at scale or rack up cost.
It'll tell you plainly whether real follow-checking is even purchasable on
your account right now.

## Waitlist API
- `GET /api/campaign` — `{ deadline, xHandle }`, used to render the countdown
- `GET /auth/x/login` / `GET /auth/x/callback` — the Sign-In with X flow
- `GET /api/me` — `{ connected: bool, username? }` for the currently connected browser
- `POST /api/waitlist` — body `{ wallet, followed: true, notifications: true }`,
  requires an active X connection (cookie-based). `201` on success, `400` on
  bad/incomplete input, `401` if X isn't connected yet, `409` if that X
  account already joined.
- `GET /api/waitlist/count` — `{ count: N }`

Entries live in `waitlist.sqlite` in this folder (SQLite via `better-sqlite3`
— no external database needed). To peek at signups:
```bash
sqlite3 waitlist.sqlite "SELECT * FROM waitlist;"
```

## Deploying (Railway)
Railway detects `package.json`, runs `npm install` then `npm start`
automatically. Set all the `.env.example` variables in Railway's Variables
tab (using your production domain for `X_REDIRECT_URI`, and adding that same
callback URL in the X developer dashboard too).

SQLite writes to a local file, so if you redeploy/restart on a platform with
an ephemeral filesystem, waitlist data resets. Fine for a short pre-launch
window — flag it to me if you need entries to survive redeploys long-term,
that's when we'd move to Postgres/Supabase instead.

// FOXXY — static site server + waitlist API backed by SQLite (better-sqlite3)
//
// Identity is "Sign-In with X" (OAuth 2.0 + PKCE), NOT the paid X Data API.
// We never attempt to programmatically verify "followed" or "turned on
// notifications" — X removed follow/like checks from self-serve access in
// April 2026, and the notifications toggle has never been exposed via any
// API tier. Those two are honest self-report checkboxes; see README.md.

try { require('dotenv').config(); } catch (e) { /* dotenv is optional in production */ }

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.WAITLIST_DB_PATH || path.join(__dirname, 'waitlist.sqlite');

// ── Config ──────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const X_CLIENT_ID = process.env.X_CLIENT_ID || '';
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const X_REDIRECT_URI = process.env.X_REDIRECT_URI || `http://localhost:${PORT}/auth/x/callback`;
const FOXXY_X_HANDLE = process.env.FOXXY_X_HANDLE || 'Foxxy_ethn';
// Fixed deadline so every visitor sees the same countdown, not one that
// resets per-visitor. Defaults to "24h from server start" if unset, but for
// a real campaign set WAITLIST_DEADLINE to an ISO timestamp as an env var
// (e.g. 2026-10-01T18:00:00Z) so restarts don't change it.
const WAITLIST_DEADLINE = process.env.WAITLIST_DEADLINE || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// ── DB ──────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    x_user_id TEXT NOT NULL UNIQUE,
    x_handle TEXT NOT NULL,
    wallet TEXT NOT NULL,
    followed INTEGER NOT NULL DEFAULT 0,
    notifications INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const insertEntry = db.prepare(
  'INSERT INTO waitlist (x_user_id, x_handle, wallet, followed, notifications) VALUES (?, ?, ?, ?, ?)'
);
const countEntries = db.prepare('SELECT COUNT(*) AS count FROM waitlist');

app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

// ── Signed cookie helpers (stateless — no session store needed) ─────────
function sign(value) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  return value;
}

// ── PKCE helpers ──────────────────────────────────────────────────────
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function genCodeVerifier() {
  return base64url(crypto.randomBytes(32));
}
function codeChallengeFromVerifier(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// ── Campaign info (countdown + handle, same for everyone) ──────────────
app.get('/api/campaign', (req, res) => {
  res.json({ deadline: WAITLIST_DEADLINE, xHandle: FOXXY_X_HANDLE });
});

// ── Sign-In with X (OAuth 2.0 + PKCE) ───────────────────────────────────
app.get('/auth/x/login', (req, res) => {
  if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
    return res.redirect('/waitlist.html?x_error=not_configured');
  }
  const verifier = genCodeVerifier();
  const challenge = codeChallengeFromVerifier(verifier);
  const state = base64url(crypto.randomBytes(16));
  const pkce = sign(JSON.stringify({ verifier, state }));

  res.cookie('x_oauth', pkce, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: X_CLIENT_ID,
    redirect_uri: X_REDIRECT_URI,
    scope: 'users.read tweet.read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/x/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const raw = unsign(req.cookies.x_oauth);
    if (!raw) return res.redirect('/waitlist.html?x_error=session_expired');

    const { verifier, state: savedState } = JSON.parse(raw);
    if (!code || state !== savedState) {
      return res.redirect('/waitlist.html?x_error=state_mismatch');
    }

    const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: X_REDIRECT_URI,
        code_verifier: verifier
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      console.error('X token exchange failed:', tokenData);
      return res.redirect('/waitlist.html?x_error=token_failed');
    }

    const meResp = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const meData = await meResp.json();
    if (!meResp.ok || !meData.data) {
      console.error('X profile fetch failed:', meData);
      return res.redirect('/waitlist.html?x_error=profile_failed');
    }

    const identity = sign(JSON.stringify({ id: meData.data.id, username: meData.data.username }));
    res.clearCookie('x_oauth');
    res.cookie('fx_id', identity, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 });
    res.redirect('/waitlist.html?connected=1');
  } catch (err) {
    console.error('X OAuth callback error:', err);
    res.redirect('/waitlist.html?x_error=unexpected');
  }
});

app.get('/api/me', (req, res) => {
  const raw = unsign(req.cookies.fx_id);
  if (!raw) return res.json({ connected: false });
  const data = JSON.parse(raw);
  res.json({ connected: true, username: data.username });
});

// ── Waitlist submission ─────────────────────────────────────────────────
app.post('/api/waitlist', (req, res) => {
  const raw = unsign(req.cookies.fx_id);
  if (!raw) {
    return res.status(401).json({ error: 'Connect your X account first.' });
  }
  const identity = JSON.parse(raw);
  const body = req.body || {};
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  const followed = !!body.followed;
  const notifications = !!body.notifications;

  if (!WALLET_RE.test(wallet)) {
    return res.status(400).json({ error: "That wallet address doesn't look right." });
  }
  if (!followed || !notifications) {
    return res.status(400).json({ error: 'Complete both tasks to join the list.' });
  }

  try {
    insertEntry.run(identity.id, identity.username, wallet, followed ? 1 : 0, notifications ? 1 : 0);
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'That X account is already on the list.' });
    }
    console.error('waitlist insert failed:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

app.get('/api/waitlist/count', (req, res) => {
  const row = countEntries.get();
  res.json({ count: row.count });
});

app.listen(PORT, () => {
  console.log(`FOXXY server running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
    console.log('⚠️  X_CLIENT_ID / X_CLIENT_SECRET not set — "Connect X" will not work until these are configured. See README.md.');
  }
});

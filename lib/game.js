// lib/game.js — Era Run score banking.
// Routed through /api/score?game=1 (vercel.json rewrites /api/game here) so we stay
// within the 12-function limit.
//
//   POST /api/game?action=start   -> { token }            (signed run ticket)
//   POST /api/game?action=finish  body { token, wallet, distance, crystals, score, duration }
//   GET  /api/game?action=best&wallet=0x...
//
// Game points = floor(best score / PTS_PER_SCORE), capped at MAX_PTS, and added to the
// wallet's total score immediately. Checks reject impossible runs (too far for the time
// played, too many crystals, replayed tickets). They stop simple fakes, not dedicated bots.
const crypto = require('crypto');
const { getDb } = require('./db');

const SECRET        = process.env.GAME_SECRET || process.env.SESSION_SECRET || 'dev-secret-change-me';
const PTS_PER_SCORE = 50;    // 1 point per 50 game score
const MAX_PTS       = 150;   // cap on points the game can add
const MAX_RUN_AGE_S = 3 * 3600;
const WALLET_RE     = /^0x[a-fA-F0-9]{40}$/;

// Game speed: v = min(30, 14 + 0.006 * distance) m/s  ->  furthest possible distance after t seconds
function maxDistance(t){
  const tCap = Math.log(30 / 14) / 0.006;          // ~127 s to reach top speed
  if (t <= tCap) return (14 / 0.006) * (Math.exp(0.006 * t) - 1);
  return (30 - 14) / 0.006 + 30 * (t - tCap);
}

const b64 = s => Buffer.from(s).toString('base64url');
function sign(obj){
  const body = b64(JSON.stringify(obj));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token){
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
}

let schemaReady = false;
async function ensureGameSchema(db){
  if (schemaReady) return;
  await db`
    CREATE TABLE IF NOT EXISTS game_runs (
      nonce       TEXT PRIMARY KEY,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      used        BOOLEAN NOT NULL DEFAULT FALSE,
      wallet      TEXT,
      score       INTEGER,
      finished_at TIMESTAMPTZ
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS game_best (
      wallet      TEXT PRIMARY KEY,
      best_score  INTEGER NOT NULL DEFAULT 0,
      pts         INTEGER NOT NULL DEFAULT 0,
      distance    INTEGER,
      crystals    INTEGER,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`;
  schemaReady = true;
}

const bad = (res, msg) => res.status(400).json({ ok: false, error: msg });
const int = v => (Number.isInteger(v) && v >= 0 ? v : null);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = String(req.query.action || body.action || '');
  try {
    const db = getDb();
    await ensureGameSchema(db);

    if (action === 'start'){
      if (req.method !== 'POST') return res.status(405).end();
      const nonce = crypto.randomBytes(12).toString('hex');
      await db`INSERT INTO game_runs (nonce) VALUES (${nonce})`;
      return res.status(200).json({ ok: true, token: sign({ n: nonce, t: Date.now() }) });
    }

    if (action === 'best'){
      const w = String(req.query.wallet || '').trim();
      if (!WALLET_RE.test(w)) return bad(res, 'Invalid wallet address.');
      const rows = await db`SELECT best_score, pts FROM game_best WHERE wallet = ${w.toLowerCase()}`;
      return res.status(200).json({ ok: true, best: rows[0]?.best_score || 0, pts: rows[0]?.pts || 0, maxPts: MAX_PTS });
    }

    if (action === 'finish'){
      if (req.method !== 'POST') return res.status(405).end();
      const t = verify(body.token);
      if (!t || !t.n || !t.t) return bad(res, 'This run has no valid ticket. Start a new run on foxxyeth.xyz.');
      const elapsed = (Date.now() - t.t) / 1000;
      if (elapsed > MAX_RUN_AGE_S) return bad(res, 'This run is too old to bank.');

      const rawWallet = String(body.wallet || '').trim();
      if (!WALLET_RE.test(rawWallet)) return bad(res, "That doesn't look like a valid ETH address.");
      const wallet = rawWallet.toLowerCase();

      const distance = int(body.distance), crystals = int(body.crystals), score = int(body.score);
      const duration = Number(body.duration);
      if (distance === null || crystals === null || score === null || !Number.isFinite(duration)) return bad(res, 'Run data is malformed.');
      if (score !== distance + crystals * 10)              return bad(res, 'Run rejected: score does not add up.');
      if (duration < 3 || duration > elapsed + 3)          return bad(res, 'Run rejected: timing does not match.');
      if (distance > maxDistance(duration) * 1.05 + 30)    return bad(res, 'Run rejected: too far for the time played.');
      if (crystals > distance * 0.45 + 5)                  return bad(res, 'Run rejected: too many crystals.');

      // single use ticket
      const used = await db`
        UPDATE game_runs SET used = TRUE, wallet = ${wallet}, score = ${score}, finished_at = NOW()
        WHERE nonce = ${t.n} AND used = FALSE RETURNING nonce`;
      if (!used.length) return bad(res, 'This run was already banked.');

      const prev = await db`SELECT best_score, pts FROM game_best WHERE wallet = ${wallet}`;
      const oldBest = prev[0]?.best_score || 0, oldPts = prev[0]?.pts || 0;
      if (score <= oldBest){
        return res.status(200).json({ ok: true, improved: false, best: oldBest, pts: oldPts, maxPts: MAX_PTS });
      }
      const pts = Math.min(MAX_PTS, Math.floor(score / PTS_PER_SCORE));
      await db`
        INSERT INTO game_best (wallet, best_score, pts, distance, crystals)
        VALUES (${wallet}, ${score}, ${pts}, ${distance}, ${crystals})
        ON CONFLICT (wallet) DO UPDATE
          SET best_score = EXCLUDED.best_score, pts = EXCLUDED.pts,
              distance = EXCLUDED.distance, crystals = EXCLUDED.crystals, updated_at = NOW()`;
      const delta = pts - oldPts;
      if (delta !== 0){
        // apply to the stored total right away (a full rescore also adds game_best.pts)
        await db`
          UPDATE scores
             SET total_score = total_score + ${delta},
                 breakdown   = jsonb_set(COALESCE(breakdown, '{}'::jsonb), '{game}', to_jsonb(${pts}::int))
           WHERE wallet = ${wallet}`;
      }
      return res.status(200).json({ ok: true, improved: true, best: score, pts, added: delta, maxPts: MAX_PTS });
    }

    return bad(res, 'Unknown action.');
  } catch (err) {
    console.error('game error:', err);
    return res.status(500).json({ ok: false, error: 'Server error. Try again.' });
  }
};

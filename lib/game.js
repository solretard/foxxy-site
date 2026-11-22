// lib/game.js — Era Run score banking.
// Routed through /api/score?game=1 (vercel.json rewrites /api/game here) so we stay
// within the 12-function limit.
//
//   POST /api/game?action=start   body { wallet }  -> { token }   (signed run ticket, wallet locked in)
//   POST /api/game?action=finish  body { token, distance, crystals, score, duration }
//   GET  /api/game?action=best&wallet=0x...
//
// Every run adds up: 1 point per PTS_PER_SCORE game score (remainders carry over),
// max DAILY_CAP points per UTC day and MAX_PTS in total, added to the wallet's total
// score immediately. Checks reject impossible runs (too far for the time played, too
// many crystals, replayed tickets). They stop simple fakes, not dedicated bots.
const crypto = require('crypto');
const { getDb } = require('./db');

const SECRET        = process.env.GAME_SECRET || process.env.SESSION_SECRET || 'dev-secret-change-me';
const PTS_PER_SCORE = 200;   // 1 point per 200 game score (runs add up)
const DAILY_CAP     = 20;    // max game points per wallet per UTC day
const MAX_PTS       = 150;   // max game points per wallet in total
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
  await db`
    ALTER TABLE game_best
      ADD COLUMN IF NOT EXISTS total_score BIGINT  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS runs        INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS day         DATE,
      ADD COLUMN IF NOT EXISTS day_pts     INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS carry       INTEGER NOT NULL DEFAULT 0`;
  schemaReady = true;
}

const today = () => new Date(Date.now()).toISOString().slice(0, 10);
const dayStr = v => !v ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
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
      const w = String(body.wallet || '').trim();
      if (!WALLET_RE.test(w)) return bad(res, 'Add a valid ETH wallet to earn points.');
      const nonce = crypto.randomBytes(12).toString('hex');
      await db`INSERT INTO game_runs (nonce, wallet) VALUES (${nonce}, ${w.toLowerCase()})`;
      return res.status(200).json({ ok: true, token: sign({ n: nonce, t: Date.now(), w: w.toLowerCase() }) });
    }

    if (action === 'best'){
      const w = String(req.query.wallet || '').trim();
      if (!WALLET_RE.test(w)) return bad(res, 'Invalid wallet address.');
      const rows = await db`SELECT best_score, pts, runs, day, day_pts FROM game_best WHERE wallet = ${w.toLowerCase()}`;
      const r = rows[0] || {};
      const dayPts = dayStr(r.day) === today() ? (r.day_pts || 0) : 0;
      return res.status(200).json({ ok: true, best: r.best_score || 0, pts: r.pts || 0, runs: r.runs || 0, dayPts, dayCap: DAILY_CAP, maxPts: MAX_PTS });
    }

    if (action === 'finish'){
      if (req.method !== 'POST') return res.status(405).end();
      const t = verify(body.token);
      if (!t || !t.n || !t.t) return bad(res, 'This run has no valid ticket. Start a new run on foxxyeth.xyz.');
      const elapsed = (Date.now() - t.t) / 1000;
      if (elapsed > MAX_RUN_AGE_S) return bad(res, 'This run is too old to bank.');

      const wallet = String(t.w || '');
      if (!WALLET_RE.test(wallet)) return bad(res, 'This run has no wallet attached.');

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

      const prev = await db`SELECT pts, best_score, total_score, runs, day, day_pts, carry FROM game_best WHERE wallet = ${wallet}`;
      const P = prev[0] || { pts: 0, best_score: 0, total_score: 0, runs: 0, day: null, day_pts: 0, carry: 0 };
      const d = today();
      let dayPts = dayStr(P.day) === d ? (P.day_pts || 0) : 0;
      const raw = (P.carry || 0) + score;
      const earned = Math.floor(raw / PTS_PER_SCORE), carry = raw % PTS_PER_SCORE;
      const room = Math.max(0, Math.min(DAILY_CAP - dayPts, MAX_PTS - (P.pts || 0)));
      const added = Math.min(earned, room);
      const pts = (P.pts || 0) + added; dayPts += added;
      const best = Math.max(P.best_score || 0, score), runs = (P.runs || 0) + 1, totalScore = Number(P.total_score || 0) + score;
      await db`
        INSERT INTO game_best (wallet, best_score, pts, distance, crystals, total_score, runs, day, day_pts, carry)
        VALUES (${wallet}, ${best}, ${pts}, ${distance}, ${crystals}, ${totalScore}, ${runs}, ${d}, ${dayPts}, ${carry})
        ON CONFLICT (wallet) DO UPDATE
          SET best_score = EXCLUDED.best_score, pts = EXCLUDED.pts, distance = EXCLUDED.distance, crystals = EXCLUDED.crystals,
              total_score = EXCLUDED.total_score, runs = EXCLUDED.runs, day = EXCLUDED.day, day_pts = EXCLUDED.day_pts,
              carry = EXCLUDED.carry, updated_at = NOW()`;
      if (added > 0){
        // apply to the stored total right away (a full rescore also adds game_best.pts)
        await db`
          UPDATE scores
             SET total_score = total_score + ${added},
                 breakdown   = jsonb_set(COALESCE(breakdown, '{}'::jsonb), '{game}', to_jsonb(${pts}::int))
           WHERE wallet = ${wallet}`;
      }
      return res.status(200).json({ ok: true, added, pts, maxPts: MAX_PTS, dayPts, dayCap: DAILY_CAP, best, runs,
        limited: added < earned ? (pts >= MAX_PTS ? 'total' : 'daily') : null });
    }

    return bad(res, 'Unknown action.');
  } catch (err) {
    console.error('game error:', err);
    return res.status(500).json({ ok: false, error: 'Server error. Try again.' });
  }
};

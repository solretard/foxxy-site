// POST /api/waitlist — join the waitlist.
// Requires an active X connection (fx_id cookie) + all tasks completed.

const { unsign, parseCookies } = require('../../lib/crypto');
const { getDb, ensureSchema } = require('../../lib/db');

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const VALID_ERAS = new Set(['I', 'II', 'III', 'IV']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Auth check ──────────────────────────────────────────────────────────
  const cookies = parseCookies(req);
  const raw = unsign(cookies.fx_id);
  if (!raw) {
    return res.status(401).json({ error: 'Connect your X account first.' });
  }

  let identity;
  try { identity = JSON.parse(raw); } catch {
    return res.status(401).json({ error: 'Session invalid — reconnect your X account.' });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body = req.body;
  if (!body || typeof body !== 'object') {
    // Vercel doesn't auto-parse JSON unless you opt in — handle manually
    try {
      const buf = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      body = JSON.parse(buf.toString() || '{}');
    } catch {
      body = {};
    }
  }

  const wallet     = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  const followed   = !!body.followed;
  const notifications = !!body.notifications;
  const liked      = !!body.liked;
  const reposted   = !!body.reposted;
  const comment_era = typeof body.comment_era === 'string' ? body.comment_era.trim().toUpperCase() : '';

  // ── Validation ──────────────────────────────────────────────────────────
  if (!WALLET_RE.test(wallet)) {
    return res.status(400).json({ error: "That wallet address doesn't look right." });
  }
  if (!followed || !notifications || !liked || !reposted) {
    return res.status(400).json({ error: 'Complete all tasks above to join the list.' });
  }
  if (!VALID_ERAS.has(comment_era)) {
    return res.status(400).json({ error: 'Select which era you think drops first.' });
  }

  // ── DB insert ───────────────────────────────────────────────────────────
  try {
    const sql = getDb();
    await ensureSchema();

    await sql`
      INSERT INTO waitlist (x_user_id, x_handle, wallet, followed, notifications, liked, reposted, comment_era)
      VALUES (${identity.id}, ${identity.username}, ${wallet}, ${followed}, ${notifications}, ${liked}, ${reposted}, ${comment_era})
    `;

    return res.status(201).json({ ok: true });
  } catch (err) {
    // Postgres unique constraint violation = duplicate X account
    if (err && (err.code === '23505' || (err.message && err.message.includes('unique')))) {
      return res.status(409).json({ error: 'That X account is already on the list.' });
    }
    console.error('waitlist insert error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};

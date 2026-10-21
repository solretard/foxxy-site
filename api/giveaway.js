// POST /api/giveaway  — FCFS giveaway entry
// Body: { wallet, tweet_url }
// Returns: { slot, remaining, total } on success
//          { error } on failure

const { getDb, ensureSchema } = require('../lib/db');

const WALLET_RE  = /^0x[a-fA-F0-9]{40}$/i;
const TOTAL_SLOTS = 50;

module.exports = async (req, res) => {
  // CORS — same origin + curl-friendly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const wallet    = (body.wallet    || '').trim().toLowerCase();
  const tweet_url = (body.tweet_url || '').trim();

  if (!WALLET_RE.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }

  try {
    const db = getDb();
    await ensureSchema();

    // How many slots are taken?
    const [{ cnt }] = await db`SELECT COUNT(*)::int AS cnt FROM giveaway_entries`;
    if (cnt >= TOTAL_SLOTS) {
      return res.status(409).json({ error: 'All slots are filled. Giveaway is closed.' });
    }

    // Already entered?
    const existing = await db`SELECT slot FROM giveaway_entries WHERE wallet = ${wallet}`;
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'This wallet already has a slot.',
        slot: existing[0].slot,
        remaining: TOTAL_SLOTS - cnt,
        total: TOTAL_SLOTS,
      });
    }

    const slot = cnt + 1;

    await db`
      INSERT INTO giveaway_entries (wallet, tweet_url, slot)
      VALUES (${wallet}, ${tweet_url || null}, ${slot})
    `;

    return res.status(200).json({
      success: true,
      slot,
      remaining: TOTAL_SLOTS - slot,
      total: TOTAL_SLOTS,
      message: `You're slot #${slot} — ${TOTAL_SLOTS - slot} spots left!`,
    });
  } catch (err) {
    console.error('giveaway error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};

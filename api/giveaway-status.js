// GET /api/giveaway-status — public slot count
const { getDb, ensureSchema } = require('../lib/db');
const TOTAL_SLOTS = 50;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const db = getDb();
    await ensureSchema();
    const [{ cnt }] = await db`SELECT COUNT(*)::int AS cnt FROM giveaway_entries`;
    return res.status(200).json({ total: TOTAL_SLOTS, taken: cnt, remaining: TOTAL_SLOTS - cnt });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch slot count.' });
  }
};

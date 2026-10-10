// GET /api/leaderboard — return top 100 wallets by score.

const { getDb, ensureSchema } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = getDb();
    await ensureSchema();

    const rows = await db`
      SELECT wallet, total_score, breakdown, scored_at
      FROM scores
      ORDER BY total_score DESC
      LIMIT 100
    `;

    const leaderboard = rows.map((r, i) => ({
      rank:      i + 1,
      wallet:    r.wallet,
      score:     r.total_score,
      projects:  r.breakdown?.projects || [],
      scored_at: r.scored_at,
    }));

    const countRow = await db`SELECT COUNT(*) AS cnt FROM scores`;
    const totalScored = parseInt(countRow[0]?.cnt || 0);

    return res.status(200).json({ leaderboard, totalScored });
  } catch (err) {
    console.error('leaderboard error:', err);
    return res.status(500).json({ error: 'Could not load leaderboard.' });
  }
};

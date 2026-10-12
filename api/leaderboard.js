// GET /api/leaderboard?limit=50&page=0
// Returns top wallets ranked by total_score from the scores table.

const { getDb, ensureSchema } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const limit  = Math.min(parseInt(req.query.limit  || 50),  100);
  const page   = Math.max(parseInt(req.query.page   || 0),   0);
  const offset = page * limit;

  try {
    const db = getDb();
    await ensureSchema();

    const [rows, countRow] = await Promise.all([
      db`
        SELECT wallet, total_score, breakdown, scored_at
        FROM scores
        ORDER BY total_score DESC, scored_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      db`SELECT COUNT(*) AS cnt FROM scores`,
    ]);

    const total = parseInt(countRow[0]?.cnt || 0);

    const entries = rows.map((row, i) => ({
      rank:       offset + i + 1,
      wallet:     row.wallet,
      score:      row.total_score,
      projects:   row.breakdown?.projects   || [],
      nft_count:  row.breakdown?.nft_count  || 0,
      scored_at:  row.scored_at,
    }));

    return res.status(200).json({ entries, total, page, limit });
  } catch (err) {
    console.error('leaderboard error:', err);
    return res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
};

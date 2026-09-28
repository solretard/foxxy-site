// GET /api/waitlist/count — returns current signup count.

const { getDb, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();
    await ensureSchema();
    const rows = await sql`SELECT COUNT(*) AS count FROM waitlist`;
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err) {
    console.error('count error:', err);
    res.status(500).json({ count: 0 });
  }
};

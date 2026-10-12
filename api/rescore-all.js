// POST /api/rescore-all — rescores the 10 most stale wallets in the DB.
// Called by a Cloudflare Worker cron every 30 min.
// Requires header: x-rescore-secret: <RESCORE_SECRET env var>

const { getDb, ensureSchema } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // Auth check — set RESCORE_SECRET in Vercel env vars
  const secret = process.env.RESCORE_SECRET;
  if (!secret || req.headers['x-rescore-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getDb();
  await ensureSchema();

  // Grab the 10 wallets that haven't been scored in the longest time
  const rows = await db`
    SELECT wallet FROM scores
    ORDER BY scored_at ASC NULLS FIRST
    LIMIT 10
  `;

  if (!rows.length) return res.status(200).json({ rescored: 0, message: 'No wallets yet' });

  // Use SITE_URL env var (set this in Vercel to your production domain)
  const base = (process.env.SITE_URL || `https://${process.env.VERCEL_URL}`).replace(/\/$/, '');

  const results = await Promise.allSettled(
    rows.map(row =>
      fetch(`${base}/api/score?wallet=${row.wallet}`, {
        signal: AbortSignal.timeout(9000),
      })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const failed    = results.length - succeeded;

  console.log(`rescore-all: ${succeeded} ok, ${failed} failed`);
  return res.status(200).json({ rescored: succeeded, failed, total: rows.length });
};

// POST /api/admin/credit-giveaway
// Body: { secret: "RESCORE_SECRET value" }
// Credits 20 bonus points to every uncredited giveaway entry.

const { getDb, ensureSchema } = require('../../lib/db');

const BONUS_PTS = 20;
const REASON    = 'FCFS Giveaway – Oct 2026';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = (req.body?.secret || '').trim();
  if (!secret || secret !== process.env.RESCORE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const db = getDb();
    await ensureSchema();

    // Fetch all uncredited entries
    const entries = await db`
      SELECT wallet, slot FROM giveaway_entries
      WHERE credited = FALSE
      ORDER BY slot ASC
    `;

    if (entries.length === 0) {
      return res.status(200).json({ message: 'Nothing to credit.', credited: 0 });
    }

    // Insert bonus rows for each wallet
    for (const { wallet } of entries) {
      await db`
        INSERT INTO bonuses (wallet, points, reason)
        VALUES (${wallet}, ${BONUS_PTS}, ${REASON})
      `;
    }

    // Mark entries as credited
    const wallets = entries.map(e => e.wallet);
    await db`
      UPDATE giveaway_entries SET credited = TRUE
      WHERE wallet = ANY(${wallets})
    `;

    return res.status(200).json({
      message: `Credited ${BONUS_PTS} pts to ${entries.length} wallets.`,
      credited: entries.length,
      wallets,
    });
  } catch (err) {
    console.error('credit-giveaway error:', err);
    return res.status(500).json({ error: 'Failed. Check server logs.' });
  }
};

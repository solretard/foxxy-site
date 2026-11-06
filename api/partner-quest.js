// GET  /api/partner-quest?wallet=0x...  — check claim status for a wallet
// POST /api/partner-quest               — submit wallet to claim all unclaimed partners
// Body (POST): { wallet }
// Returns: { claimed: [ { partner, pts, claimed_at } ], total_pts, fully_claimed }

const { getDb, ensureSchema } = require('../lib/db');

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/i;
const PARTNERS = ['SoulsClubInc', 'VaultlingsNFT', 'Brrrbon_'];
const PTS_PER_PARTNER = 20;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const db = getDb();
  await ensureSchema();

  // ── GET — check status ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const wallet = (req.query.wallet || '').trim().toLowerCase();
    if (!WALLET_RE.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address.' });
    }

    const rows = await db`
      SELECT partner, pts, created_at
      FROM partner_quest_claims
      WHERE wallet = ${wallet}
      ORDER BY created_at ASC
    `;

    const claimed = rows.map(r => ({
      partner:    r.partner,
      pts:        r.pts,
      claimed_at: r.created_at,
    }));

    return res.status(200).json({
      claimed,
      total_pts:    claimed.reduce((s, c) => s + c.pts, 0),
      fully_claimed: claimed.length >= PARTNERS.length,
    });
  }

  // ── POST — record claim ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const wallet = (body.wallet || '').trim().toLowerCase();
    if (!WALLET_RE.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address.' });
    }

    // Check which partners are already claimed
    const existing = await db`
      SELECT partner FROM partner_quest_claims WHERE wallet = ${wallet}
    `;
    const alreadyClaimed = new Set(existing.map(r => r.partner));
    const newPartners = PARTNERS.filter(p => !alreadyClaimed.has(p));

    if (newPartners.length === 0) {
      return res.status(409).json({
        error: 'You have already claimed all partner quest rewards.',
        fully_claimed: true,
        total_pts: alreadyClaimed.size * PTS_PER_PARTNER,
      });
    }

    // Insert claims and bonus records for each new partner
    for (const partner of newPartners) {
      await db`
        INSERT INTO partner_quest_claims (wallet, partner, pts)
        VALUES (${wallet}, ${partner}, ${PTS_PER_PARTNER})
        ON CONFLICT (wallet, partner) DO NOTHING
      `;
      await db`
        INSERT INTO bonuses (wallet, pts, reason)
        VALUES (${wallet}, ${PTS_PER_PARTNER}, ${'partner_quest:' + partner})
      `;
    }

    const totalNewPts = newPartners.length * PTS_PER_PARTNER;
    const totalClaimed = alreadyClaimed.size + newPartners.length;

    return res.status(200).json({
      success: true,
      new_partners: newPartners,
      new_pts: totalNewPts,
      total_pts: totalClaimed * PTS_PER_PARTNER,
      fully_claimed: totalClaimed >= PARTNERS.length,
      message: `+${totalNewPts} pts added to your wallet!`,
    });
  }

  return res.status(405).end();
};

// GET /api/score?wallet=0x... — score a wallet on-chain and return breakdown + rank.
// Calls Alchemy NFT API v3 to read holdings + transfer history.

const { getDb, ensureSchema } = require('../lib/db');

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/i;

// ── Curated projects ──────────────────────────────────────────────────────────
// address (lowercase) → { name, pts, featured }
const CURATED = {
  '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d': { name: 'BAYC',           pts: 50, featured: false },
  '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb': { name: 'CryptoPunks',    pts: 50, featured: false },
  '0xed5af388653567af2f388e6224dc7c4b3241c544': { name: 'Azuki',          pts: 40, featured: true  },
  '0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b': { name: 'CloneX',         pts: 35, featured: false },
  '0xbd3531da5cf5857e7cfaa92426877b022e612cf8': { name: 'Pudgy Penguins', pts: 40, featured: false },
  '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e': { name: 'Doodles',        pts: 25, featured: false },
  '0x5af0d9827e0c53e4799bb226655a1de152a425a5': { name: 'Milady',         pts: 25, featured: false },
  '0x60e4d786628fea6478f785a6d7e704777c86a7c6': { name: 'MAYC',           pts: 30, featured: false },
  '0x8821bee2ba0ddf28761afff119d66390d594cd28': { name: 'DeGods',         pts: 30, featured: false },
};

const FEATURED_BOOST    = 1.5;   // multiplier applied to featured project pts
const DIVERSITY_PTS     = 5;     // bonus per curated project beyond the first
const DIVERSITY_CAP     = 8;     // max extra projects counted for diversity
const MINT_PTS          = 2;     // pts per verified mint (from zero address)
const MINT_CAP_PROJECT  = 5;     // max mints counted per project
const VOL_PTS_PER_ETH   = 10;   // 10 pts per ETH of transfer value (= 1 pt per 0.1 ETH)
const DURATION_BONUS    = 10;    // bonus per curated project held ≥ 30 days
const MIN_HOLD_DAYS     = 30;
const ZERO_ADDR         = '0x0000000000000000000000000000000000000000';

function alchemyUrl() {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error('ALCHEMY_API_KEY not set');
  return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
}

// Fetch all NFTs owned by wallet (paginated)
async function fetchNFTs(wallet) {
  const base = alchemyUrl();
  const nfts = [];
  let pageKey = '';
  do {
    const url = new URL(`${base}/getNFTsForOwner`);
    url.searchParams.set('owner', wallet);
    url.searchParams.set('withMetadata', 'false');
    url.searchParams.set('pageSize', '100');
    if (pageKey) url.searchParams.set('pageKey', pageKey);

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`Alchemy getNFTs ${r.status}: ${await r.text()}`);
    const data = await r.json();
    nfts.push(...(data.ownedNfts || []));
    pageKey = data.pageKey || '';
  } while (pageKey);
  return nfts;
}

// Fetch ERC-721 transfers received by wallet (used for mints, volume, duration)
async function fetchInboundTransfers(wallet) {
  const base = alchemyUrl();
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1, jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [{
        toAddress: wallet,
        category: ['erc721'],
        withMetadata: true,
        maxCount: '0x3e8',   // 1000 transfers
        order: 'desc',
      }],
    }),
  });
  if (!r.ok) throw new Error(`Alchemy transfers ${r.status}`);
  const data = await r.json();
  return (data.result && data.result.transfers) ? data.result.transfers : [];
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const raw = (req.query.wallet || '').trim();
  if (!WALLET_RE.test(raw)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }
  const wallet = raw.toLowerCase();

  try {
    const [nfts, transfers] = await Promise.all([
      fetchNFTs(wallet),
      fetchInboundTransfers(wallet),
    ]);

    // ── 1. Holdings score ───────────────────────────────────────────────────
    // For each curated project held, award pts (featured gets 1.5×).
    const heldContracts = new Set();
    let holdingsScore = 0;

    for (const nft of nfts) {
      const contract = (nft.contract?.address || '').toLowerCase();
      const proj = CURATED[contract];
      if (!proj || heldContracts.has(contract)) continue;
      heldContracts.add(contract);
      holdingsScore += proj.featured
        ? Math.round(proj.pts * FEATURED_BOOST)
        : proj.pts;
    }

    // ── 2. Holding duration bonus ────────────────────────────────────────────
    // Each curated project held continuously for ≥ MIN_HOLD_DAYS earns a bonus.
    const firstAcquired = {};   // contract → earliest inbound timestamp (ms)
    for (const tx of transfers) {
      const contract = (tx.rawContract?.address || '').toLowerCase();
      if (!CURATED[contract]) continue;
      const ts = tx.metadata?.blockTimestamp
        ? new Date(tx.metadata.blockTimestamp).getTime()
        : 0;
      if (ts && (!firstAcquired[contract] || ts < firstAcquired[contract])) {
        firstAcquired[contract] = ts;
      }
    }

    const now = Date.now();
    const minHoldMs = MIN_HOLD_DAYS * 24 * 60 * 60 * 1000;
    let durationScore = 0;
    for (const contract of heldContracts) {
      const acq = firstAcquired[contract];
      if (acq && now - acq >= minHoldMs) {
        durationScore += DURATION_BONUS;
      }
    }

    // ── 3. Collection diversity ──────────────────────────────────────────────
    // Bonus for holding multiple curated projects.
    const extraProjects = Math.min(Math.max(0, heldContracts.size - 1), DIVERSITY_CAP);
    const diversityScore = extraProjects * DIVERSITY_PTS;

    // ── 4. Mint activity ─────────────────────────────────────────────────────
    // Mints = transfers received FROM the zero address.
    const mintsByContract = {};
    for (const tx of transfers) {
      if ((tx.from || '').toLowerCase() !== ZERO_ADDR) continue;
      const contract = (tx.rawContract?.address || '').toLowerCase();
      if (!CURATED[contract]) continue;
      mintsByContract[contract] = (mintsByContract[contract] || 0) + 1;
    }

    let mintScore = 0;
    for (const [contract, count] of Object.entries(mintsByContract)) {
      const capped = Math.min(count, MINT_CAP_PROJECT);
      const pts = capped * MINT_PTS;
      mintScore += CURATED[contract].featured ? Math.round(pts * FEATURED_BOOST) : pts;
    }

    // ── 5. Trading volume ────────────────────────────────────────────────────
    // Sum ETH value of all inbound ERC-721 transfers as a proxy for engagement.
    let totalEth = 0;
    for (const tx of transfers) {
      const val = parseFloat(tx.value || 0);
      if (!isNaN(val)) totalEth += val;
    }
    const volumeScore = Math.round(totalEth * VOL_PTS_PER_ETH);

    // ── Total ────────────────────────────────────────────────────────────────
    const total = holdingsScore + durationScore + diversityScore + mintScore + volumeScore;

    const breakdown = {
      holdings:  holdingsScore,
      duration:  durationScore,
      diversity: diversityScore,
      mints:     mintScore,
      volume:    volumeScore,
      projects:  [...heldContracts].map(c => CURATED[c]?.name).filter(Boolean),
      eth_volume: Math.round(totalEth * 100) / 100,
    };

    // ── Upsert to DB ─────────────────────────────────────────────────────────
    const db = getDb();
    await ensureSchema();
    await db`
      INSERT INTO scores (wallet, total_score, breakdown)
      VALUES (${wallet}, ${total}, ${JSON.stringify(breakdown)})
      ON CONFLICT (wallet) DO UPDATE
        SET total_score = EXCLUDED.total_score,
            breakdown   = EXCLUDED.breakdown,
            scored_at   = NOW()
    `;

    // ── Rank ─────────────────────────────────────────────────────────────────
    const [rankRow, countRow] = await Promise.all([
      db`SELECT COUNT(*) AS cnt FROM scores WHERE total_score > ${total}`,
      db`SELECT COUNT(*) AS cnt FROM scores`,
    ]);
    const rank         = parseInt(rankRow[0]?.cnt || 0) + 1;
    const totalWallets = parseInt(countRow[0]?.cnt || 1);

    return res.status(200).json({ wallet, total, rank, totalWallets, breakdown });
  } catch (err) {
    console.error('score error:', err);
    return res.status(500).json({ error: 'Scoring failed. Please try again.' });
  }
};

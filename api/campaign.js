// GET /api/campaign — returns the countdown deadline and X handle.
// Same for every visitor so the countdown stays consistent.

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const deadline = process.env.WAITLIST_DEADLINE
    || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const xHandle = process.env.FOXXY_X_HANDLE || 'Foxxy_ethn';

  res.json({ deadline, xHandle });
};

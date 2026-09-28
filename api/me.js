// GET /api/me — returns whether an X account is connected in this browser.
// Identity is stored in a signed cookie (fx_id) set by the OAuth callback.

const { unsign, parseCookies } = require('../lib/crypto');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const cookies = parseCookies(req);
  const raw = unsign(cookies.fx_id);
  if (!raw) return res.json({ connected: false });

  let data;
  try { data = JSON.parse(raw); } catch { return res.json({ connected: false }); }

  res.json({ connected: true, username: data.username });
};

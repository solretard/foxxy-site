// GET /auth/x/callback (rewritten by vercel.json to /api/auth/x/callback)
// Receives the OAuth code from X, exchanges it for a token, fetches the
// user profile, then sets a signed identity cookie and redirects home.

const { sign, unsign, parseCookies, buildSetCookie, buildClearCookie } = require('../../../lib/crypto');

const X_CLIENT_ID     = process.env.X_CLIENT_ID     || '';
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const X_REDIRECT_URI  = process.env.X_REDIRECT_URI  || 'http://localhost:3000/auth/x/callback';

module.exports = async (req, res) => {
  try {
    const url = new URL(`https://placeholder${req.url}`);  // parse query params
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const cookies = parseCookies(req);
    const raw = unsign(cookies.x_oauth);
    if (!raw) return res.redirect('/waitlist.html?x_error=session_expired');

    let saved;
    try { saved = JSON.parse(raw); } catch {
      return res.redirect('/waitlist.html?x_error=session_invalid');
    }

    if (!code || state !== saved.state) {
      return res.redirect('/waitlist.html?x_error=state_mismatch');
    }

    // Exchange code for access token
    const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
    const tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  X_REDIRECT_URI,
        code_verifier: saved.verifier
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      console.error('X token exchange failed:', tokenData);
      return res.redirect('/waitlist.html?x_error=token_failed');
    }

    // Fetch the X profile
    const meResp = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const meData = await meResp.json();
    if (!meResp.ok || !meData.data) {
      console.error('X profile fetch failed:', meData);
      return res.redirect('/waitlist.html?x_error=profile_failed');
    }

    const identity = sign(JSON.stringify({ id: meData.data.id, username: meData.data.username }));

    res.setHeader('Set-Cookie', [
      buildClearCookie('x_oauth'),
      buildSetCookie('fx_id', identity, {
        httpOnly: true,
        sameSite: 'Lax',
        maxAge:   30 * 60 * 1000  // 30 minutes
      })
    ]);
    res.redirect('/waitlist.html?connected=1');

  } catch (err) {
    console.error('X OAuth callback error:', err);
    res.redirect('/waitlist.html?x_error=unexpected');
  }
};

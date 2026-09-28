// GET /auth/x/login (rewritten by vercel.json to /api/auth/x/login)
// Kicks off OAuth 2.0 + PKCE flow — stores verifier+state in a short-lived cookie
// then redirects to X's auth page.

const { sign, genCodeVerifier, codeChallengeFromVerifier, base64url, buildSetCookie } = require('../../../lib/crypto');
const crypto = require('crypto');

const X_CLIENT_ID   = process.env.X_CLIENT_ID   || '';
const X_REDIRECT_URI = process.env.X_REDIRECT_URI || 'http://localhost:3000/auth/x/callback';

module.exports = async (req, res) => {
  if (!X_CLIENT_ID) {
    return res.redirect('/waitlist.html?x_error=not_configured');
  }

  const verifier  = genCodeVerifier();
  const challenge = codeChallengeFromVerifier(verifier);
  const state     = base64url(crypto.randomBytes(16));
  const pkce      = sign(JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             X_CLIENT_ID,
    redirect_uri:          X_REDIRECT_URI,
    scope:                 'users.read tweet.read',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256'
  });

  res.setHeader('Set-Cookie', buildSetCookie('x_oauth', pkce, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge:   10 * 60 * 1000   // 10 minutes
  }));
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
};

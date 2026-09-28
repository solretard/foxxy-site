// Shared crypto helpers — sign/unsign cookies, PKCE, cookie parsing.
// Used by every serverless function that touches auth.

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(value) {
  const sig = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function unsign(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) {
    return null;
  }
  return value;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function genCodeVerifier() {
  return base64url(crypto.randomBytes(32));
}

function codeChallengeFromVerifier(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// Parse the Cookie header into a plain object
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(part => {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) return;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    try { cookies[name] = decodeURIComponent(val); } catch { cookies[name] = val; }
  });
  return cookies;
}

// Build a Set-Cookie header string
function buildSetCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  str += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly) str += '; HttpOnly';
  if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
  if (opts.maxAge != null) str += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
  if (opts.secure) str += '; Secure';
  return str;
}

// Build a cookie that expires immediately (clears it)
function buildClearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

module.exports = {
  sign, unsign, base64url, genCodeVerifier, codeChallengeFromVerifier,
  parseCookies, buildSetCookie, buildClearCookie
};

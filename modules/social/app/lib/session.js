// =============================================================================
// Session Management — Signed Cookie Sessions
// =============================================================================
// HMAC-SHA256 signed cookies for Studio authentication.
// Cookie payload: { profileId, username, exp }
// Secret sourced from Docker secret file or generated on first start.
//
// Cookie format: base64url(payload).base64url(signature)
// Signature: HMAC-SHA256(payload, secret)

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

// =============================================================================
// Secret Management
// =============================================================================

let _secret = null;

/**
 * Read or generate the session signing secret.
 * Priority: Docker secret file > env var > auto-generated (persisted to /data).
 */
function getSecret() {
  if (_secret) return _secret;

  // 1. Docker secret file
  const secretPath = '/run/secrets/social_lab_session_secret';
  try {
    _secret = readFileSync(secretPath, 'utf8').trim();
    if (_secret.length >= 32) {
      console.log('[session] Using session secret from Docker secret file');
      return _secret;
    }
  } catch {
    // Not available — try next source
  }

  // 2. Environment variable
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    _secret = process.env.SESSION_SECRET;
    console.log('[session] Using session secret from SESSION_SECRET env var');
    return _secret;
  }

  // 3. Auto-generate and persist to /data (volume-mounted)
  const persistPath = '/data/session-secret';
  try {
    _secret = readFileSync(persistPath, 'utf8').trim();
    if (_secret.length >= 32) {
      console.log('[session] Using persisted session secret from /data');
      return _secret;
    }
  } catch {
    // Not found — generate
  }

  _secret = randomBytes(48).toString('hex');
  try {
    if (!existsSync('/data')) {
      mkdirSync('/data', { recursive: true });
    }
    writeFileSync(persistPath, _secret, { mode: 0o600 });
    console.log('[session] Generated and persisted new session secret to /data');
  } catch (err) {
    console.warn('[session] Could not persist session secret:', err.message);
    console.log('[session] Using ephemeral session secret (sessions lost on restart)');
  }

  return _secret;
}

// =============================================================================
// Cookie Signing / Verification
// =============================================================================

const SESSION_COOKIE_NAME = 'sl_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Base64url encode a buffer or string.
 */
function base64urlEncode(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return buf.toString('base64url');
}

/**
 * Base64url decode to string.
 */
function base64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Sign a payload string with HMAC-SHA256.
 */
function sign(payload) {
  const secret = getSecret();
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Create a signed session cookie value.
 * @param {{ profileId: string, username: string }} data
 * @returns {string} Signed cookie value
 */
function createSession(data) {
  const payload = JSON.stringify({
    profileId: data.profileId,
    username: data.username,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  });
  const encoded = base64urlEncode(payload);
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a session cookie value.
 * @param {string} cookieValue
 * @returns {{ profileId: string, username: string } | null} Decoded session or null
 */
function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = sign(encoded);

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encoded));

    // Check expiration
    if (!payload.exp || Date.now() > payload.exp) return null;

    // Validate required fields
    if (!payload.profileId || !payload.username) return null;

    return {
      profileId: payload.profileId,
      username: payload.username,
    };
  } catch {
    return null;
  }
}

/**
 * Parse cookies from a request's Cookie header.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  }
  return cookies;
}

/**
 * Get the session from request cookies.
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ profileId: string, username: string } | null}
 */
function getSession(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[SESSION_COOKIE_NAME]);
}

/**
 * Build the Set-Cookie header value for a new session.
 * @param {{ profileId: string, username: string }} data
 * @returns {string} Set-Cookie header value
 */
function setSessionCookie(data) {
  const value = createSession(data);
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Build the Set-Cookie header value to clear the session.
 * @returns {string} Set-Cookie header value
 */
function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// =============================================================================
// Password Hashing (scrypt, built-in node:crypto)
// =============================================================================

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Hash a password with scrypt. Returns "salt:derivedKey" in hex.
 * @param {string} password
 * @returns {Promise<string>}
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(32).toString('hex');
    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash ("salt:derivedKey").
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return resolve(false);

    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      const derivedHex = derivedKey.toString('hex');
      // Timing-safe comparison
      const a = Buffer.from(key, 'hex');
      const b = Buffer.from(derivedHex, 'hex');
      if (a.length !== b.length) return resolve(false);
      resolve(timingSafeEqual(a, b));
    });
  });
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Check if the request has a valid session. Returns the session data or null.
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ profileId: string, username: string } | null}
 */
function requireAuth(req) {
  return getSession(req);
}

// =============================================================================
// Rate Limiting (in-memory, simple IP-based)
// =============================================================================

const loginAttempts = new Map(); // IP -> { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check rate limit for login attempts.
 * @param {string} ip
 * @returns {boolean} true if allowed, false if rate limited
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Get the client IP from the request (supports X-Forwarded-For behind proxy).
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

// Periodically clean up stale rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

// =============================================================================
// CSRF Protection
// =============================================================================

/**
 * Check Origin/Referer header for CSRF protection on POST requests.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean} true if request is safe
 */
function checkCsrf(req) {
  if (req.method !== 'POST') return true;

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // If neither header is present, allow (some clients don't send them)
  if (!origin && !referer) return true;

  const allowedHost = req.headers.host;
  if (!allowedHost) return true;

  if (origin) {
    try {
      const url = new URL(origin);
      return url.host === allowedHost;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const url = new URL(referer);
      return url.host === allowedHost;
    } catch {
      return false;
    }
  }

  return true;
}

export {
  getSession,
  setSessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyPassword,
  requireAuth,
  checkRateLimit,
  getClientIp,
  checkCsrf,
  SESSION_COOKIE_NAME,
};

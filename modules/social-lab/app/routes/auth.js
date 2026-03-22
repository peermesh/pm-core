// =============================================================================
// Auth Routes — Login, Signup, Logout
// =============================================================================
// GET  /login   — Login page (HTML form, dark theme)
// POST /login   — Validate credentials, set session, redirect to /studio
// GET  /signup  — Signup page (create account + profile)
// POST /signup  — Create profile + auth record, set session, redirect to /studio
// POST /logout  — Clear session, redirect to /
//
// Security: HttpOnly cookies, CSRF check, rate limiting, scrypt hashing.
// Design: Matches Studio dark theme (slate palette, cyan accents).

import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../db.js';
import {
  html, json, readFormBody, escapeHtml,
  BASE_URL, SUBDOMAIN, DOMAIN,
} from '../lib/helpers.js';
import {
  setSessionCookie, clearSessionCookie,
  hashPassword, verifyPassword,
  checkRateLimit, getClientIp, checkCsrf,
} from '../lib/session.js';
import { generateNostrKeypair } from '../lib/nostr-crypto.js';

// =============================================================================
// Shared Auth Page CSS (matches Studio dark theme)
// =============================================================================

const AUTH_CSS = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --color-primary: #06b6d4;
      --color-primary-hover: #22d3ee;
      --color-bg-primary: #020617;
      --color-bg-secondary: #0b1120;
      --color-bg-tertiary: #0f172a;
      --color-bg-elevated: #1e293b;
      --color-text-primary: #f1f5f9;
      --color-text-secondary: #94a3b8;
      --color-text-tertiary: #64748b;
      --color-text-inverse: #020617;
      --color-border: #1e293b;
      --color-border-strong: #334155;
      --color-error: #ef4444;
      --color-success: #22c55e;
      --font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --radius-sm: 0.375rem;
      --radius-md: 0.5rem;
      --radius-lg: 0.75rem;
      --radius-pill: 9999px;
    }

    body {
      font-family: var(--font-family);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .auth-container {
      width: 100%;
      max-width: 420px;
      padding: 2rem;
    }

    .auth-logo {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-primary);
      text-align: center;
      margin-bottom: 0.5rem;
    }

    .auth-subtitle {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      text-align: center;
      margin-bottom: 2rem;
    }

    .auth-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 2rem;
    }

    .auth-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin-bottom: 1.5rem;
      text-align: center;
    }

    .form-field {
      margin-bottom: 1.25rem;
    }

    .form-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 0.5rem;
    }

    .form-input {
      width: 100%;
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-family: var(--font-family);
      color: var(--color-text-primary);
      min-height: 44px;
      transition: border-color 0.15s;
    }

    .form-input::placeholder { color: var(--color-text-tertiary); }
    .form-input:hover { border-color: var(--color-border-strong); }
    .form-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.25);
    }

    .form-hint {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
      margin-top: 0.375rem;
    }

    .btn-submit {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-family: var(--font-family);
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: var(--radius-pill);
      cursor: pointer;
      transition: background 0.15s, box-shadow 0.15s;
      min-height: 48px;
      padding: 0.75rem 1.5rem;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      margin-top: 0.5rem;
    }

    .btn-submit:hover {
      background: var(--color-primary-hover);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    .auth-footer {
      text-align: center;
      margin-top: 1.5rem;
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }

    .auth-footer a {
      color: var(--color-primary);
      text-decoration: none;
    }

    .auth-footer a:hover {
      color: var(--color-primary-hover);
      text-decoration: underline;
    }

    .error-message {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      margin-bottom: 1.25rem;
      font-size: 0.875rem;
      color: var(--color-error);
    }

    .back-link {
      display: block;
      text-align: center;
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--color-text-tertiary);
    }

    .back-link a {
      color: var(--color-text-secondary);
      text-decoration: none;
    }

    .back-link a:hover {
      color: var(--color-primary);
    }

    @media (max-width: 480px) {
      .auth-container { padding: 1rem; }
      .auth-card { padding: 1.5rem; }
    }
`;

// =============================================================================
// Login Page HTML
// =============================================================================

function loginPageHtml(error = '') {
  const errorHtml = error
    ? `<div class="error-message">${escapeHtml(error)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log In - PeerMesh Social Lab</title>
  <meta name="robots" content="noindex, nofollow">
  <style>${AUTH_CSS}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-logo">PeerMesh Social Lab</div>
    <div class="auth-subtitle">Sign in to your Studio dashboard</div>

    <div class="auth-card">
      <h1 class="auth-title">Log In</h1>
      ${errorHtml}
      <form method="POST" action="/login">
        <div class="form-field">
          <label class="form-label" for="username">Username</label>
          <input class="form-input" type="text" id="username" name="username"
                 placeholder="your-username" required autocomplete="username" autofocus>
        </div>
        <div class="form-field">
          <label class="form-label" for="password">Password</label>
          <input class="form-input" type="password" id="password" name="password"
                 placeholder="Your password" required autocomplete="current-password">
        </div>
        <button class="btn-submit" type="submit">Log In</button>
      </form>
    </div>

    <div class="auth-footer">
      Don't have an account? <a href="/signup">Sign up</a>
    </div>
    <div class="back-link"><a href="/">Back to home</a></div>
  </div>
</body>
</html>`;
}

// =============================================================================
// Signup Page HTML
// =============================================================================

function signupPageHtml(error = '') {
  const errorHtml = error
    ? `<div class="error-message">${escapeHtml(error)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign Up - PeerMesh Social Lab</title>
  <meta name="robots" content="noindex, nofollow">
  <style>${AUTH_CSS}</style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-logo">PeerMesh Social Lab</div>
    <div class="auth-subtitle">Create your Omni-Account identity</div>

    <div class="auth-card">
      <h1 class="auth-title">Sign Up</h1>
      ${errorHtml}
      <form method="POST" action="/signup">
        <div class="form-field">
          <label class="form-label" for="display-name">Display Name</label>
          <input class="form-input" type="text" id="display-name" name="displayName"
                 placeholder="Your Name" required>
        </div>
        <div class="form-field">
          <label class="form-label" for="handle">Handle</label>
          <input class="form-input" type="text" id="handle" name="handle"
                 placeholder="your-handle" required pattern="[a-zA-Z0-9_.-]+"
                 title="Letters, numbers, underscores, dots, and hyphens only">
          <div class="form-hint">This becomes your @handle across all protocols</div>
        </div>
        <div class="form-field">
          <label class="form-label" for="username">Username</label>
          <input class="form-input" type="text" id="username" name="username"
                 placeholder="login-username" required autocomplete="username"
                 pattern="[a-zA-Z0-9_.-]+"
                 title="Letters, numbers, underscores, dots, and hyphens only">
          <div class="form-hint">Used to log in (can be same as handle)</div>
        </div>
        <div class="form-field">
          <label class="form-label" for="password">Password</label>
          <input class="form-input" type="password" id="password" name="password"
                 placeholder="Minimum 8 characters" required minlength="8"
                 autocomplete="new-password">
          <div class="form-hint">At least 8 characters</div>
        </div>
        <button class="btn-submit" type="submit">Create Account</button>
      </form>
    </div>

    <div class="auth-footer">
      Already have an account? <a href="/login">Log in</a>
    </div>
    <div class="back-link"><a href="/">Back to home</a></div>
  </div>
</body>
</html>`;
}

// =============================================================================
// Redirect helper
// =============================================================================

function redirect(res, location, cookie = null) {
  const headers = { Location: location };
  if (cookie) {
    headers['Set-Cookie'] = cookie;
  }
  res.writeHead(302, headers);
  res.end();
}

// =============================================================================
// Route Registration
// =============================================================================

export default function registerRoutes(routes) {
  // GET /login — Login page
  routes.push({
    method: 'GET',
    pattern: '/login',
    handler: async (req, res) => {
      html(res, 200, loginPageHtml());
    },
  });

  // POST /login — Authenticate
  routes.push({
    method: 'POST',
    pattern: '/login',
    handler: async (req, res) => {
      // CSRF check
      if (!checkCsrf(req)) {
        return html(res, 403, loginPageHtml('Invalid request origin.'));
      }

      // Rate limit
      const ip = getClientIp(req);
      if (!checkRateLimit(ip)) {
        return html(res, 429, loginPageHtml('Too many login attempts. Please wait a minute.'));
      }

      const body = await readFormBody(req);
      const username = (body.username || '').trim();
      const password = body.password || '';

      if (!username || !password) {
        return html(res, 400, loginPageHtml('Username and password are required.'));
      }

      // Look up auth record
      const result = await pool.query(
        `SELECT a.id, a.profile_id, a.username, a.password_hash
         FROM social_profiles.auth a
         WHERE a.username = $1`,
        [username]
      );

      if (result.rowCount === 0) {
        return html(res, 401, loginPageHtml('Invalid username or password.'));
      }

      const authRecord = result.rows[0];

      // Verify password
      const valid = await verifyPassword(password, authRecord.password_hash);
      if (!valid) {
        return html(res, 401, loginPageHtml('Invalid username or password.'));
      }

      // Update last_login_at
      await pool.query(
        'UPDATE social_profiles.auth SET last_login_at = NOW() WHERE id = $1',
        [authRecord.id]
      );

      // Set session cookie and redirect
      const cookie = setSessionCookie({
        profileId: authRecord.profile_id,
        username: authRecord.username,
      });

      console.log(`[auth] Login success: ${username} (profile: ${authRecord.profile_id})`);
      redirect(res, '/studio', cookie);
    },
  });

  // GET /signup — Signup page
  routes.push({
    method: 'GET',
    pattern: '/signup',
    handler: async (req, res) => {
      html(res, 200, signupPageHtml());
    },
  });

  // POST /signup — Create account + profile (Omni-Account pipeline)
  routes.push({
    method: 'POST',
    pattern: '/signup',
    handler: async (req, res) => {
      // CSRF check
      if (!checkCsrf(req)) {
        return html(res, 403, signupPageHtml('Invalid request origin.'));
      }

      const body = await readFormBody(req);
      const displayName = (body.displayName || '').trim();
      const handle = (body.handle || '').trim().toLowerCase();
      const username = (body.username || '').trim();
      const password = body.password || '';

      // Validation
      if (!displayName) {
        return html(res, 400, signupPageHtml('Display name is required.'));
      }
      if (!handle) {
        return html(res, 400, signupPageHtml('Handle is required.'));
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(handle)) {
        return html(res, 400, signupPageHtml('Handle can only contain letters, numbers, underscores, dots, and hyphens.'));
      }
      if (!username) {
        return html(res, 400, signupPageHtml('Username is required.'));
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return html(res, 400, signupPageHtml('Username can only contain letters, numbers, underscores, dots, and hyphens.'));
      }
      if (password.length < 8) {
        return html(res, 400, signupPageHtml('Password must be at least 8 characters.'));
      }

      // Check if handle is already taken (as a profile username)
      const existingProfile = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE username = $1',
        [handle]
      );
      if (existingProfile.rowCount > 0) {
        return html(res, 409, signupPageHtml('That handle is already taken. Choose another.'));
      }

      // Check if auth username is already taken
      const existingAuth = await pool.query(
        'SELECT id FROM social_profiles.auth WHERE username = $1',
        [username]
      );
      if (existingAuth.rowCount > 0) {
        return html(res, 409, signupPageHtml('That username is already taken. Choose another.'));
      }

      // ─── Omni-Account Creation Pipeline ───
      // Mirrors POST /api/profile logic from profile.js

      const profileId = randomUUID();
      const webid = `${BASE_URL}/profile/${profileId}#me`;
      const omniAccountId = `urn:peermesh:omni:${profileId}`;
      const sourcePodUri = `${BASE_URL}/pod/${profileId}/`;
      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

      // Generate Nostr keypair
      let nostrNpub = null;
      let nostrKeypair = null;
      try {
        nostrKeypair = generateNostrKeypair();
        nostrNpub = nostrKeypair.npub;
        console.log(`[auth/signup] Generated Nostr keypair for ${handle}: npub=${nostrNpub}`);
      } catch (err) {
        console.error(`[auth/signup] Nostr keypair generation failed:`, err.message);
      }

      // Generate AT Protocol DID
      const atDid = `did:web:${ourDomain}:ap:actor:${handle}`;

      // Generate DSNP User ID stub
      let dsnpUserId = null;
      try {
        const dsnpHash = createHash('sha256').update(omniAccountId).digest('hex');
        dsnpUserId = String(parseInt(dsnpHash.slice(0, 8), 16)).padStart(8, '0');
      } catch (err) {
        console.error(`[auth/signup] DSNP ID generation failed:`, err.message);
      }

      // Generate Zot channel hash stub
      let zotChannelHash = null;
      try {
        zotChannelHash = createHash('sha256').update(`zot:${omniAccountId}`).digest('hex');
      } catch (err) {
        console.error(`[auth/signup] Zot hash generation failed:`, err.message);
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Insert profile + auth in a transaction-like flow
      // (pg module doesn't support real transactions across pool.query calls easily,
      //  but the two inserts are idempotent on error)
      try {
        // Create profile
        await pool.query(
          `INSERT INTO social_profiles.profile_index
             (id, webid, omni_account_id, display_name, username, bio, avatar_url, source_pod_uri, nostr_npub, at_did, dsnp_user_id, zot_channel_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [profileId, webid, omniAccountId, displayName, handle, null, null, sourcePodUri, nostrNpub, atDid, dsnpUserId, zotChannelHash]
        );

        // Create auth record
        await pool.query(
          `INSERT INTO social_profiles.auth (profile_id, username, password_hash)
           VALUES ($1, $2, $3)`,
          [profileId, username, passwordHash]
        );

        // Store Nostr key metadata
        if (nostrKeypair) {
          const pubkeyHash = createHash('sha256').update(nostrKeypair.pubkeyHex).digest('hex');
          try {
            await pool.query(
              `INSERT INTO social_keys.key_metadata
                 (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
               VALUES ($1, $2, 'nostr', 'secp256k1', $3, 'signing', TRUE)`,
              [randomUUID(), omniAccountId, pubkeyHash]
            );
            await pool.query(
              `INSERT INTO social_keys.key_metadata
                 (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
               VALUES ($1, $2, 'nostr', 'secp256k1-nsec', $3, 'signing-private', TRUE)`,
              [randomUUID(), omniAccountId, nostrKeypair.privkeyHex]
            );
          } catch (err) {
            console.error(`[auth/signup] Nostr key storage failed:`, err.message);
          }
        }

        // Generate AP actor keys (RSA 2048 keypair for HTTP Signatures)
        try {
          const { generateKeyPairSync } = await import('node:crypto');
          const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          });

          const actorUri = `${BASE_URL}/ap/actor/${handle}`;
          const keyId = `${actorUri}#main-key`;
          const apActorId = randomUUID();

          await pool.query(
            `INSERT INTO social_federation.ap_actors
               (id, webid, actor_uri, inbox_uri, outbox_uri, public_key_pem, private_key_pem, key_id, protocol, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activitypub', 'active')`,
            [apActorId, webid, actorUri, `${actorUri}/inbox`, `${BASE_URL}/ap/outbox/${handle}`,
             publicKey, privateKey, keyId]
          );

          // Update profile with ap_actor_uri
          await pool.query(
            'UPDATE social_profiles.profile_index SET ap_actor_uri = $1 WHERE id = $2',
            [actorUri, profileId]
          );

          console.log(`[auth/signup] Generated AP actor for ${handle}: ${actorUri}`);
        } catch (err) {
          console.error(`[auth/signup] AP actor generation failed:`, err.message);
        }

        console.log(`[auth/signup] Account created: ${username} / @${handle} (profile: ${profileId})`);

        // Set session and redirect
        const cookie = setSessionCookie({ profileId, username });
        redirect(res, '/studio', cookie);
      } catch (err) {
        console.error(`[auth/signup] Account creation failed:`, err.message);
        if (err.code === '23505') {
          // Unique constraint violation
          return html(res, 409, signupPageHtml('That handle or username is already taken.'));
        }
        return html(res, 500, signupPageHtml('Account creation failed. Please try again.'));
      }
    },
  });

  // POST /logout — Clear session
  routes.push({
    method: 'POST',
    pattern: '/logout',
    handler: async (req, res) => {
      const cookie = clearSessionCookie();
      console.log('[auth] Logout');
      redirect(res, '/', cookie);
    },
  });

  // GET /logout — Also support GET for convenience (link-based logout)
  routes.push({
    method: 'GET',
    pattern: '/logout',
    handler: async (req, res) => {
      const cookie = clearSessionCookie();
      redirect(res, '/', cookie);
    },
  });
}

// =============================================================================
// Auth Routes — Login, Signup, Logout, SSO
// =============================================================================
// GET  /login   — Login page (HTML form, dark theme)
// POST /login   — Validate credentials, set session, redirect to /studio
// GET  /signup  — Signup page (create account + profile)
// POST /signup  — Create profile + auth record, set session, redirect to /studio
// POST /logout  — Clear session, redirect to /
// GET  /sso/authorize?target=domain&callback=url — SSO authorization page
// POST /sso/verify — Verify an SSO token from another instance
//
// Security: HttpOnly cookies, CSRF check, rate limiting, scrypt hashing.
// Design: Matches Studio dark theme (slate palette, cyan accents).

import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../db.js';
import {
  html, json, readFormBody, readJsonBody, escapeHtml, parseUrl,
  BASE_URL, SUBDOMAIN, DOMAIN,
} from '../lib/helpers.js';
import {
  getSession, setSessionCookie, clearSessionCookie,
  hashPassword, verifyPassword,
  checkRateLimit, getClientIp, checkCsrf,
} from '../lib/session.js';
import { generateNostrKeypair } from '../lib/nostr-crypto.js';
import { provisionEd25519Identity } from '../lib/identity-keys.js';
import { generateAndStoreManifest } from '../lib/manifest.js';
import {
  generateSSOToken, verifySSOToken,
  getInstanceByDomain, getInstancePublicKey,
  INSTANCE_DOMAIN,
} from '../lib/sso.js';

// =============================================================================
// Shared Auth Page CSS (matches Studio dark theme)
// =============================================================================

const AUTH_CSS = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }


    body {
      font-family: var(--font-family-primary);
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
      border: var(--border-width-default) solid var(--color-border);
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
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 1rem;
      font-family: var(--font-family-primary);
      color: var(--color-text-primary);
      min-height: 44px;
      transition: border-color 0.15s;
    }

    .form-input::placeholder { color: var(--color-text-tertiary); }
    .form-input:hover { border-color: var(--color-border-strong); }
    .form-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-focus-ring);
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
      font-family: var(--font-family-primary);
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
      box-shadow: var(--shadow-sm);
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
      background: var(--color-error-light);
      border: var(--border-width-default) solid var(--color-error);
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
  <link rel="stylesheet" href="/static/tokens.css">
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
  <link rel="stylesheet" href="/static/tokens.css">
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
// SSO Authorization Page HTML
// =============================================================================

function ssoAuthorizePage({ profile, targetDomain, callbackUrl, instanceKnown, instanceName }) {
  const trustBadge = instanceKnown
    ? '<span style="color: var(--color-success); font-size: 0.85rem;">Known instance</span>'
    : '<span style="color: var(--color-warning, #f59e0b); font-size: 0.85rem;">Unknown instance</span>';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SSO Authorization - PeerMesh Social Lab</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>${AUTH_CSS}
    .sso-info {
      background: var(--color-bg-tertiary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 1rem;
      margin-bottom: 1.25rem;
      font-size: 0.875rem;
    }
    .sso-info dt {
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .sso-info dd {
      color: var(--color-text-primary);
      margin-bottom: 0.75rem;
      margin-left: 0;
      word-break: break-all;
    }
    .sso-info dd:last-child { margin-bottom: 0; }
    .btn-row {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .btn-deny {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-family-primary);
      font-size: 1rem;
      font-weight: 600;
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-pill);
      cursor: pointer;
      min-height: 48px;
      padding: 0.75rem 1.5rem;
      background: transparent;
      color: var(--color-text-secondary);
    }
    .btn-deny:hover {
      background: var(--color-bg-tertiary);
      color: var(--color-text-primary);
    }
    .btn-approve {
      flex: 2;
    }
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-logo">PeerMesh Social Lab</div>
    <div class="auth-subtitle">Cross-Instance Single Sign-On</div>

    <div class="auth-card">
      <h1 class="auth-title">Authorize SSO</h1>

      <p style="text-align: center; margin-bottom: 1.25rem; font-size: 0.9375rem; color: var(--color-text-secondary);">
        <strong style="color: var(--color-text-primary);">${escapeHtml(instanceName)}</strong>
        wants to verify your identity.
      </p>

      <dl class="sso-info">
        <dt>Your Identity</dt>
        <dd>${escapeHtml(profile.display_name || profile.username)} (@${escapeHtml(profile.username)})</dd>
        <dt>Target Instance</dt>
        <dd>${escapeHtml(targetDomain)} ${trustBadge}</dd>
        <dt>WebID</dt>
        <dd style="font-size: 0.8125rem; color: var(--color-text-tertiary);">${escapeHtml(profile.webid)}</dd>
      </dl>

      <form method="POST" action="/sso/authorize">
        <input type="hidden" name="target" value="${escapeHtml(targetDomain)}">
        <input type="hidden" name="callback" value="${escapeHtml(callbackUrl)}">
        <div class="btn-row">
          <button class="btn-deny" type="submit" name="action" value="deny">Deny</button>
          <button class="btn-submit btn-approve" type="submit" name="action" value="approve">Approve</button>
        </div>
      </form>
    </div>

    <div class="back-link"><a href="/studio">Back to Studio</a></div>
  </div>
</body>
</html>`;
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

        // Generate Ed25519 identity keypair for Universal Manifest signing (F-030)
        try {
          const ed25519Result = await provisionEd25519Identity(omniAccountId);
          console.log(`[auth/signup] Generated Ed25519 identity keypair for ${handle}`);

          // Generate initial Universal Manifest
          // Re-fetch profile to get all protocol URIs that were just set
          const freshProfile = await pool.query(
            `SELECT id, webid, omni_account_id, display_name, username, bio,
                    avatar_url, banner_url, homepage_url, source_pod_uri,
                    nostr_npub, at_did, ap_actor_uri, dsnp_user_id,
                    zot_channel_hash, matrix_id
             FROM social_profiles.profile_index WHERE id = $1`,
            [profileId]
          );
          if (freshProfile.rowCount > 0) {
            await generateAndStoreManifest(freshProfile.rows[0], {
              publicKeySpkiB64: ed25519Result.publicKeySpkiB64,
              privateKeyPem: ed25519Result.privateKeyPem,
            });
            console.log(`[auth/signup] Generated initial Universal Manifest for ${handle}`);
          }
        } catch (err) {
          console.error(`[auth/signup] Ed25519/Manifest generation failed:`, err.message);
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

  // ===========================================================================
  // SSO Endpoints (WO-008: Ecosystem SSO Phase 1)
  // ===========================================================================

  // GET /sso/authorize?target=domain&callback=url — SSO authorization page
  // Shows: "Instance X wants to verify your identity. Allow?"
  // User must be logged in. On approve: generates SSO token, redirects to callback.
  routes.push({
    method: 'GET',
    pattern: /^\/sso\/authorize$/,
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const targetDomain = searchParams.get('target');
      const callbackUrl = searchParams.get('callback');

      if (!targetDomain || !callbackUrl) {
        return json(res, 400, {
          error: 'Missing required parameters: target, callback',
          usage: 'GET /sso/authorize?target=other.instance.com&callback=https://other.instance.com/sso/callback',
        });
      }

      // Validate callback URL
      let callbackParsed;
      try {
        callbackParsed = new URL(callbackUrl);
      } catch {
        return json(res, 400, { error: 'Invalid callback URL' });
      }

      // Require authentication
      const session = getSession(req);
      if (!session) {
        // Redirect to login with return URL
        const returnUrl = `/sso/authorize?target=${encodeURIComponent(targetDomain)}&callback=${encodeURIComponent(callbackUrl)}`;
        return redirect(res, `/login?return=${encodeURIComponent(returnUrl)}`);
      }

      // Look up the target instance
      const targetInstance = await getInstanceByDomain(targetDomain);

      // Fetch user profile
      const profileResult = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username,
                ap_actor_uri, at_did, nostr_npub
         FROM social_profiles.profile_index
         WHERE id = $1
         LIMIT 1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const profile = profileResult.rows[0];
      const instanceKnown = !!targetInstance;

      // Render authorization page
      html(res, 200, ssoAuthorizePage({
        profile,
        targetDomain,
        callbackUrl,
        instanceKnown,
        instanceName: targetInstance ? targetInstance.name : targetDomain,
      }));
    },
  });

  // POST /sso/authorize — Process SSO authorization (form submission)
  routes.push({
    method: 'POST',
    pattern: /^\/sso\/authorize$/,
    handler: async (req, res) => {
      // CSRF check
      if (!checkCsrf(req)) {
        return json(res, 403, { error: 'Invalid request origin' });
      }

      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Not authenticated' });
      }

      const body = await readFormBody(req);
      const targetDomain = body.target;
      const callbackUrl = body.callback;
      const action = body.action;

      if (!targetDomain || !callbackUrl) {
        return json(res, 400, { error: 'Missing target or callback' });
      }

      // User denied
      if (action !== 'approve') {
        let callbackParsed;
        try {
          callbackParsed = new URL(callbackUrl);
        } catch {
          return json(res, 400, { error: 'Invalid callback URL' });
        }
        const deniedUrl = new URL(callbackUrl);
        deniedUrl.searchParams.set('error', 'access_denied');
        return redirect(res, deniedUrl.toString());
      }

      // Fetch profile
      const profileResult = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username,
                ap_actor_uri, at_did, nostr_npub
         FROM social_profiles.profile_index
         WHERE id = $1
         LIMIT 1`,
        [session.profileId]
      );

      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const profile = profileResult.rows[0];

      // Generate SSO token
      try {
        const token = await generateSSOToken(profile, targetDomain);

        // Redirect to callback with token
        const redirectUrl = new URL(callbackUrl);
        redirectUrl.searchParams.set('sso_token', token);
        redirectUrl.searchParams.set('source', INSTANCE_DOMAIN);
        redirect(res, redirectUrl.toString());
      } catch (err) {
        console.error(`[sso] Token generation failed:`, err.message);
        json(res, 500, { error: 'SSO token generation failed' });
      }
    },
  });

  // POST /sso/verify — Verify an SSO token (called by receiving instance)
  routes.push({
    method: 'POST',
    pattern: '/sso/verify',
    handler: async (req, res) => {
      let body;
      try {
        const { parsed } = await readJsonBody(req);
        body = parsed;
      } catch {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      if (!body || !body.token || !body.source_domain) {
        return json(res, 400, {
          error: 'Missing required fields: token, source_domain',
          usage: {
            token: 'The SSO token string',
            source_domain: 'Domain of the instance that issued the token',
          },
        });
      }

      // Look up the source instance to get its public key
      const sourceInstance = await getInstanceByDomain(body.source_domain);
      if (!sourceInstance) {
        return json(res, 404, {
          error: `Unknown source instance: ${body.source_domain}`,
          hint: 'Register the source instance first via POST /api/instances/register',
        });
      }

      if (!sourceInstance.public_key) {
        return json(res, 400, {
          error: `Source instance ${body.source_domain} has no public key registered`,
        });
      }

      if (sourceInstance.trust_level === 'blocked') {
        return json(res, 403, {
          error: `Instance ${body.source_domain} is blocked`,
        });
      }

      // Verify the token
      const result = verifySSOToken(body.token, sourceInstance.public_key);

      if (!result.valid) {
        return json(res, 401, {
          verified: false,
          error: result.error,
        });
      }

      // Verify the token was intended for us
      if (result.payload.target_domain && result.payload.target_domain !== INSTANCE_DOMAIN) {
        return json(res, 401, {
          verified: false,
          error: `Token target_domain mismatch: expected ${INSTANCE_DOMAIN}, got ${result.payload.target_domain}`,
        });
      }

      // Return the verified identity
      json(res, 200, {
        verified: true,
        identity: {
          webid: result.payload.webid,
          handle: result.payload.handle,
          display_name: result.payload.display_name,
          protocol_ids: result.payload.protocol_ids,
          source_domain: result.payload.source_domain,
        },
        token_metadata: {
          issued_at: new Date(result.payload.issued_at).toISOString(),
          expires_at: new Date(result.payload.expires_at).toISOString(),
          token_id: result.payload.token_id,
        },
      });
    },
  });
}

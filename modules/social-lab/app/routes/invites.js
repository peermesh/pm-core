// =============================================================================
// Invite Routes — Invite Code Management API
// =============================================================================
// GET  /api/invites              — list my invite codes (authenticated)
// POST /api/invites/generate     — generate new codes (authenticated, pool limit)
// GET  /api/invites/tree         — my invitation tree
// GET  /api/invites/stats        — platform-wide stats (admin only)
// POST /api/invites/revoke/:code — revoke a code
// GET  /api/invites/validate/:code — check if code is valid (public)
// GET  /invite/:code             — redirect to /signup?invite=CODE (landing)
//
// Auth: Session-based (except validate and invite landing, which are public).

import { pool } from '../db.js';
import {
  json, html, parseUrl, escapeHtml, readJsonBody, readFormBody,
  BASE_URL, INSTANCE_DOMAIN,
} from '../lib/helpers.js';
import { getSession } from '../lib/session.js';
import {
  REGISTRATION_MODE,
  INVITE_POOL_SIZE,
  createInviteCodes,
  validateInviteCode,
  revokeInviteCode,
  getUserInviteCodes,
  getInvitationTree,
  getInviterChain,
  getInviteStats,
  checkPoolLimit,
  getAllInviteCodes,
  isAdmin,
} from '../lib/invites.js';

// =============================================================================
// Route Registration
// =============================================================================

export default function registerRoutes(routes) {

  // GET /api/invites — list my invite codes
  routes.push({
    method: 'GET',
    pattern: '/api/invites',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Authentication required' });
      }

      // Get user's profile to find webid
      const profileResult = await pool.query(
        'SELECT id, webid FROM social_profiles.profile_index WHERE id = $1',
        [session.profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const profile = profileResult.rows[0];
      const codes = await getUserInviteCodes(profile.webid);
      const poolInfo = await checkPoolLimit(profile.webid, await isAdmin(profile.id));

      json(res, 200, {
        codes,
        pool: poolInfo,
        registration_mode: REGISTRATION_MODE,
      });
    },
  });

  // POST /api/invites/generate — generate new invite codes
  routes.push({
    method: 'POST',
    pattern: '/api/invites/generate',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Authentication required' });
      }

      const profileResult = await pool.query(
        'SELECT id, webid FROM social_profiles.profile_index WHERE id = $1',
        [session.profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const profile = profileResult.rows[0];
      const admin = await isAdmin(profile.id);

      // Parse request body
      let body = {};
      try {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('json')) {
          const { parsed } = await readJsonBody(req);
          body = parsed || {};
        } else {
          body = await readFormBody(req);
        }
      } catch {
        body = {};
      }

      const count = Math.min(parseInt(body.count || '1', 10), admin ? 100 : 10);
      const maxUses = parseInt(body.max_uses || '1', 10);
      const expiryDays = body.expiry_days ? parseInt(body.expiry_days, 10) : undefined;

      // Check pool limit
      const poolInfo = await checkPoolLimit(profile.webid, admin);
      if (!poolInfo.canGenerate) {
        return json(res, 403, {
          error: 'You have reached your invite code limit.',
          pool: poolInfo,
        });
      }

      // Clamp count to remaining pool (unless admin)
      const actualCount = admin ? count : Math.min(count, poolInfo.remaining);

      const codes = await createInviteCodes(profile.webid, actualCount, maxUses, expiryDays);

      json(res, 201, {
        codes,
        pool: await checkPoolLimit(profile.webid, admin),
      });
    },
  });

  // GET /api/invites/tree — my invitation tree
  routes.push({
    method: 'GET',
    pattern: '/api/invites/tree',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Authentication required' });
      }

      const profileResult = await pool.query(
        'SELECT id, webid FROM social_profiles.profile_index WHERE id = $1',
        [session.profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const tree = await getInvitationTree(profileResult.rows[0].webid);
      const chain = await getInviterChain(profileResult.rows[0].webid);

      json(res, 200, { tree, inviter_chain: chain });
    },
  });

  // GET /api/invites/stats — platform-wide stats (admin only)
  routes.push({
    method: 'GET',
    pattern: '/api/invites/stats',
    handler: async (req, res) => {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Authentication required' });
      }

      const admin = await isAdmin(session.profileId);
      if (!admin) {
        return json(res, 403, { error: 'Admin access required' });
      }

      const stats = await getInviteStats();
      stats.registration_mode = REGISTRATION_MODE;
      stats.pool_size = INVITE_POOL_SIZE;

      json(res, 200, stats);
    },
  });

  // POST /api/invites/revoke/:code — revoke a code
  routes.push({
    method: 'POST',
    pattern: /^\/api\/invites\/revoke\/([A-Za-z0-9-]+)$/,
    handler: async (req, res, match) => {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Authentication required' });
      }

      const code = match[1];
      const profileResult = await pool.query(
        'SELECT id, webid FROM social_profiles.profile_index WHERE id = $1',
        [session.profileId]
      );
      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Profile not found' });
      }

      const profile = profileResult.rows[0];
      const admin = await isAdmin(profile.id);

      // Non-admins can only revoke their own codes
      if (!admin) {
        const codeResult = await pool.query(
          'SELECT created_by_webid FROM social_profiles.invite_codes WHERE code = $1',
          [code.toUpperCase()]
        );
        if (codeResult.rowCount > 0 && codeResult.rows[0].created_by_webid !== profile.webid) {
          return json(res, 403, { error: 'You can only revoke your own codes.' });
        }
      }

      const result = await revokeInviteCode(code, profile.webid);
      if (!result.success) {
        return json(res, 400, { error: result.error });
      }

      json(res, 200, { success: true, message: `Code ${code} revoked.` });
    },
  });

  // GET /api/invites/validate/:code — check if code is valid (public)
  routes.push({
    method: 'GET',
    pattern: /^\/api\/invites\/validate\/([A-Za-z0-9-]+)$/,
    handler: async (req, res, match) => {
      const code = match[1];
      const result = await validateInviteCode(code);

      if (!result.valid) {
        return json(res, 200, { valid: false, error: result.error });
      }

      // Return minimal info (don't leak creator details publicly)
      json(res, 200, {
        valid: true,
        expires_at: result.code_record.expires_at,
      });
    },
  });

  // GET /invite/:code — Invite link landing page
  routes.push({
    method: 'GET',
    pattern: /^\/invite\/([A-Za-z0-9-]+)$/,
    handler: async (req, res, match) => {
      const code = match[1];
      const validation = await validateInviteCode(code);

      // Look up inviter info if code is valid
      let inviterName = null;
      if (validation.valid && validation.code_record) {
        const inviterResult = await pool.query(
          'SELECT display_name, username FROM social_profiles.profile_index WHERE webid = $1',
          [validation.code_record.created_by_webid]
        );
        if (inviterResult.rowCount > 0) {
          inviterName = inviterResult.rows[0].display_name || inviterResult.rows[0].username;
        }
      }

      const errorHtml = !validation.valid
        ? `<div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; color: #ef4444; font-size: 0.875rem;">
             ${escapeHtml(validation.error)}
           </div>`
        : '';

      const inviterHtml = inviterName
        ? `<div style="text-align: center; margin-bottom: 1rem; font-size: 0.9375rem; color: var(--color-text-secondary);">
             Invited by <strong style="color: var(--color-text-primary);">${escapeHtml(inviterName)}</strong>
           </div>`
        : '';

      html(res, 200, `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You're Invited - PeerMesh Social Lab</title>
  <link rel="stylesheet" href="/static/tokens.css">
  <style>
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
    }
    .invite-container {
      width: 100%;
      max-width: 420px;
      padding: 2rem;
      text-align: center;
    }
    .invite-logo {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-primary);
      margin-bottom: 0.5rem;
    }
    .invite-card {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 2rem;
      margin-top: 1.5rem;
    }
    .invite-code-display {
      font-family: var(--font-family-mono);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-primary);
      letter-spacing: 0.05em;
      padding: 1rem;
      background: var(--color-bg-tertiary);
      border-radius: 8px;
      margin-bottom: 1.5rem;
    }
    .btn-join {
      display: inline-block;
      width: 100%;
      padding: 0.875rem 1.5rem;
      background: var(--color-primary);
      color: var(--color-text-inverse);
      border: none;
      border-radius: 9999px;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-join:hover { background: var(--color-primary-hover); }
    .invite-desc {
      margin-top: 1rem;
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }
  </style>
</head>
<body>
  <div class="invite-container">
    <div class="invite-logo">PeerMesh Social Lab</div>
    <div style="font-size: 0.875rem; color: var(--color-text-secondary);">You've been invited to join</div>

    <div class="invite-card">
      ${inviterHtml}
      ${errorHtml}
      <div class="invite-code-display">${escapeHtml(code.toUpperCase())}</div>

      ${validation.valid
        ? `<a class="btn-join" href="/signup?invite=${encodeURIComponent(code)}">Accept Invitation</a>`
        : `<a class="btn-join" href="/signup" style="background: var(--color-text-tertiary);">Go to Signup</a>`
      }

      <div class="invite-desc">
        Join a decentralized social network powered by PeerMesh.
        Your identity, your data, your protocols.
      </div>
    </div>
  </div>
</body>
</html>`);
    },
  });
}

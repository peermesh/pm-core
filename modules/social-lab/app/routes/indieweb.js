// =============================================================================
// IndieWeb Routes — Webmention + IndieAuth
// =============================================================================
// POST /webmention                               — Receive webmention
// GET  /api/webmentions/:handle                   — List webmentions
// GET  /.well-known/oauth-authorization-server    — IndieAuth metadata

import { pool } from '../db.js';
import { json, readFormBody, lookupProfileByHandle, BASE_URL, SUBDOMAIN, DOMAIN } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // POST /webmention — Receive a Webmention
  routes.push({
    method: 'POST',
    pattern: '/webmention',
    handler: async (req, res) => {
      let body;
      try {
        body = await readFormBody(req);
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: 'Could not parse form body' });
      }

      const { source, target } = body;

      if (!source || !target) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Missing required parameters: source and target',
        });
      }

      let sourceUrl, targetUrl;
      try {
        sourceUrl = new URL(source);
        targetUrl = new URL(target);
      } catch (err) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'source and target must be valid URLs',
        });
      }

      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
      if (targetUrl.hostname !== ourDomain) {
        return json(res, 400, {
          error: 'Bad Request',
          message: `Target URL must be on ${ourDomain}`,
        });
      }

      const targetHandleMatch = targetUrl.pathname.match(/^\/@([a-zA-Z0-9_.-]+)/);
      if (!targetHandleMatch) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Target URL does not match a profile on this server',
        });
      }
      const targetHandle = targetHandleMatch[1];

      const profile = await lookupProfileByHandle(pool, targetHandle);
      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${targetHandle}`,
        });
      }

      try {
        await pool.query(
          `INSERT INTO social_federation.webmentions (target_url, source_url, target_handle, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (source_url, target_url) DO UPDATE SET
             status = 'pending',
             created_at = NOW()`,
          [target, source, targetHandle]
        );
        console.log(`[indieweb] Webmention received: ${source} -> ${target} (handle: ${targetHandle})`);
      } catch (err) {
        console.error('[indieweb] Failed to store webmention:', err.message);
        return json(res, 500, { error: 'Internal Server Error', message: 'Failed to store webmention' });
      }

      json(res, 202, {
        status: 'accepted',
        message: 'Webmention received and queued for processing',
      });
    },
  });

  // GET /api/webmentions/:handle — List webmentions for a profile
  routes.push({
    method: 'GET',
    pattern: /^\/api\/webmentions\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      const result = await pool.query(
        `SELECT id, source_url, target_url, status, verified_at,
                content_snippet, author_name, author_url, created_at
         FROM social_federation.webmentions
         WHERE target_handle = $1
         ORDER BY created_at DESC`,
        [handle]
      );

      json(res, 200, {
        handle,
        webmentions: result.rows,
        count: result.rowCount,
      });
    },
  });

  // GET /.well-known/oauth-authorization-server — IndieAuth metadata
  routes.push({
    method: 'GET',
    pattern: '/.well-known/oauth-authorization-server',
    handler: async (req, res) => {
      const metadata = {
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/auth`,
        token_endpoint: `${BASE_URL}/token`,
        service_documentation: 'https://indieauth.spec.indieweb.org/',
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code'],
        response_types_supported: ['code'],
        scopes_supported: ['profile', 'email', 'create', 'update', 'delete', 'media'],
      };

      json(res, 200, metadata);
    },
  });
}

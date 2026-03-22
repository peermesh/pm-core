// =============================================================================
// Matrix Protocol Identity Bridge Routes
// =============================================================================
// GET /api/matrix/identity/:handle   — Matrix ID mapping (identity bridge)
// GET /.well-known/matrix/server     — Matrix server discovery (stub)
// GET /.well-known/matrix/client     — Matrix client discovery (stub)
//
// CRITICAL: These are IDENTITY BRIDGES ONLY -- NOT chat implementations.
// Per CEO-MANDATORY-VISION Section 4: chat is NOT part of Social Lab.
// Matrix messaging is handled by Matrix clients (Element, FluffyChat, etc.)
// or a separate chat module -- never by Social Lab.
//
// Source blueprint: F-015 (Matrix Protocol Surface)

import { pool } from '../db.js';
import { json, jsonWithType, lookupProfileByHandle, BASE_URL, SUBDOMAIN, DOMAIN } from '../lib/helpers.js';

// Matrix homeserver domain (stub -- points to future homeserver)
const MATRIX_DOMAIN = process.env.MATRIX_DOMAIN || `${SUBDOMAIN}.${DOMAIN}`;
const MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL || `https://matrix.${DOMAIN}`;

export default function registerRoutes(routes) {
  // GET /api/matrix/identity/:handle — Matrix ID mapping (identity bridge)
  // Returns the Matrix ID for a given handle, enabling WebID-to-Matrix-ID resolution.
  routes.push({
    method: 'GET',
    pattern: /^\/api\/matrix\/identity\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);

      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      // Matrix ID: either stored in DB or derived from handle
      const matrixId = profile.matrix_id || `@${handle}:${MATRIX_DOMAIN}`;

      json(res, 200, {
        handle,
        matrix_id: matrixId,
        homeserver: MATRIX_HOMESERVER_URL,
        matrix_uri: `matrix:u/${handle}:${MATRIX_DOMAIN}`,
        bridge_status: profile.matrix_id ? 'provisioned' : 'stub',
        note: 'Identity bridge only. Chat is handled by external Matrix clients.',
      });
    },
  });

  // GET /.well-known/matrix/server — Matrix server discovery (stub)
  // Per F-015 Section 7: serves delegation JSON for federation.
  // Currently a stub pointing to a future homeserver.
  routes.push({
    method: 'GET',
    pattern: '/.well-known/matrix/server',
    handler: async (req, res) => {
      const serverDelegation = {
        'm.server': `matrix.${DOMAIN}:443`,
      };

      jsonWithType(res, 200, 'application/json', serverDelegation, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'max-age=86400, public',
      });
    },
  });

  // GET /.well-known/matrix/client — Matrix client discovery (stub)
  // Per F-015 Section 7: serves client well-known for homeserver auto-discovery.
  // Currently a stub pointing to a future homeserver.
  routes.push({
    method: 'GET',
    pattern: '/.well-known/matrix/client',
    handler: async (req, res) => {
      const clientDiscovery = {
        'm.homeserver': {
          'base_url': MATRIX_HOMESERVER_URL,
        },
      };

      jsonWithType(res, 200, 'application/json', clientDiscovery, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'max-age=86400, public',
      });
    },
  });
}

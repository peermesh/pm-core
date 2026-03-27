// =============================================================================
// Data Sync Protocol Routes (Hypercore + Braid)
// =============================================================================
// GET /api/hypercore/feed/:handle   — Hypercore feed info (stub)
// GET /api/hypercore/status         — Hypercore/Pear runtime status (stub)
// GET /api/braid/version/:resource  — Braid version history for a resource (stub)
//
// CRITICAL: These are PROTOCOL SURFACE STUBS -- not full implementations.
// Per CEO-MANDATORY-VISION Section 4: chat is NOT part of Social.
// Hypercore chat functionality is explicitly out of scope.
//
// Hypercore is a complement to the Solid Pod, NOT a replacement.
// Braid extends HTTP -- it does NOT replace it.
// Both protocols are optional; Social functions fully without them.
//
// Future consideration: Support Braid-HTTP headers (Version, Parents,
// Subscribe, Patches) on existing profile endpoints. This is documented
// but not implemented in this stub phase. When implemented, Braid headers
// will be opt-in -- clients that do not send Braid headers receive
// standard HTTP responses with zero disruption.
//
// Source blueprints: F-013 (Hypercore/Pear), F-014 (Braid Protocol)

import { pool } from '../db.js';
import { json, lookupProfileByHandle, BASE_URL } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // =========================================================================
  // Hypercore Protocol Endpoints (F-013)
  // =========================================================================

  // GET /api/hypercore/feed/:handle — Hypercore feed info
  //
  // Returns the Hypercore feed key and metadata for a given handle.
  // Phase 1 stub: returns the stored hypercore_feed_key or a placeholder
  // indicating the feed has not yet been initialized.
  routes.push({
    method: 'GET',
    pattern: /^\/api\/hypercore\/feed\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      const feedKey = profile.hypercore_feed_key || null;

      json(res, 200, {
        handle: profile.username,
        webid: profile.webid,
        hypercore: {
          feedKey,
          initialized: feedKey !== null,
          protocol: 'hypercore',
          keyType: 'ed25519',
          status: feedKey ? 'active' : 'not_initialized',
          note: feedKey
            ? undefined
            : 'Hypercore feed not yet initialized. Feed will be created during Omni-Account provisioning pipeline (Step 5).',
        },
        _stub: true,
        _links: {
          self: `${BASE_URL}/api/hypercore/feed/${handle}`,
          profile: `${BASE_URL}/api/profile/${profile.id}`,
          status: `${BASE_URL}/api/hypercore/status`,
        },
      });
    },
  });

  // GET /api/hypercore/status — Hypercore/Pear runtime status
  //
  // Returns the current status of the Hypercore and Pear runtime
  // on this Social instance. Phase 1 stub: always returns
  // "not_running" since the runtime is not yet integrated.
  routes.push({
    method: 'GET',
    pattern: '/api/hypercore/status',
    handler: async (req, res) => {
      json(res, 200, {
        hypercore: {
          runtime: 'not_running',
          version: null,
          feeds: 0,
          connections: 0,
          note: 'Hypercore runtime not yet integrated. This is a Phase 1 stub endpoint.',
        },
        pear: {
          runtime: 'not_running',
          detected: false,
          environment: 'node',
          note: 'Pear Runtime not detected. Running in standard Node.js server mode.',
        },
        hyperswarm: {
          joined: false,
          peers: 0,
          dhtNodes: 0,
          note: 'Hyperswarm DHT not yet active. Will be initialized when Hypercore runtime starts.',
        },
        _stub: true,
        _links: {
          self: `${BASE_URL}/api/hypercore/status`,
        },
      });
    },
  });

  // =========================================================================
  // Braid Protocol Endpoints (F-014)
  // =========================================================================

  // GET /api/braid/version/:resource — Braid version history for a resource
  //
  // Returns the Braid version history (DAG) for a given resource URI.
  // Phase 1 stub: returns an empty version history with metadata
  // indicating that Braid versioning is not yet active.
  //
  // The :resource parameter is a URL-encoded resource URI, e.g.:
  //   /api/braid/version/profile%2Fcard
  //   /api/braid/version/posts%2F123
  routes.push({
    method: 'GET',
    pattern: /^\/api\/braid\/version\/(.+)$/,
    handler: async (req, res, matches) => {
      const resource = decodeURIComponent(matches[1]);

      json(res, 200, {
        resource,
        braid: {
          enabled: false,
          protocol: 'braid-http',
          spec: 'IETF draft-toomim-httpbis-braid-http',
          versionCount: 0,
          versions: [],
          currentVersion: null,
          patchFormat: 'application/merge-patch+json',
          subscriptionSupported: false,
          mergeType: 'last-writer-wins',
          note: 'Braid versioning not yet active. This is a Phase 1 stub. When enabled, this endpoint will return the version DAG for the specified resource.',
        },
        _stub: true,
        _links: {
          self: `${BASE_URL}/api/braid/version/${encodeURIComponent(resource)}`,
        },
        // Future: Braid-HTTP headers on existing profile endpoints
        // When implemented, GET /api/profile/:id will support:
        //   Request:  Subscribe: true, Version: <hash>
        //   Response: Version: <hash>, Parents: <hash>, Patches: ...
        // See F-014 blueprint Section 1 for full specification.
      });
    },
  });
}

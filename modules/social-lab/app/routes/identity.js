// =============================================================================
// Identity Verification Routes — Cross-Instance WebID Verification
// =============================================================================
// GET  /api/identity/verify?webid=URL  — Verify a WebID from another instance
// GET  /api/instances                  — List known PeerMesh instances
// POST /api/instances/register         — Register a new instance (public key exchange)
//
// Part of WO-008: Ecosystem SSO Phase 1 (ARCH-010, FLOW-004).
// =============================================================================

import { json, readJsonBody, parseUrl, BASE_URL } from '../lib/helpers.js';
import { verifyManifest, getManifestByHandle } from '../lib/manifest.js';
import { pool } from '../db.js';
import {
  listInstances,
  registerRemoteInstance,
  getInstancePublicKey,
  INSTANCE_DOMAIN,
} from '../lib/sso.js';

// =============================================================================
// WebID Verification
// =============================================================================

/**
 * Fetch a remote WebID document and extract identity claims.
 * For PeerMesh instances, also fetches and verifies the Universal Manifest.
 *
 * @param {string} webidUrl - The WebID URL to verify
 * @returns {Promise<object>} Verification result
 */
async function verifyWebId(webidUrl) {
  // Basic URL validation
  let parsed;
  try {
    parsed = new URL(webidUrl);
  } catch {
    return {
      verified: false,
      error: 'Invalid WebID URL',
      webid: webidUrl,
    };
  }

  // Check if this is a local WebID (on our instance)
  const isLocal = parsed.hostname === INSTANCE_DOMAIN ||
    webidUrl.startsWith(BASE_URL);

  if (isLocal) {
    return verifyLocalWebId(webidUrl);
  }

  return verifyRemoteWebId(webidUrl, parsed);
}

/**
 * Verify a local WebID (user on this instance).
 */
async function verifyLocalWebId(webidUrl) {
  // Extract profile info from the WebID
  // WebID format: https://domain/profile/{id}#me
  const match = webidUrl.match(/\/profile\/([^/#]+)/);
  if (!match) {
    return {
      verified: false,
      error: 'WebID does not match expected format',
      webid: webidUrl,
    };
  }

  const profileId = match[1];

  const result = await pool.query(
    `SELECT p.id, p.webid, p.omni_account_id, p.display_name, p.username,
            p.ap_actor_uri, p.at_did, p.nostr_npub
     FROM social_profiles.profile_index p
     WHERE p.id = $1 OR p.webid = $2
     LIMIT 1`,
    [profileId, webidUrl.replace(/#.*$/, '')]
  );

  if (result.rowCount === 0) {
    return {
      verified: false,
      error: 'WebID not found on this instance',
      webid: webidUrl,
    };
  }

  const profile = result.rows[0];

  // Fetch and verify the manifest if available
  let manifestVerified = false;
  let manifest = null;
  if (profile.username) {
    manifest = await getManifestByHandle(profile.username);
    if (manifest) {
      const verification = verifyManifest(manifest);
      manifestVerified = verification.valid;
    }
  }

  return {
    verified: true,
    webid: profile.webid,
    source: 'local',
    identity: {
      display_name: profile.display_name,
      handle: profile.username,
      omni_account_id: profile.omni_account_id,
      protocol_ids: {
        ap_actor_uri: profile.ap_actor_uri,
        at_did: profile.at_did,
        nostr_npub: profile.nostr_npub,
      },
    },
    manifest: {
      present: !!manifest,
      verified: manifestVerified,
    },
  };
}

/**
 * Verify a remote WebID (user on another instance).
 * Fetches the WebID document and attempts manifest verification.
 */
async function verifyRemoteWebId(webidUrl, parsed) {
  // Fetch the WebID document
  let webidDoc;
  try {
    const response = await fetch(webidUrl, {
      headers: {
        Accept: 'application/ld+json, application/json, text/html',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        verified: false,
        error: `Failed to fetch WebID document: HTTP ${response.status}`,
        webid: webidUrl,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      webidDoc = await response.json();
    } else {
      // HTML response — we can still confirm the URL resolves
      return {
        verified: true,
        webid: webidUrl,
        source: 'remote',
        note: 'WebID URL resolves (HTML response). Full JSON-LD verification not available.',
        identity: {
          display_name: null,
          handle: null,
          source_domain: parsed.hostname,
        },
        manifest: { present: false, verified: false },
      };
    }
  } catch (err) {
    return {
      verified: false,
      error: `Failed to fetch WebID: ${err.message}`,
      webid: webidUrl,
    };
  }

  // Try to fetch the manifest from the remote instance
  // Convention: manifest is at /api/manifest/{handle}
  let manifestVerified = false;
  let manifestPresent = false;

  // Extract handle from WebID doc if present
  const handle = webidDoc.handle || webidDoc.preferredUsername ||
    (webidDoc['as:preferredUsername'] && webidDoc['as:preferredUsername']['@value']);

  if (handle) {
    try {
      const manifestUrl = `https://${parsed.hostname}/api/manifest/${handle}`;
      const mResponse = await fetch(manifestUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (mResponse.ok) {
        const manifestDoc = await mResponse.json();
        if (manifestDoc && manifestDoc['@type']) {
          manifestPresent = true;
          const verification = verifyManifest(manifestDoc);
          manifestVerified = verification.valid;
        }
      }
    } catch {
      // Manifest fetch failed — not critical
    }
  }

  return {
    verified: true,
    webid: webidUrl,
    source: 'remote',
    source_domain: parsed.hostname,
    identity: {
      display_name: webidDoc.name || webidDoc.displayName || null,
      handle: handle || null,
      omni_account_id: webidDoc.omniAccountId || null,
    },
    manifest: {
      present: manifestPresent,
      verified: manifestVerified,
    },
  };
}

// =============================================================================
// Route Registration
// =============================================================================

export default function registerRoutes(routes) {
  // GET /api/identity/verify?webid=URL — Verify a WebID
  routes.push({
    method: 'GET',
    pattern: /^\/api\/identity\/verify$/,
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const webid = searchParams.get('webid');

      if (!webid) {
        return json(res, 400, {
          error: 'Missing required parameter: webid',
          usage: 'GET /api/identity/verify?webid=https://example.com/profile/id#me',
        });
      }

      try {
        const result = await verifyWebId(webid);
        const status = result.verified ? 200 : 404;
        json(res, status, result);
      } catch (err) {
        console.error(`[identity] Verification error for ${webid}:`, err.message);
        json(res, 500, {
          error: 'Internal verification error',
          webid,
        });
      }
    },
  });

  // GET /api/instances — List known instances
  routes.push({
    method: 'GET',
    pattern: '/api/instances',
    handler: async (req, res) => {
      try {
        const instances = await listInstances();
        json(res, 200, {
          instances,
          count: instances.length,
          this_instance: INSTANCE_DOMAIN,
        });
      } catch (err) {
        console.error('[identity] Failed to list instances:', err.message);
        json(res, 500, { error: 'Failed to list instances' });
      }
    },
  });

  // POST /api/instances/register — Register a remote instance
  routes.push({
    method: 'POST',
    pattern: '/api/instances/register',
    handler: async (req, res) => {
      let body;
      try {
        const { parsed } = await readJsonBody(req);
        body = parsed;
      } catch (err) {
        return json(res, 400, { error: 'Invalid JSON body' });
      }

      if (!body || !body.domain || !body.public_key) {
        return json(res, 400, {
          error: 'Missing required fields: domain, public_key',
          usage: {
            domain: 'instance.example.com',
            public_key: 'base64url-encoded SPKI Ed25519 public key',
            name: 'optional instance name',
            nodeinfo_url: 'optional NodeInfo URL',
          },
        });
      }

      // Reject self-registration from external sources
      if (body.domain === INSTANCE_DOMAIN) {
        return json(res, 400, {
          error: 'Cannot register self via external API',
        });
      }

      try {
        const result = await registerRemoteInstance(body);
        json(res, 200, {
          registered: true,
          ...result,
        });
      } catch (err) {
        console.error(`[identity] Failed to register instance ${body.domain}:`, err.message);
        json(res, 500, { error: 'Instance registration failed' });
      }
    },
  });

  // GET /api/instances/self — Get this instance's public info (for discovery)
  routes.push({
    method: 'GET',
    pattern: '/api/instances/self',
    handler: async (req, res) => {
      try {
        const publicKey = await getInstancePublicKey();
        json(res, 200, {
          domain: INSTANCE_DOMAIN,
          name: `PeerMesh Social Lab (${INSTANCE_DOMAIN})`,
          public_key: publicKey,
          nodeinfo_url: `${BASE_URL}/.well-known/nodeinfo`,
          base_url: BASE_URL,
          software: {
            name: 'peermesh-social-lab',
            version: '0.6.0',
          },
          capabilities: ['sso', 'social-graph-sync'],
          sso_endpoints: {
            authorize: `${BASE_URL}/sso/authorize`,
            verify: `${BASE_URL}/sso/verify`,
            identity_verify: `${BASE_URL}/api/identity/verify`,
          },
        });
      } catch (err) {
        console.error('[identity] Failed to get self info:', err.message);
        json(res, 500, { error: 'Failed to get instance info' });
      }
    },
  });
}

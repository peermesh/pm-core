// =============================================================================
// Universal Manifest API Routes (F-030)
// =============================================================================
// GET  /api/manifest/:handle           — Return signed Universal Manifest
// GET  /.well-known/manifest/:handle   — Public manifest endpoint (same data)
// POST /api/manifest/verify            — Verify a manifest signature
// POST /api/manifest/regenerate/:handle — Regenerate manifest after profile update
//
// All responses are JSON-LD (application/ld+json) for manifest endpoints,
// except verify which returns application/json.
// =============================================================================

import { json, jsonWithType, readJsonBody } from '../lib/helpers.js';
import { getManifestByHandle, verifyManifest, generateAndStoreManifest } from '../lib/manifest.js';
import { getEd25519Keypair } from '../lib/identity-keys.js';
import { pool } from '../db.js';

export default function registerRoutes(routes) {

  // -------------------------------------------------------------------------
  // GET /api/manifest/:handle — Return signed Universal Manifest
  // -------------------------------------------------------------------------
  routes.push({
    method: 'GET',
    pattern: /^\/api\/manifest\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];

      // Reject the literal string "verify" — that's the POST endpoint
      if (handle === 'verify') {
        return json(res, 405, { error: 'Method Not Allowed', message: 'Use POST for /api/manifest/verify' });
      }

      try {
        const manifest = await getManifestByHandle(handle);
        if (!manifest) {
          return json(res, 404, {
            error: 'Not Found',
            message: `No manifest found for handle: ${handle}`,
          });
        }

        // Return as JSON-LD with short cache
        jsonWithType(res, 200, 'application/ld+json; charset=utf-8', manifest, {
          'Cache-Control': 'public, max-age=60',
        });
      } catch (err) {
        console.error(`[manifest] Error fetching manifest for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error' });
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /.well-known/manifest/:handle — Public manifest endpoint
  // -------------------------------------------------------------------------
  // Same as /api/manifest/:handle but at the well-known path for
  // interoperability with UM-compatible systems.
  routes.push({
    method: 'GET',
    pattern: /^\/\.well-known\/manifest\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];

      try {
        const manifest = await getManifestByHandle(handle);
        if (!manifest) {
          return json(res, 404, {
            error: 'Not Found',
            message: `No manifest found for handle: ${handle}`,
          });
        }

        jsonWithType(res, 200, 'application/ld+json; charset=utf-8', manifest, {
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        });
      } catch (err) {
        console.error(`[manifest] Error fetching well-known manifest for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error' });
      }
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/manifest/verify — Verify a manifest signature
  // -------------------------------------------------------------------------
  // Body: { manifest: <signed manifest object>, publicKey?: <base64url SPKI> }
  // The publicKey is optional; if omitted, uses the key embedded in the
  // manifest's signature block.
  routes.push({
    method: 'POST',
    pattern: '/api/manifest/verify',
    handler: async (req, res) => {
      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.manifest) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Request body must include a "manifest" object',
        });
      }

      const result = verifyManifest(body.manifest, body.publicKey || null);

      json(res, 200, {
        valid: result.valid,
        error: result.error || null,
        subject: body.manifest.subject || null,
        manifestId: body.manifest['@id'] || null,
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/manifest/regenerate/:handle — Regenerate manifest
  // -------------------------------------------------------------------------
  // Called after profile updates to regenerate and re-sign the manifest.
  // Increments the version and preserves the UMID.
  routes.push({
    method: 'POST',
    pattern: /^\/api\/manifest\/regenerate\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];

      try {
        // Look up profile
        const profileResult = await pool.query(
          `SELECT id, webid, omni_account_id, display_name, username, bio,
                  avatar_url, banner_url, homepage_url, source_pod_uri,
                  nostr_npub, at_did, ap_actor_uri, dsnp_user_id,
                  zot_channel_hash, matrix_id
           FROM social_profiles.profile_index
           WHERE username = $1
           ORDER BY created_at ASC
           LIMIT 1`,
          [handle]
        );

        if (profileResult.rowCount === 0) {
          return json(res, 404, {
            error: 'Not Found',
            message: `Profile not found for handle: ${handle}`,
          });
        }

        const profile = profileResult.rows[0];

        // Get Ed25519 keypair
        const keypair = await getEd25519Keypair(profile.omni_account_id);
        if (!keypair) {
          return json(res, 409, {
            error: 'Conflict',
            message: 'No Ed25519 identity keypair found. Generate keys first.',
          });
        }

        // Regenerate and store
        const signedManifest = await generateAndStoreManifest(profile, keypair);

        json(res, 200, {
          message: 'Manifest regenerated',
          manifest: signedManifest,
        });
      } catch (err) {
        console.error(`[manifest] Error regenerating manifest for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error' });
      }
    },
  });
}

// =============================================================================
// Universal Manifest v0.2 API Routes (F-030)
// =============================================================================
// GET  /api/manifest/:handle           — Return signed UM v0.2 manifest (API wrapper)
// GET  /.well-known/manifest/:handle   — Public manifest endpoint (JSON-LD)
// POST /api/manifest/verify            — Verify a v0.2 manifest signature
// POST /api/manifest/regenerate/:handle — Regenerate manifest after profile update
//
// Content-Type: application/ld+json for manifest endpoints.
// UMID included in X-Universal-Manifest-Id response header.
// Verification uses UM v0.2 verifier checklist (Ed25519 + JCS-RFC8785).
// =============================================================================

import { json, jsonWithType, readJsonBody } from '../lib/helpers.js';
import {
  getManifestByHandle,
  verifyManifest,
  generateAndStoreManifest,
  UM_MANIFEST_VERSION,
} from '../lib/manifest.js';
import { getEd25519Keypair } from '../lib/identity-keys.js';
import { pool } from '../db.js';

export default function registerRoutes(routes) {

  // -------------------------------------------------------------------------
  // GET /api/manifest/:handle — Return signed Universal Manifest (API wrapper)
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

        // Return as JSON-LD with UMID header and short cache
        const umid = manifest['@id'] || null;
        jsonWithType(res, 200, 'application/ld+json; charset=utf-8', manifest, {
          'Cache-Control': 'public, max-age=60',
          ...(umid ? { 'X-Universal-Manifest-Id': umid } : {}),
          'X-Manifest-Version': UM_MANIFEST_VERSION,
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
  // Well-known path for interoperability with UM-compatible systems.
  // Returns the same v0.2 manifest as /api/manifest/:handle.
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

        const umid = manifest['@id'] || null;
        jsonWithType(res, 200, 'application/ld+json; charset=utf-8', manifest, {
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
          ...(umid ? { 'X-Universal-Manifest-Id': umid } : {}),
          'X-Manifest-Version': UM_MANIFEST_VERSION,
        });
      } catch (err) {
        console.error(`[manifest] Error fetching well-known manifest for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error' });
      }
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/manifest/verify — Verify a manifest signature (v0.2 checklist)
  // -------------------------------------------------------------------------
  // Body: { manifest: <signed manifest object>, publicKey?: <base64 SPKI> }
  //
  // Implements the UM v0.2 verifier checklist:
  //   1. Structural validation (@type, manifestVersion, subject, TTL)
  //   2. Signature profile validation (Ed25519 + JCS-RFC8785)
  //   3. Ed25519 signature verification over JCS-canonicalized content
  //
  // The publicKey is optional; if omitted, uses the key embedded in the
  // manifest's signature.publicKeySpkiB64.
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

      const umid = body.manifest['@id'] || null;
      json(res, 200, {
        valid: result.valid,
        error: result.error || null,
        manifestVersion: result.manifestVersion || body.manifest.manifestVersion || null,
        subject: body.manifest.subject || null,
        manifestId: umid,
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/manifest/regenerate/:handle — Regenerate manifest
  // -------------------------------------------------------------------------
  // Called after profile updates to regenerate and re-sign as v0.2.
  // Increments the internal version and preserves the UMID.
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

        // Regenerate and store as v0.2
        const signedManifest = await generateAndStoreManifest(profile, keypair);

        const umid = signedManifest['@id'] || null;
        json(res, 200, {
          message: 'Manifest regenerated (v0.2)',
          manifestVersion: UM_MANIFEST_VERSION,
          manifestId: umid,
          manifest: signedManifest,
        });
      } catch (err) {
        console.error(`[manifest] Error regenerating manifest for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error' });
      }
    },
  });
}

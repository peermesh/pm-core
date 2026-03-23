// =============================================================================
// Profile CRUD Routes
// =============================================================================
// POST /api/profile        — Create
// GET  /api/profiles       — List all
// GET  /api/profile/:id    — Read
// PUT  /api/profile/:id    — Update
// DELETE /api/profile/:id  — Delete

import { randomUUID, createHash } from 'node:crypto';
import { pool } from '../db.js';
import { json, readJsonBody, extractId, BASE_URL, INSTANCE_DOMAIN } from '../lib/helpers.js';
import { generateNostrKeypair } from '../lib/nostr-crypto.js';
import { requireAuth } from '../lib/session.js';

export default function registerRoutes(routes) {
  // GET /api/profiles — List all profiles
  routes.push({
    method: 'GET',
    pattern: '/api/profiles',
    handler: async (req, res) => {
      const result = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username, bio,
                avatar_url, banner_url, homepage_url, deployment_mode,
                profile_version, ap_actor_uri, at_did, nostr_npub,
                dsnp_user_id, zot_channel_hash, source_pod_uri,
                created_at, updated_at
         FROM social_profiles.profile_index
         ORDER BY created_at DESC`
      );
      json(res, 200, { profiles: result.rows, count: result.rowCount });
    },
  });

  // POST /api/profile — Create a new profile
  routes.push({
    method: 'POST',
    pattern: '/api/profile',
    handler: async (req, res) => {
      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body) {
        return json(res, 400, { error: 'Bad Request', message: 'Request body is required' });
      }

      const id = randomUUID();
      const displayName = body.displayName || null;
      const bio = body.bio || null;
      const handle = body.handle || null;
      const avatarUrl = body.avatarUrl || null;

      // Auto-generate required fields for Phase 2
      const webid = `${BASE_URL}/profile/${id}#me`;
      const omniAccountId = `urn:peermesh:omni:${id}`;
      const sourcePodUri = `${BASE_URL}/pod/${id}/`;

      // Generate Nostr secp256k1 keypair (Omni-Account pipeline Step 5b)
      let nostrNpub = null;
      let nostrKeypair = null;
      try {
        nostrKeypair = generateNostrKeypair();
        nostrNpub = nostrKeypair.npub;
        console.log(`[nostr] Generated keypair for profile ${id}: npub=${nostrNpub}`);
      } catch (err) {
        console.error(`[nostr] Keypair generation failed for profile ${id}:`, err.message);
      }

      // Generate AT Protocol DID (Omni-Account pipeline Step 5c — F-005)
      // INSTANCE_DOMAIN is resolved from SOCIAL_LAB_SUBDOMAIN + DOMAIN env vars.
      // For root-domain deployments (peers.social), INSTANCE_DOMAIN equals DOMAIN.
      let atDid = null;
      if (handle) {
        const ourDomain = INSTANCE_DOMAIN;
        atDid = `did:web:${ourDomain}:ap:actor:${handle}`;
        console.log(`[at-protocol] Generated DID for profile ${id}: ${atDid}`);
      }

      // Generate DSNP User ID stub (Omni-Account pipeline — F-011)
      let dsnpUserId = null;
      try {
        const dsnpHash = createHash('sha256').update(omniAccountId).digest('hex');
        dsnpUserId = String(parseInt(dsnpHash.slice(0, 8), 16)).padStart(8, '0');
        console.log(`[dsnp] Generated stub User ID for profile ${id}: ${dsnpUserId}`);
      } catch (err) {
        console.error(`[dsnp] User ID generation failed for profile ${id}:`, err.message);
      }

      // Generate Zot channel hash stub (Omni-Account pipeline — F-012)
      let zotChannelHash = null;
      try {
        zotChannelHash = createHash('sha256').update(`zot:${omniAccountId}`).digest('hex');
        console.log(`[zot] Generated stub channel hash for profile ${id}: ${zotChannelHash.slice(0, 12)}...`);
      } catch (err) {
        console.error(`[zot] Channel hash generation failed for profile ${id}:`, err.message);
      }

      const result = await pool.query(
        `INSERT INTO social_profiles.profile_index
           (id, webid, omni_account_id, display_name, username, bio, avatar_url, source_pod_uri, nostr_npub, at_did, dsnp_user_id, zot_channel_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, webid, omni_account_id, display_name, username, bio,
                   avatar_url, banner_url, homepage_url, deployment_mode,
                   profile_version, source_pod_uri, nostr_npub, at_did,
                   dsnp_user_id, zot_channel_hash, created_at, updated_at`,
        [id, webid, omniAccountId, displayName, handle, bio, avatarUrl, sourcePodUri, nostrNpub, atDid, dsnpUserId, zotChannelHash]
      );

      // Store Nostr key metadata in social_keys
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
          console.error(`[nostr] Failed to store key metadata for profile ${id}:`, err.message);
        }
      }

      json(res, 201, result.rows[0]);
    },
  });

  // GET /api/profile/:id — Read a single profile
  routes.push({
    method: 'GET',
    pattern: /^\/api\/profile\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const id = matches[1];
      const result = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username, bio,
                avatar_url, banner_url, homepage_url, deployment_mode,
                profile_version, ap_actor_uri, at_did, nostr_npub,
                dsnp_user_id, zot_channel_hash, source_pod_uri,
                created_at, updated_at
         FROM social_profiles.profile_index
         WHERE id = $1`,
        [id]
      );

      if (result.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${id} not found` });
      }

      json(res, 200, result.rows[0]);
    },
  });

  // PUT /api/profile/:id — Update a profile
  routes.push({
    method: 'PUT',
    pattern: /^\/api\/profile\/([^/]+)$/,
    handler: async (req, res, matches) => {
      // Auth check — require session
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const id = matches[1];

      const existing = await pool.query(
        'SELECT id FROM social_profiles.profile_index WHERE id = $1',
        [id]
      );
      if (existing.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${id} not found` });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || Object.keys(body).length === 0) {
        return json(res, 400, { error: 'Bad Request', message: 'Request body with fields to update is required' });
      }

      const fieldMap = {
        displayName: 'display_name',
        bio: 'bio',
        handle: 'username',
        avatarUrl: 'avatar_url',
        bannerUrl: 'banner_url',
        homepageUrl: 'homepage_url',
      };

      const setClauses = [];
      const values = [];
      let paramIdx = 1;

      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body) {
          setClauses.push(`${column} = $${paramIdx}`);
          values.push(body[key]);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return json(res, 400, { error: 'Bad Request', message: 'No recognized fields to update' });
      }

      setClauses.push(`updated_at = NOW()`);

      values.push(id);
      const query = `UPDATE social_profiles.profile_index
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIdx}
        RETURNING id, webid, omni_account_id, display_name, username, bio,
                  avatar_url, banner_url, homepage_url, deployment_mode,
                  profile_version, source_pod_uri, nostr_npub, at_did,
                  dsnp_user_id, zot_channel_hash, created_at, updated_at`;

      const result = await pool.query(query, values);
      json(res, 200, result.rows[0]);
    },
  });

  // DELETE /api/profile/:id — Delete a profile
  routes.push({
    method: 'DELETE',
    pattern: /^\/api\/profile\/([^/]+)$/,
    handler: async (req, res, matches) => {
      // Auth check — require session
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const id = matches[1];
      const result = await pool.query(
        'DELETE FROM social_profiles.profile_index WHERE id = $1',
        [id]
      );

      if (result.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${id} not found` });
      }

      res.writeHead(204);
      res.end();
    },
  });
}

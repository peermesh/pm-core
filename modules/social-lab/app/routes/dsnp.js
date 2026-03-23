// =============================================================================
// DSNP Protocol Routes (F-011)
// =============================================================================
// GET /api/dsnp/profile/:handle  — DSNP User ID mapping
// GET /api/dsnp/graph/:handle    — Social graph in DSNP format
//
// Stub implementation: generates deterministic DSNP User IDs from profile data
// and returns empty graph structures. Full Frequency blockchain integration
// will replace these stubs per F-011 blueprint.

import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { json, lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../lib/helpers.js';

/**
 * Generate a deterministic numeric DSNP User ID from an omni_account_id.
 * In production, this will be replaced by actual Frequency MSA creation.
 * The stub generates an 8-digit numeric ID via SHA-256 truncation.
 */
function generateDsnpUserId(omniAccountId) {
  const hash = createHash('sha256').update(omniAccountId).digest('hex');
  // Take first 8 hex chars, convert to decimal, ensure 8 digits
  const numeric = parseInt(hash.slice(0, 8), 16);
  return String(numeric).padStart(8, '0');
}

export default function registerRoutes(routes) {
  // GET /api/dsnp/profile/:handle — DSNP User ID mapping
  routes.push({
    method: 'GET',
    pattern: /^\/api\/dsnp\/profile\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      let dsnpUserId = profile.dsnp_user_id;

      // If no DSNP User ID exists yet, generate and persist one (stub provisioning)
      if (!dsnpUserId) {
        dsnpUserId = generateDsnpUserId(profile.omni_account_id);
        try {
          await pool.query(
            `UPDATE social_profiles.profile_index SET dsnp_user_id = $1, updated_at = NOW() WHERE id = $2`,
            [dsnpUserId, profile.id]
          );
          console.log(`[dsnp] Provisioned stub DSNP User ID ${dsnpUserId} for ${handle}`);
        } catch (err) {
          console.error(`[dsnp] Failed to persist DSNP User ID for ${handle}:`, err.message);
        }
      }

      const ourDomain = INSTANCE_DOMAIN;

      json(res, 200, {
        '@context': 'https://spec.dsnp.org/v1',
        dsnpUserId: dsnpUserId,
        handle: handle,
        webId: profile.webid,
        provider: {
          name: 'PeerMesh Social Lab',
          endpoint: `${BASE_URL}/api/dsnp`,
          status: 'stub',
        },
        profile: {
          name: profile.display_name || profile.username || handle,
          icon: profile.avatar_url || null,
          summary: profile.bio || null,
          url: `${BASE_URL}/@${handle}`,
        },
        crossProtocolIdentity: {
          webid: profile.webid,
          activityPubActor: profile.ap_actor_uri || null,
          atProtocolDid: profile.at_did || null,
          nostrNpub: profile.nostr_npub || null,
          zotChannelHash: profile.zot_channel_hash || null,
        },
        _stub: true,
        _note: 'This is a stub response. Full Frequency blockchain integration pending per F-011.',
      });
    },
  });

  // GET /api/dsnp/graph/:handle — Social graph in DSNP format
  routes.push({
    method: 'GET',
    pattern: /^\/api\/dsnp\/graph\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const dsnpUserId = profile.dsnp_user_id || generateDsnpUserId(profile.omni_account_id);

      // Return empty graph structure (stub)
      // In production, this queries the Frequency blockchain for graph state
      json(res, 200, {
        '@context': 'https://spec.dsnp.org/v1',
        dsnpUserId: dsnpUserId,
        handle: handle,
        graphType: 'public',
        connections: [],
        connectionCount: 0,
        lastUpdated: new Date().toISOString(),
        _stub: true,
        _note: 'Empty graph stub. Full DSNP graph sync with Frequency blockchain pending per F-011.',
      });
    },
  });
}

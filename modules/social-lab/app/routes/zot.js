// =============================================================================
// Zot Protocol Routes (F-012)
// =============================================================================
// GET /api/zot/channel/:handle   — Zot channel info document
// GET /api/zot/xchan/:handle     — Cross-channel identity mapping
//
// Stub implementation: generates deterministic Zot channel hashes from profile
// data and returns basic channel documents. Full Zot protocol stack (nomadic
// identity, Magic Auth, clone sync) will replace these stubs per F-012 blueprint.

import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { json, lookupProfileByHandle, BASE_URL, SUBDOMAIN, DOMAIN } from '../lib/helpers.js';

/**
 * Generate a deterministic Zot channel hash from an omni_account_id.
 * In production, this will be replaced by actual RSA keypair-derived hashes.
 * The stub generates a 64-char hex hash via SHA-256.
 */
function generateZotChannelHash(omniAccountId) {
  return createHash('sha256').update(`zot:${omniAccountId}`).digest('hex');
}

export default function registerRoutes(routes) {
  // GET /api/zot/channel/:handle — Zot channel info document
  routes.push({
    method: 'GET',
    pattern: /^\/api\/zot\/channel\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      let zotChannelHash = profile.zot_channel_hash;

      // If no Zot channel hash exists yet, generate and persist one (stub provisioning)
      if (!zotChannelHash) {
        zotChannelHash = generateZotChannelHash(profile.omni_account_id);
        try {
          await pool.query(
            `UPDATE social_profiles.profile_index SET zot_channel_hash = $1, updated_at = NOW() WHERE id = $2`,
            [zotChannelHash, profile.id]
          );
          console.log(`[zot] Provisioned stub channel hash for ${handle}: ${zotChannelHash.slice(0, 12)}...`);
        } catch (err) {
          console.error(`[zot] Failed to persist channel hash for ${handle}:`, err.message);
        }
      }

      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
      const channelAddress = `${handle}@${ourDomain}`;

      // Return a Zot-compatible channel info document (stub)
      // Modeled after Hubzilla's zot-info endpoint structure
      json(res, 200, {
        success: true,
        guid: zotChannelHash,
        guid_sig: null,
        key: null,
        name: profile.display_name || profile.username || handle,
        name_updated: profile.updated_at || new Date().toISOString(),
        address: channelAddress,
        photo: {
          mimetype: profile.avatar_url ? 'image/jpeg' : null,
          src: profile.avatar_url || null,
          updated: profile.updated_at || new Date().toISOString(),
        },
        url: `${BASE_URL}/@${handle}`,
        connections_url: `${BASE_URL}/api/zot/graph/${handle}`,
        target: channelAddress,
        target_sig: null,
        searchable: true,
        adult_content: false,
        public_forum: false,
        site: {
          url: BASE_URL,
          url_sig: null,
          project: 'PeerMesh Social Lab',
          version: '0.6.0',
          protocol: 'zot6',
        },
        webid: profile.webid,
        crossProtocolIdentity: {
          webid: profile.webid,
          activityPubActor: profile.ap_actor_uri || null,
          atProtocolDid: profile.at_did || null,
          nostrNpub: profile.nostr_npub || null,
          dsnpUserId: profile.dsnp_user_id || null,
        },
        _stub: true,
        _note: 'This is a stub channel document. Full Zot protocol stack (RSA keys, Magic Auth, cloning) pending per F-012.',
      });
    },
  });

  // GET /api/zot/xchan/:handle — Cross-channel identity (xchan) mapping
  routes.push({
    method: 'GET',
    pattern: /^\/api\/zot\/xchan\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const zotChannelHash = profile.zot_channel_hash || generateZotChannelHash(profile.omni_account_id);
      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;

      // Return a Zot xchan (cross-channel) identity document
      // Maps the Zot identity back to the canonical WebID
      json(res, 200, {
        xchan_hash: zotChannelHash,
        xchan_guid: zotChannelHash,
        xchan_guid_sig: null,
        xchan_pubkey: null,
        xchan_addr: `${handle}@${ourDomain}`,
        xchan_url: `${BASE_URL}/@${handle}`,
        xchan_connurl: `${BASE_URL}/api/zot/channel/${handle}`,
        xchan_name: profile.display_name || profile.username || handle,
        xchan_photo_l: profile.avatar_url || null,
        xchan_photo_m: profile.avatar_url || null,
        xchan_photo_s: profile.avatar_url || null,
        xchan_photo_date: profile.updated_at || new Date().toISOString(),
        xchan_name_date: profile.updated_at || new Date().toISOString(),
        xchan_network: 'zot6',
        xchan_flags: 0,
        xchan_hidden: false,
        xchan_orphan: false,
        xchan_censored: false,
        xchan_selfcensored: false,
        xchan_system: false,
        xchan_deleted: false,
        webid: profile.webid,
        omni_account_id: profile.omni_account_id,
        _stub: true,
        _note: 'Stub xchan document. Maps Zot identity to canonical WebID. Full implementation pending per F-012.',
      });
    },
  });
}

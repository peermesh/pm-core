// =============================================================================
// Nostr Protocol Routes
// =============================================================================
// GET /.well-known/nostr.json       — NIP-05 verification
// GET /api/nostr/profile/:handle    — Nostr Kind 0 profile metadata

import { pool } from '../db.js';
import { json, jsonWithType, parseUrl, lookupProfileByHandle, BASE_URL, SUBDOMAIN, DOMAIN } from '../lib/helpers.js';
import { npubToHex, createNostrEvent } from '../lib/nostr-crypto.js';

export default function registerRoutes(routes) {
  // GET /.well-known/nostr.json — NIP-05 verification
  routes.push({
    method: 'GET',
    pattern: '/.well-known/nostr.json',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const name = searchParams.get('name');

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Accept',
      };

      if (!name) {
        return jsonWithType(res, 400, 'application/json', {
          error: 'Bad Request',
          message: 'Missing required "name" query parameter',
        }, corsHeaders);
      }

      const result = await pool.query(
        `SELECT username, nostr_npub FROM social_profiles.profile_index WHERE username = $1 AND nostr_npub IS NOT NULL`,
        [name]
      );

      if (result.rowCount === 0) {
        return jsonWithType(res, 404, 'application/json', {
          error: 'Not Found',
          message: `No Nostr identity found for name: ${name}`,
        }, corsHeaders);
      }

      const profile = result.rows[0];
      const hexPubkey = npubToHex(profile.nostr_npub);
      if (!hexPubkey) {
        return jsonWithType(res, 500, 'application/json', {
          error: 'Internal Server Error',
          message: 'Failed to decode Nostr public key',
        }, corsHeaders);
      }

      const nip05Response = {
        names: {
          [profile.username]: hexPubkey,
        },
      };

      jsonWithType(res, 200, 'application/json', nip05Response, {
        ...corsHeaders,
        'Cache-Control': 'max-age=3600, public',
      });
    },
  });

  // GET /api/nostr/profile/:handle — Nostr Kind 0 profile metadata
  routes.push({
    method: 'GET',
    pattern: /^\/api\/nostr\/profile\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      if (!profile.nostr_npub) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${handle} does not have a Nostr identity` });
      }

      const pubkeyHex = npubToHex(profile.nostr_npub);
      if (!pubkeyHex) {
        return json(res, 500, { error: 'Internal Server Error', message: 'Failed to decode Nostr public key' });
      }

      const keyResult = await pool.query(
        `SELECT public_key_hash FROM social_keys.key_metadata
         WHERE omni_account_id = $1 AND protocol = 'nostr' AND key_type = 'secp256k1-nsec' AND is_active = TRUE
         LIMIT 1`,
        [profile.omni_account_id]
      );

      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
      const metadataContent = JSON.stringify({
        name: profile.display_name || profile.username || handle,
        about: profile.bio || '',
        picture: profile.avatar_url || '',
        nip05: `${handle}@${ourDomain}`,
        website: profile.homepage_url || `${BASE_URL}/@${handle}`,
      });

      if (keyResult.rowCount === 0) {
        return json(res, 200, {
          unsigned: true,
          note: 'Private key not available server-side. Client-side signing required.',
          pubkey: pubkeyHex,
          kind: 0,
          content: metadataContent,
        });
      }

      const privkeyHex = keyResult.rows[0].public_key_hash;
      try {
        const event = createNostrEvent(0, metadataContent, [], privkeyHex, pubkeyHex);
        json(res, 200, event);
      } catch (err) {
        console.error(`[nostr] Failed to sign Kind 0 event for ${handle}:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: 'Failed to sign Nostr event' });
      }
    },
  });
}

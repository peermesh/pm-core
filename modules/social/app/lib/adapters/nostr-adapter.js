// =============================================================================
// Nostr Protocol Adapter
// =============================================================================
// Wraps the existing Nostr implementation (routes/nostr.js, lib/nostr-crypto.js)
// into the unified ProtocolAdapter interface. Nostr is implemented with NIP-05
// verification and Kind 0 profile metadata generation.
//
// Existing implementation: app/routes/nostr.js
// Key dependencies: lib/nostr-crypto.js (keypair ops, event signing)

import { ProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../helpers.js';
import { npubToHex } from '../nostr-crypto.js';

export class NostrAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'nostr',
      version: '1.0.0',
      status: 'active',
      description: 'Nostr protocol integration. Provides NIP-05 identity verification (/.well-known/nostr.json), Kind 0 profile metadata generation, and secp256k1 keypair management. Relay connectivity for event publishing is planned.',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    const npub = profile.nostr_npub;
    const ourDomain = INSTANCE_DOMAIN;

    return {
      protocol: this.name,
      identifier: npub || null,
      metadata: {
        nip05: npub ? `${profile.username}@${ourDomain}` : null,
        pubkeyHex: npub ? npubToHex(npub) : null,
        provisioned: !!npub,
      },
    };
  }

  async publishContent(post, identity) {
    // Nostr event publishing requires relay connectivity, which is handled
    // by the content distribution pipeline. Kind 1 (text note) events are
    // created and signed server-side when relay connections are configured.
    if (!identity || !identity.identifier) {
      return { success: false, error: 'No Nostr identity provided' };
    }

    return {
      success: true,
      id: null,
      metadata: {
        note: 'Nostr event creation is handled by the post pipeline. Relay delivery requires configured relay list.',
        kind: 1,
      },
    };
  }

  async fetchContent(identity, options = {}) {
    // Fetching from Nostr relays requires WebSocket connections.
    // Currently returns empty; relay subscription is a future feature.
    return [];
  }

  async follow(localIdentity, remoteIdentity) {
    // Nostr follow is a Kind 3 (contact list) event update.
    // Currently handled through the Nostr relay pipeline.
    return {
      success: false,
      status: 'error',
      error: 'Nostr follow (Kind 3 contact list) requires relay connectivity',
    };
  }

  async getProfile(identity) {
    if (!identity || !identity.identifier) return null;

    // Look up by npub
    const result = await pool.query(
      `SELECT username, display_name, bio, avatar_url, webid, nostr_npub
       FROM social_profiles.profile_index
       WHERE nostr_npub = $1`,
      [identity.identifier]
    );

    if (result.rowCount === 0) return null;
    const profile = result.rows[0];

    return {
      handle: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      npub: profile.nostr_npub,
      webid: profile.webid,
    };
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM social_profiles.profile_index WHERE nostr_npub IS NOT NULL`
      );
      return {
        available: true,
        latency: Date.now() - start,
        details: {
          identities: result.rows[0]?.cnt || 0,
          nip05Endpoint: `${BASE_URL}/.well-known/nostr.json`,
        },
      };
    } catch (err) {
      return {
        available: false,
        latency: Date.now() - start,
        error: err.message,
      };
    }
  }
}

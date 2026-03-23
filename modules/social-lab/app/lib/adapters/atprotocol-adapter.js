// =============================================================================
// AT Protocol Adapter
// =============================================================================
// Wraps the existing AT Protocol implementation (routes/atprotocol.js) into
// the unified ProtocolAdapter interface. Provides did:web DID Documents,
// AT Protocol handle resolution, and per-user DID documents.
//
// Existing implementation: app/routes/atprotocol.js
// Key features: did:web resolution, handle-to-DID mapping, DID Documents

import { ProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../helpers.js';

export class AtProtocolAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'atprotocol',
      version: '0.7.0',
      status: 'partial',
      description: 'AT Protocol (Bluesky) integration. Provides did:web DID Documents (/.well-known/did.json), AT Protocol handle resolution (/.well-known/atproto-did), and per-user DID documents. PDS (Personal Data Server) functionality and XRPC endpoints are planned.',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    const handle = profile.username;
    const ourDomain = INSTANCE_DOMAIN;
    const did = profile.at_did || `did:web:${ourDomain}:ap:actor:${handle}`;

    return {
      protocol: this.name,
      identifier: did,
      metadata: {
        handle: `${handle}.${ourDomain}`,
        did,
        didDocument: `${BASE_URL}/ap/actor/${handle}/did.json`,
        handleResolution: `${BASE_URL}/.well-known/atproto-did?handle=${handle}.${ourDomain}`,
        provisioned: true,
      },
    };
  }

  async publishContent(post, identity) {
    // AT Protocol content publishing requires a PDS with XRPC endpoints.
    // Currently the integration provides identity only; content creation
    // via app.bsky.feed.post records is planned.
    return {
      success: false,
      error: 'AT Protocol PDS/XRPC content publishing not yet implemented. DID resolution is available.',
    };
  }

  async fetchContent(identity, options = {}) {
    // Fetching from AT Protocol requires XRPC client.
    return [];
  }

  async follow(localIdentity, remoteIdentity) {
    // AT Protocol follow requires PDS and com.atproto.repo.createRecord.
    return {
      success: false,
      status: 'error',
      error: 'AT Protocol follow requires PDS with XRPC endpoints (not yet implemented)',
    };
  }

  async getProfile(identity) {
    if (!identity || !identity.identifier) return null;

    // Look up by at_did
    const result = await pool.query(
      `SELECT username, display_name, bio, avatar_url, webid, at_did
       FROM social_profiles.profile_index
       WHERE at_did = $1`,
      [identity.identifier]
    );

    if (result.rowCount === 0) return null;
    const profile = result.rows[0];

    return {
      handle: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      did: profile.at_did,
      webid: profile.webid,
    };
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM social_profiles.profile_index WHERE at_did IS NOT NULL`
      );
      return {
        available: true,
        latency: Date.now() - start,
        details: {
          identities: result.rows[0]?.cnt || 0,
          domainDid: `${BASE_URL}/.well-known/did.json`,
          handleResolution: `${BASE_URL}/.well-known/atproto-did`,
          features: ['did-web', 'handle-resolution', 'did-documents'],
          planned: ['pds', 'xrpc', 'repo-sync'],
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

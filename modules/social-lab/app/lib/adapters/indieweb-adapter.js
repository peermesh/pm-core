// =============================================================================
// IndieWeb Protocol Adapter
// =============================================================================
// Wraps the existing IndieWeb implementation (routes/indieweb.js) into the
// unified ProtocolAdapter interface. Currently provides Webmention receiving
// and IndieAuth metadata discovery. The IndieWeb stack is partially implemented:
// Webmentions are received and stored, but verification/rendering is pending.
//
// Existing implementation: app/routes/indieweb.js
// Protocols: Webmention, IndieAuth, Micropub (planned)

import { ProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../helpers.js';

export class IndieWebAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'indieweb',
      version: '0.5.0',
      status: 'partial',
      description: 'IndieWeb protocol suite. Webmention receiving (POST /webmention), webmention listing per profile, and IndieAuth OAuth metadata discovery (/.well-known/oauth-authorization-server). Micropub and full IndieAuth flows are planned.',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    const handle = profile.username;
    const profileUrl = `${BASE_URL}/@${handle}`;

    return {
      protocol: this.name,
      identifier: profileUrl,
      metadata: {
        profileUrl,
        webmentionEndpoint: `${BASE_URL}/webmention`,
        indieAuthMetadata: `${BASE_URL}/.well-known/oauth-authorization-server`,
        provisioned: true,
      },
    };
  }

  async publishContent(post, identity) {
    // IndieWeb content publishing would use Micropub (not yet implemented).
    // Content is published on the profile page, which serves as the IndieWeb
    // "permalink" that others can send Webmentions to.
    return {
      success: true,
      id: null,
      metadata: {
        note: 'IndieWeb content is the profile page itself. Micropub publishing endpoint is planned.',
      },
    };
  }

  async fetchContent(identity, options = {}) {
    // Fetch received webmentions as "content" from the IndieWeb perspective
    if (!identity || !identity.identifier) return [];

    const match = identity.identifier.match(/\/@([^/]+)/);
    if (!match) return [];

    try {
      const result = await pool.query(
        `SELECT id, source_url, target_url, status, content_snippet, author_name, created_at
         FROM social_federation.webmentions
         WHERE target_handle = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [match[1], options.limit || 50]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  async follow(localIdentity, remoteIdentity) {
    // IndieWeb "following" is done via feed subscriptions (RSS/Atom)
    // or Microsub. No direct follow mechanism in the protocol.
    return {
      success: false,
      status: 'error',
      error: 'IndieWeb follow is managed via feed subscriptions (Microsub). Not a server-side operation.',
    };
  }

  async getProfile(identity) {
    if (!identity || !identity.identifier) return null;

    const match = identity.identifier.match(/\/@([^/]+)/);
    if (!match) return null;

    const profile = await lookupProfileByHandle(pool, match[1]);
    if (!profile) return null;

    return {
      handle: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      profileUrl: identity.identifier,
      webmentionEndpoint: `${BASE_URL}/webmention`,
    };
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM social_federation.webmentions`
      );
      return {
        available: true,
        latency: Date.now() - start,
        details: {
          webmentionsReceived: result.rows[0]?.cnt || 0,
          webmentionEndpoint: `${BASE_URL}/webmention`,
          indieAuthMetadata: `${BASE_URL}/.well-known/oauth-authorization-server`,
          features: ['webmention-receive', 'indieauth-metadata'],
          planned: ['micropub', 'webmention-verify', 'microsub'],
        },
      };
    } catch (err) {
      return {
        available: true,
        latency: Date.now() - start,
        details: {
          note: 'Webmention table may not be provisioned yet',
          webmentionEndpoint: `${BASE_URL}/webmention`,
        },
      };
    }
  }
}

// =============================================================================
// RSS / Feed Protocol Adapter
// =============================================================================
// Wraps the existing RSS/Atom/JSON Feed implementation (routes/feeds.js) into
// the unified ProtocolAdapter interface. Provides read-only content distribution
// via standard syndication formats. RSS is a publish-only protocol — there is
// no follow or identity provisioning mechanism in the protocol itself.
//
// Existing implementation: app/routes/feeds.js
// Formats: RSS 2.0, Atom 1.0, JSON Feed 1.1

import { ProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL } from '../helpers.js';

export class RssAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'rss',
      version: '1.0.0',
      status: 'active',
      description: 'RSS/Atom/JSON Feed syndication. Generates RSS 2.0, Atom 1.0, and JSON Feed 1.1 from user posts and bio links. Read-only distribution — subscribers use any feed reader to follow content.',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    const handle = profile.username;
    return {
      protocol: this.name,
      identifier: `${BASE_URL}/@${handle}/feed.xml`,
      metadata: {
        rss: `${BASE_URL}/@${handle}/feed.xml`,
        atom: `${BASE_URL}/@${handle}/feed.atom`,
        jsonFeed: `${BASE_URL}/@${handle}/feed.json`,
        feedIndex: `${BASE_URL}/api/feeds/${handle}`,
        provisioned: true,
      },
    };
  }

  async publishContent(post, identity) {
    // RSS feeds are generated on-demand from the posts table.
    // No explicit "publish" step is needed — the feed endpoints always
    // reflect the current state of the user's posts.
    return {
      success: true,
      id: null,
      metadata: {
        note: 'RSS feeds are generated dynamically from posts. No explicit publish step required.',
      },
    };
  }

  async fetchContent(identity, options = {}) {
    if (!identity || !identity.identifier) return [];

    // Extract handle from the feed URL
    const match = identity.identifier.match(/\/@([^/]+)\//);
    if (!match) return [];

    const profile = await lookupProfileByHandle(pool, match[1]);
    if (!profile) return [];

    try {
      const result = await pool.query(
        `SELECT id, content_text, content_html, media_urls, created_at
         FROM social_profiles.posts
         WHERE webid = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [profile.webid, options.limit || 50]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  async follow(localIdentity, remoteIdentity) {
    // RSS has no follow mechanism in the protocol.
    // Users subscribe via their feed reader application.
    return {
      success: false,
      status: 'error',
      error: 'RSS is a publish-only protocol. Subscriptions are managed by the feed reader, not the server.',
    };
  }

  async getProfile(identity) {
    if (!identity || !identity.identifier) return null;

    const match = identity.identifier.match(/\/@([^/]+)\//);
    if (!match) return null;

    const profile = await lookupProfileByHandle(pool, match[1]);
    if (!profile) return null;

    return {
      handle: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      feedUrl: identity.identifier,
    };
  }

  async healthCheck() {
    // RSS feeds are always available if the server is running.
    // No external dependencies.
    return {
      available: true,
      latency: 0,
      details: {
        formats: ['rss2.0', 'atom1.0', 'jsonfeed1.1'],
        note: 'RSS feeds are generated on-demand from the posts database. No external service dependency.',
      },
    };
  }
}

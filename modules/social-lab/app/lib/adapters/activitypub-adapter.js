// =============================================================================
// ActivityPub Protocol Adapter
// =============================================================================
// Wraps the existing ActivityPub implementation (routes/activitypub.js) into
// the unified ProtocolAdapter interface. ActivityPub is the primary federation
// protocol, fully implemented with WebFinger, Actor documents, inbox/outbox,
// signed HTTP delivery, and Follow/Accept/Create/Announce/Delete/Update handling.
//
// Existing implementation: app/routes/activitypub.js
// Key dependencies: lib/http-signatures.js (signed fetch, signature verification)

import { ProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../helpers.js';

export class ActivityPubAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'activitypub',
      version: '1.0.0',
      status: 'active',
      description: 'W3C ActivityPub federation protocol. Handles WebFinger discovery, Actor documents, signed HTTP delivery, inbox/outbox, Follow/Accept/Create/Announce/Delete/Update activities. Full bidirectional federation with Mastodon, Pleroma, Misskey, and other AP-compatible servers.',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    const handle = profile.username;
    const actorUri = `${BASE_URL}/ap/actor/${handle}`;

    // Check if AP actor already exists
    const existing = await pool.query(
      `SELECT actor_uri, key_id FROM social_federation.ap_actors
       WHERE webid = $1 AND status = 'active'`,
      [profile.webid]
    );

    return {
      protocol: this.name,
      identifier: existing.rowCount > 0 ? existing.rows[0].actor_uri : actorUri,
      metadata: {
        handle,
        keyId: existing.rowCount > 0 ? existing.rows[0].key_id : `${actorUri}#main-key`,
        inbox: `${BASE_URL}/ap/inbox`,
        outbox: `${BASE_URL}/ap/outbox/${handle}`,
        provisioned: existing.rowCount > 0,
      },
    };
  }

  async publishContent(post, identity) {
    // ActivityPub content publishing is handled by the posts route which
    // delivers Create(Note) activities to followers' inboxes via signed HTTP.
    // This adapter method provides the interface for the unified pipeline.
    if (!identity || !identity.identifier) {
      return { success: false, error: 'No ActivityPub identity provided' };
    }

    return {
      success: true,
      id: post.id ? `${BASE_URL}/ap/note/${post.id}` : null,
      metadata: {
        note: 'Content delivery to follower inboxes is handled by the post creation pipeline in routes/activitypub.js',
        actorUri: identity.identifier,
      },
    };
  }

  async fetchContent(identity, options = {}) {
    if (!identity || !identity.identifier) return [];

    // Fetch from local outbox for local actors
    const handleMatch = identity.identifier.match(/\/ap\/actor\/([^/]+)$/);
    if (!handleMatch) return [];

    const handle = handleMatch[1];
    const profile = await lookupProfileByHandle(pool, handle);
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
    // Follow is handled by POST /api/follow in routes/activitypub.js.
    // This adapter provides the interface contract.
    return {
      success: true,
      status: 'pending',
      error: null,
    };
  }

  async getProfile(identity) {
    if (!identity || !identity.identifier) return null;

    const handleMatch = identity.identifier.match(/\/ap\/actor\/([^/]+)$/);
    if (!handleMatch) return null;

    const profile = await lookupProfileByHandle(pool, handleMatch[1]);
    if (!profile) return null;

    return {
      handle: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      actorUri: identity.identifier,
      webid: profile.webid,
    };
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM social_federation.ap_actors WHERE status = 'active'`
      );
      return {
        available: true,
        latency: Date.now() - start,
        details: {
          activeActors: result.rows[0]?.cnt || 0,
          inbox: `${BASE_URL}/ap/inbox`,
          webfinger: `${BASE_URL}/.well-known/webfinger`,
          nodeinfo: `${BASE_URL}/.well-known/nodeinfo`,
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

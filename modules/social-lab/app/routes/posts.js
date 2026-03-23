// =============================================================================
// Post Routes — CRUD + Cross-Protocol Distribution
// =============================================================================
// POST /api/post            — Create a post + distribute to all active protocols
// GET  /api/posts/:handle   — List posts by handle (newest first, paginated)
// GET  /api/post/:id        — Get single post with distribution status
// DELETE /api/post/:id      — Delete post + send tombstone to protocols

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import {
  json, parseUrl, readJsonBody, lookupProfileByHandle,
  escapeHtml, BASE_URL, SUBDOMAIN, DOMAIN,
} from '../lib/helpers.js';
import { signedFetch } from '../lib/http-signatures.js';
import { npubToHex, createNostrEvent } from '../lib/nostr-crypto.js';
import { requireAuth } from '../lib/session.js';

// =============================================================================
// Cross-Protocol Distribution
// =============================================================================

/**
 * Distribute a post via ActivityPub: Create(Note) to all followers' inboxes.
 * @returns {{ status: string, remoteId?: string, error?: string }}
 */
async function distributeActivityPub(post, profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;
  const noteId = `${BASE_URL}/ap/note/${post.id}`;

  // Look up actor keys
  const actorResult = await pool.query(
    `SELECT id, actor_uri, public_key_pem, private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (actorResult.rowCount === 0 || !actorResult.rows[0].private_key_pem) {
    return { status: 'failed', error: 'No active AP actor keys found' };
  }

  const keys = actorResult.rows[0];

  // Build the Note object
  const noteObject = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: noteId,
    type: 'Note',
    attributedTo: actorUri,
    content: post.content_html || escapeHtml(post.content_text),
    published: new Date(post.created_at).toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${actorUri}/followers`],
    url: `${BASE_URL}/@${handle}/post/${post.id}`,
  };

  if (post.in_reply_to) {
    noteObject.inReplyTo = post.in_reply_to;
  }

  if (post.media_urls && post.media_urls.length > 0) {
    noteObject.attachment = post.media_urls.map(url => ({
      type: 'Document',
      url,
    }));
  }

  // Wrap in Create activity
  const createActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${noteId}/activity`,
    type: 'Create',
    actor: actorUri,
    published: new Date(post.created_at).toISOString(),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${actorUri}/followers`],
    object: noteObject,
  };

  // Look up all followers' inboxes
  const followersResult = await pool.query(
    `SELECT DISTINCT COALESCE(follower_shared_inbox, follower_inbox) AS inbox
     FROM social_graph.followers
     WHERE actor_uri = $1 AND status = 'accepted'`,
    [actorUri]
  );

  let deliveryCount = 0;
  let lastError = null;

  for (const row of followersResult.rows) {
    if (!row.inbox) continue;
    try {
      const result = await signedFetch(row.inbox, createActivity, keys.private_key_pem, keys.key_id);
      if (result.status >= 200 && result.status < 300) {
        deliveryCount++;
      } else {
        lastError = `HTTP ${result.status} from ${row.inbox}`;
      }
    } catch (err) {
      lastError = err.message;
      console.error(`[posts] AP delivery to ${row.inbox} failed:`, err.message);
    }
  }

  console.log(`[posts] AP distribution: ${deliveryCount}/${followersResult.rowCount} inboxes delivered for post ${post.id}`);

  return {
    status: 'sent',
    remoteId: noteId,
    error: lastError || undefined,
  };
}

/**
 * Distribute a post via Nostr: Create Kind 1 event.
 * Returns signed event JSON for client-side relay publishing.
 * @returns {{ status: string, remoteId?: string, event?: object, error?: string }}
 */
async function distributeNostr(post, profile) {
  if (!profile.nostr_npub) {
    return { status: 'skipped', error: 'No Nostr identity configured' };
  }

  const pubkeyHex = npubToHex(profile.nostr_npub);
  if (!pubkeyHex) {
    return { status: 'failed', error: 'Failed to decode Nostr public key' };
  }

  // Look up nsec from key_metadata
  const keyResult = await pool.query(
    `SELECT public_key_hash FROM social_keys.key_metadata
     WHERE omni_account_id = $1 AND protocol = 'nostr' AND key_type = 'secp256k1-nsec' AND is_active = TRUE
     LIMIT 1`,
    [profile.omni_account_id]
  );

  if (keyResult.rowCount === 0) {
    return {
      status: 'pending',
      error: 'Private key not available server-side. Client-side signing required.',
      event: {
        unsigned: true,
        pubkey: pubkeyHex,
        kind: 1,
        content: post.content_text,
        tags: [],
      },
    };
  }

  const privkeyHex = keyResult.rows[0].public_key_hash;
  try {
    const event = createNostrEvent(1, post.content_text, [], privkeyHex, pubkeyHex);
    return {
      status: 'sent',
      remoteId: event.id,
      event,
    };
  } catch (err) {
    console.error(`[posts] Nostr event signing failed:`, err.message);
    return { status: 'failed', error: `Signing failed: ${err.message}` };
  }
}

/**
 * Record RSS distribution (passive — feeds auto-include posts).
 * @returns {{ status: string }}
 */
function distributeRss() {
  return { status: 'sent', remoteId: 'auto-included-in-feed' };
}

/**
 * Record IndieWeb distribution (passive — h-feed auto-includes posts).
 * @returns {{ status: string }}
 */
function distributeIndieWeb() {
  return { status: 'sent', remoteId: 'auto-included-in-h-feed' };
}

/**
 * Stub AT Protocol distribution.
 * @returns {{ status: string, error?: string }}
 */
function distributeAtProtocol(post, profile) {
  if (!profile.at_did) {
    return { status: 'skipped', error: 'No AT Protocol DID configured' };
  }
  return {
    status: 'pending',
    error: 'AT Protocol PDS integration not yet implemented. Post recorded for future distribution.',
  };
}

/**
 * Run cross-protocol distribution for a post.
 * Records status in post_distribution table.
 * @returns {object[]} Array of distribution result records
 */
async function distributePost(post, profile) {
  const distributions = [];

  const protocols = [
    { name: 'activitypub', fn: () => distributeActivityPub(post, profile) },
    { name: 'nostr', fn: () => distributeNostr(post, profile) },
    { name: 'rss', fn: () => distributeRss() },
    { name: 'indieweb', fn: () => distributeIndieWeb() },
    { name: 'atproto', fn: () => distributeAtProtocol(post, profile) },
  ];

  for (const proto of protocols) {
    try {
      const result = await proto.fn();
      const distId = randomUUID();
      const distributedAt = result.status === 'sent' ? new Date() : null;

      await pool.query(
        `INSERT INTO social_federation.post_distribution
           (id, post_id, protocol, remote_id, status, distributed_at, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (post_id, protocol) DO UPDATE SET
           remote_id = EXCLUDED.remote_id,
           status = EXCLUDED.status,
           distributed_at = EXCLUDED.distributed_at,
           error = EXCLUDED.error`,
        [distId, post.id, proto.name, result.remoteId || null, result.status, distributedAt, result.error || null]
      );

      distributions.push({
        protocol: proto.name,
        status: result.status,
        remoteId: result.remoteId || null,
        error: result.error || null,
        event: result.event || undefined,
      });
    } catch (err) {
      console.error(`[posts] Distribution error for ${proto.name}:`, err.message);
      distributions.push({
        protocol: proto.name,
        status: 'failed',
        error: err.message,
      });
    }
  }

  return distributions;
}

/**
 * Send a Delete/Tombstone activity to all followers for ActivityPub.
 */
async function sendApDelete(post, profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;
  const noteId = `${BASE_URL}/ap/note/${post.id}`;

  const actorResult = await pool.query(
    `SELECT private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (actorResult.rowCount === 0 || !actorResult.rows[0].private_key_pem) {
    return;
  }

  const keys = actorResult.rows[0];

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${noteId}#delete`,
    type: 'Delete',
    actor: actorUri,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    object: {
      id: noteId,
      type: 'Tombstone',
      formerType: 'Note',
      deleted: new Date().toISOString(),
    },
  };

  const followersResult = await pool.query(
    `SELECT DISTINCT COALESCE(follower_shared_inbox, follower_inbox) AS inbox
     FROM social_graph.followers
     WHERE actor_uri = $1 AND status = 'accepted'`,
    [actorUri]
  );

  for (const row of followersResult.rows) {
    if (!row.inbox) continue;
    try {
      await signedFetch(row.inbox, deleteActivity, keys.private_key_pem, keys.key_id);
    } catch (err) {
      console.error(`[posts] AP delete delivery to ${row.inbox} failed:`, err.message);
    }
  }
}

// =============================================================================
// Route Handlers
// =============================================================================

export default function registerRoutes(routes) {
  // POST /api/post — Create a post + distribute
  routes.push({
    method: 'POST',
    pattern: '/api/post',
    handler: async (req, res) => {
      // Auth check — require session
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required. Log in at /login.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.content) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: content' });
      }

      // Identify the profile from session
      let profile;
      const result = await pool.query(
        `SELECT id, webid, omni_account_id, display_name, username, bio,
                avatar_url, banner_url, homepage_url, source_pod_uri, nostr_npub, at_did,
                matrix_id, xmtp_address, dsnp_user_id, zot_channel_hash
         FROM social_profiles.profile_index
         WHERE id = $1`,
        [session.profileId]
      );
      if (result.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: 'Profile not found for session' });
      }
      profile = result.rows[0];

      // Create the post
      const postId = randomUUID();
      const contentText = body.content;
      const contentHtml = body.contentHtml || null;
      const mediaUrls = body.mediaUrls || [];
      const visibility = body.visibility || 'public';
      const inReplyTo = body.inReplyTo || null;
      const groupId = body.group_id || body.groupId || null;

      // Validate group_id if provided
      if (groupId) {
        const groupCheck = await pool.query(
          'SELECT id FROM social_profiles.groups WHERE id = $1',
          [groupId]
        );
        if (groupCheck.rowCount === 0) {
          return json(res, 400, { error: 'Bad Request', message: `Group not found: ${groupId}` });
        }
      }

      const insertResult = await pool.query(
        `INSERT INTO social_profiles.posts (id, webid, content_text, content_html, media_urls, visibility, in_reply_to, group_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, webid, content_text, content_html, media_urls, visibility, in_reply_to, group_id, created_at, updated_at`,
        [postId, profile.webid, contentText, contentHtml, mediaUrls, visibility, inReplyTo, groupId]
      );

      const post = insertResult.rows[0];
      console.log(`[posts] Created post ${post.id} by @${profile.username}${groupId ? ` in group ${groupId}` : ''}`);

      // Distribute to all active protocols
      const distributions = await distributePost(post, profile);

      json(res, 201, {
        post: {
          id: post.id,
          webid: post.webid,
          handle: profile.username,
          content: post.content_text,
          contentHtml: post.content_html,
          mediaUrls: post.media_urls,
          visibility: post.visibility,
          inReplyTo: post.in_reply_to,
          groupId: post.group_id || null,
          createdAt: post.created_at,
          updatedAt: post.updated_at,
          url: `${BASE_URL}/@${profile.username}/post/${post.id}`,
        },
        distribution: distributions,
      });
    },
  });

  // GET /api/posts/:handle — List posts by handle (newest first)
  routes.push({
    method: 'GET',
    pattern: /^\/api\/posts\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
      const before = searchParams.get('before');

      let query = `SELECT id, webid, content_text, content_html, media_urls, visibility, in_reply_to, group_id, created_at, updated_at
                   FROM social_profiles.posts
                   WHERE webid = $1`;
      const params = [profile.webid];

      if (before) {
        query += ` AND created_at < $2`;
        params.push(before);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);

      const posts = result.rows.map(row => ({
        id: row.id,
        handle,
        content: row.content_text,
        contentHtml: row.content_html,
        mediaUrls: row.media_urls,
        visibility: row.visibility,
        inReplyTo: row.in_reply_to,
        groupId: row.group_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        url: `${BASE_URL}/@${handle}/post/${row.id}`,
      }));

      json(res, 200, {
        handle,
        posts,
        pagination: {
          limit,
          count: posts.length,
          before: posts.length > 0 ? posts[posts.length - 1].createdAt : null,
        },
      });
    },
  });

  // GET /api/post/:id — Single post with distribution status
  routes.push({
    method: 'GET',
    pattern: /^\/api\/post\/([a-f0-9-]+)$/,
    handler: async (req, res, matches) => {
      const postId = matches[1];

      const postResult = await pool.query(
        `SELECT p.id, p.webid, p.content_text, p.content_html, p.media_urls,
                p.visibility, p.in_reply_to, p.group_id, p.created_at, p.updated_at,
                pi.username AS handle, pi.display_name
         FROM social_profiles.posts p
         JOIN social_profiles.profile_index pi ON pi.webid = p.webid
         WHERE p.id = $1`,
        [postId]
      );

      if (postResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Post not found: ${postId}` });
      }

      const post = postResult.rows[0];

      // Get distribution status
      const distResult = await pool.query(
        `SELECT protocol, status, remote_id, distributed_at, error
         FROM social_federation.post_distribution
         WHERE post_id = $1
         ORDER BY protocol`,
        [postId]
      );

      json(res, 200, {
        post: {
          id: post.id,
          webid: post.webid,
          handle: post.handle,
          displayName: post.display_name,
          content: post.content_text,
          contentHtml: post.content_html,
          mediaUrls: post.media_urls,
          visibility: post.visibility,
          inReplyTo: post.in_reply_to,
          groupId: post.group_id || null,
          createdAt: post.created_at,
          updatedAt: post.updated_at,
          url: `${BASE_URL}/@${post.handle}/post/${post.id}`,
        },
        distribution: distResult.rows.map(d => ({
          protocol: d.protocol,
          status: d.status,
          remoteId: d.remote_id,
          distributedAt: d.distributed_at,
          error: d.error,
        })),
      });
    },
  });

  // DELETE /api/post/:id — Delete post + tombstone to protocols
  routes.push({
    method: 'DELETE',
    pattern: /^\/api\/post\/([a-f0-9-]+)$/,
    handler: async (req, res, matches) => {
      // Auth check — require session
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const postId = matches[1];

      // Look up the post + its profile
      const postResult = await pool.query(
        `SELECT p.id, p.webid, pi.username, pi.omni_account_id, pi.nostr_npub, pi.at_did
         FROM social_profiles.posts p
         JOIN social_profiles.profile_index pi ON pi.webid = p.webid
         WHERE p.id = $1`,
        [postId]
      );

      if (postResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Post not found: ${postId}` });
      }

      const post = postResult.rows[0];

      // Send AP Delete/Tombstone to followers
      try {
        await sendApDelete(post, post);
      } catch (err) {
        console.error(`[posts] Error sending AP delete for post ${postId}:`, err.message);
      }

      // Update distribution status to 'deleted'
      await pool.query(
        `UPDATE social_federation.post_distribution SET status = 'deleted' WHERE post_id = $1`,
        [postId]
      );

      // Delete the post
      await pool.query('DELETE FROM social_profiles.posts WHERE id = $1', [postId]);

      console.log(`[posts] Deleted post ${postId} by @${post.username}`);
      json(res, 200, { deleted: true, id: postId });
    },
  });
}

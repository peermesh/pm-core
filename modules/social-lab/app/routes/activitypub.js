// =============================================================================
// ActivityPub Routes
// =============================================================================
// GET  /.well-known/webfinger       — WebFinger discovery
// GET  /.well-known/nodeinfo        — NodeInfo discovery
// GET  /nodeinfo/2.0               — NodeInfo 2.0 document
// GET  /ap/actor/:handle            — Actor document
// HEAD /ap/actor/:handle            — Actor existence check
// POST /ap/inbox                    — Shared inbox
// GET  /ap/outbox/:handle           — Actor outbox
// GET  /ap/actor/:handle/followers  — Followers collection
// GET  /ap/actor/:handle/following  — Following collection
// POST /ap/actor/:handle/inbox      — Per-actor inbox

import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import { pool } from '../db.js';
import {
  json, jsonWithType, parseUrl, readJsonBody, extractId,
  lookupProfileByHandle, BASE_URL, SUBDOMAIN, DOMAIN, VERSION,
} from '../lib/helpers.js';
import { signedFetch, verifyHttpSignature } from '../lib/http-signatures.js';

/**
 * Get or create an RSA keypair for an actor.
 */
async function getOrCreateActorKeys(profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;

  // Look up by webid first (canonical match), then fall back to actor_uri.
  // The actor_uri fallback handles duplicate-username scenarios where a second
  // profile row exists but the ap_actors record belongs to the canonical one.
  let existing = await pool.query(
    `SELECT id, actor_uri, public_key_pem, private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (existing.rowCount === 0) {
    existing = await pool.query(
      `SELECT id, actor_uri, public_key_pem, private_key_pem, key_id
       FROM social_federation.ap_actors
       WHERE actor_uri = $1 AND status = 'active'`,
      [actorUri]
    );
  }

  if (existing.rowCount > 0 && existing.rows[0].public_key_pem && existing.rows[0].private_key_pem) {
    return existing.rows[0];
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = `${actorUri}#main-key`;
  const id = randomUUID();
  const publicKeyHash = createHash('sha256').update(publicKey).digest('hex');

  if (existing.rowCount > 0) {
    await pool.query(
      `UPDATE social_federation.ap_actors
       SET public_key_pem = $1, private_key_pem = $2, key_id = $3, updated_at = NOW()
       WHERE id = $4`,
      [publicKey, privateKey, keyId, existing.rows[0].id]
    );
    return { ...existing.rows[0], public_key_pem: publicKey, private_key_pem: privateKey, key_id: keyId };
  }

  const inboxUri = `${BASE_URL}/ap/inbox`;
  const outboxUri = `${BASE_URL}/ap/outbox/${handle}`;

  await pool.query(
    `INSERT INTO social_federation.ap_actors
       (id, webid, actor_uri, inbox_uri, outbox_uri, public_key_pem, private_key_pem, key_id, protocol, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activitypub', 'active')
     ON CONFLICT (actor_uri) DO UPDATE
       SET public_key_pem = EXCLUDED.public_key_pem,
           private_key_pem = EXCLUDED.private_key_pem,
           key_id = EXCLUDED.key_id,
           updated_at = NOW()`,
    [id, profile.webid, actorUri, inboxUri, outboxUri, publicKey, privateKey, keyId]
  );

  await pool.query(
    `UPDATE social_profiles.profile_index SET ap_actor_uri = $1, updated_at = NOW() WHERE id = $2`,
    [actorUri, profile.id]
  );

  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
     VALUES ($1, $2, 'activitypub', 'rsa2048', $3, 'signing', TRUE)`,
    [randomUUID(), profile.omni_account_id, publicKeyHash]
  );

  return { id, actor_uri: actorUri, public_key_pem: publicKey, private_key_pem: privateKey, key_id: keyId };
}

/**
 * Handle an incoming Follow activity: store follower, send signed Accept.
 */
async function handleFollowActivity(activity, remoteActor) {
  const followerUri = activity.actor;
  const objectUri = typeof activity.object === 'string' ? activity.object : activity.object?.id;

  if (!followerUri || !objectUri) {
    console.error('[federation] Follow missing actor or object');
    return;
  }

  const handleMatch = objectUri.match(/\/ap\/actor\/([^/]+)$/);
  if (!handleMatch) {
    console.error('[federation] Follow object does not match our actor URI pattern:', objectUri);
    return;
  }
  const handle = handleMatch[1];

  const profile = await lookupProfileByHandle(pool, handle);
  if (!profile) {
    console.error('[federation] Follow target handle not found:', handle);
    return;
  }
  const keys = await getOrCreateActorKeys(profile);

  const followerInbox = remoteActor?.endpoints?.sharedInbox || remoteActor?.inbox || null;
  const followerSharedInbox = remoteActor?.endpoints?.sharedInbox || null;

  const followerId = randomUUID();
  await pool.query(
    `INSERT INTO social_graph.followers (id, actor_uri, follower_uri, follower_inbox, follower_shared_inbox, follow_activity_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'accepted')
     ON CONFLICT (actor_uri, follower_uri) DO UPDATE SET
       follow_activity_id = EXCLUDED.follow_activity_id,
       follower_inbox = EXCLUDED.follower_inbox,
       follower_shared_inbox = EXCLUDED.follower_shared_inbox,
       status = 'accepted'`,
    [followerId, objectUri, followerUri, followerInbox, followerSharedInbox, activity.id || null]
  );

  console.log(`[federation] Stored follower: ${followerUri} => ${objectUri}`);

  const acceptInbox = remoteActor?.inbox;
  if (!acceptInbox) {
    console.error('[federation] Cannot send Accept: no inbox for', followerUri);
    return;
  }

  const localActorUri = `${BASE_URL}/ap/actor/${handle}`;
  const acceptActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${localActorUri}#accept-${followerId}`,
    type: 'Accept',
    actor: localActorUri,
    object: activity,
  };

  try {
    const result = await signedFetch(acceptInbox, acceptActivity, keys.private_key_pem, keys.key_id);
    console.log(`[federation] Accept sent to ${acceptInbox}: status=${result.status}`);
  } catch (err) {
    console.error(`[federation] Failed to send Accept to ${acceptInbox}:`, err.message);
  }
}

/**
 * Handle an incoming Create activity (typically Create(Note)).
 * Stores the post content in the timeline table for all local followers.
 */
async function handleCreateActivity(activity, remoteActor) {
  const object = activity.object;
  if (!object) {
    console.log('[federation] Create activity has no object, skipping');
    return;
  }

  // We handle Note and Article objects
  const objectType = typeof object === 'string' ? null : object.type;
  if (!objectType || !['Note', 'Article', 'Page'].includes(objectType)) {
    console.log(`[federation] Create object type '${objectType}' not handled, skipping`);
    return;
  }

  const actorUri = activity.actor || (remoteActor && remoteActor.id);
  if (!actorUri) {
    console.error('[federation] Create activity missing actor URI');
    return;
  }

  // Extract content from the Note/Article
  const contentHtml = object.content || null;
  const contentText = object.contentMap?.en || object.summary || null;
  const sourcePostId = object.id || null;
  const inReplyTo = typeof object.inReplyTo === 'string' ? object.inReplyTo : (object.inReplyTo?.id || null);
  const publishedAt = object.published || null;

  // Extract media attachments
  const mediaUrls = [];
  if (Array.isArray(object.attachment)) {
    for (const att of object.attachment) {
      if (att.url && (att.mediaType || '').startsWith('image/')) {
        mediaUrls.push(att.url);
      } else if (att.url) {
        mediaUrls.push(att.url);
      }
    }
  }

  // Resolve author info from the remote actor or the activity
  const authorName = remoteActor?.name || remoteActor?.preferredUsername || object.attributedTo || actorUri;
  const authorHandle = remoteActor?.preferredUsername || actorUri;
  const authorAvatarUrl = remoteActor?.icon?.url || null;

  // Find all local profiles that are followed by this remote actor
  // (i.e., local actors whose followers include the sender)
  const followersResult = await pool.query(
    `SELECT DISTINCT f.actor_uri
     FROM social_graph.followers f
     WHERE f.follower_uri = $1 AND f.status = 'accepted'`,
    [actorUri]
  );

  if (followersResult.rowCount === 0) {
    console.log(`[federation] Create from ${actorUri}: no local followers, skipping timeline insert`);
    return;
  }

  // For each local actor that is followed by the sender, insert into their timeline
  for (const row of followersResult.rows) {
    // Extract the local handle from the actor_uri
    const handleMatch = row.actor_uri.match(/\/ap\/actor\/([^/]+)$/);
    if (!handleMatch) continue;

    const localHandle = handleMatch[1];
    const profile = await lookupProfileByHandle(pool, localHandle);
    if (!profile) continue;

    try {
      await pool.query(
        `INSERT INTO social_profiles.timeline
           (owner_webid, source_protocol, source_actor_uri, source_post_id,
            content_text, content_html, media_urls,
            author_name, author_handle, author_avatar_url,
            in_reply_to, published_at, raw_data)
         VALUES ($1, 'activitypub', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT DO NOTHING`,
        [
          profile.webid, actorUri, sourcePostId,
          contentText, contentHtml, mediaUrls,
          authorName, authorHandle, authorAvatarUrl,
          inReplyTo, publishedAt, JSON.stringify(activity),
        ]
      );
    } catch (err) {
      console.error(`[federation] Error inserting timeline entry for ${localHandle}:`, err.message);
    }
  }

  console.log(`[federation] Create(${objectType}) from ${actorUri}: delivered to ${followersResult.rowCount} local timeline(s)`);
}

/**
 * Handle an incoming Announce activity (boost/reblog).
 * Stores the boosted content reference in the timeline.
 */
async function handleAnnounceActivity(activity, remoteActor) {
  const actorUri = activity.actor || (remoteActor && remoteActor.id);
  if (!actorUri) {
    console.error('[federation] Announce activity missing actor URI');
    return;
  }

  const boostedUri = typeof activity.object === 'string' ? activity.object : activity.object?.id;
  if (!boostedUri) {
    console.log('[federation] Announce activity has no object URI, skipping');
    return;
  }

  const authorName = remoteActor?.name || remoteActor?.preferredUsername || actorUri;
  const authorHandle = remoteActor?.preferredUsername || actorUri;
  const authorAvatarUrl = remoteActor?.icon?.url || null;
  const publishedAt = activity.published || null;

  // Find local followers of the announcer
  const followersResult = await pool.query(
    `SELECT DISTINCT f.actor_uri
     FROM social_graph.followers f
     WHERE f.follower_uri = $1 AND f.status = 'accepted'`,
    [actorUri]
  );

  if (followersResult.rowCount === 0) return;

  for (const row of followersResult.rows) {
    const handleMatch = row.actor_uri.match(/\/ap\/actor\/([^/]+)$/);
    if (!handleMatch) continue;

    const localHandle = handleMatch[1];
    const profile = await lookupProfileByHandle(pool, localHandle);
    if (!profile) continue;

    try {
      await pool.query(
        `INSERT INTO social_profiles.timeline
           (owner_webid, source_protocol, source_actor_uri, source_post_id,
            content_text, content_html, media_urls,
            author_name, author_handle, author_avatar_url,
            published_at, raw_data)
         VALUES ($1, 'activitypub', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          profile.webid, actorUri, boostedUri,
          `Boosted: ${boostedUri}`, null, '{}',
          authorName, authorHandle, authorAvatarUrl,
          publishedAt, JSON.stringify(activity),
        ]
      );
    } catch (err) {
      console.error(`[federation] Error inserting announce for ${localHandle}:`, err.message);
    }
  }

  console.log(`[federation] Announce from ${actorUri}: delivered to ${followersResult.rowCount} local timeline(s)`);
}

/**
 * Handle an incoming Delete activity.
 * Removes matching posts from the timeline.
 */
async function handleDeleteActivity(activity) {
  const deletedUri = typeof activity.object === 'string' ? activity.object : activity.object?.id;
  if (!deletedUri) {
    console.log('[federation] Delete activity has no object URI, skipping');
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM social_profiles.timeline
       WHERE source_post_id = $1 AND source_protocol = 'activitypub'`,
      [deletedUri]
    );
    console.log(`[federation] Delete ${deletedUri}: removed ${result.rowCount} timeline entries`);
  } catch (err) {
    console.error('[federation] Error processing Delete:', err.message);
  }
}

/**
 * Handle an incoming Update activity.
 * Updates matching posts in the timeline.
 */
async function handleUpdateActivity(activity) {
  const object = activity.object;
  if (!object || typeof object === 'string') {
    console.log('[federation] Update activity has no inline object, skipping');
    return;
  }

  const postId = object.id;
  if (!postId) {
    console.log('[federation] Update object has no id, skipping');
    return;
  }

  const contentHtml = object.content || null;
  const contentText = object.contentMap?.en || object.summary || null;

  const mediaUrls = [];
  if (Array.isArray(object.attachment)) {
    for (const att of object.attachment) {
      if (att.url) mediaUrls.push(att.url);
    }
  }

  try {
    const result = await pool.query(
      `UPDATE social_profiles.timeline
       SET content_text = COALESCE($1, content_text),
           content_html = COALESCE($2, content_html),
           media_urls = $3,
           raw_data = $4
       WHERE source_post_id = $5 AND source_protocol = 'activitypub'`,
      [contentText, contentHtml, mediaUrls, JSON.stringify(activity), postId]
    );
    console.log(`[federation] Update ${postId}: updated ${result.rowCount} timeline entries`);
  } catch (err) {
    console.error('[federation] Error processing Update:', err.message);
  }
}

/**
 * Handle an incoming Undo activity (typically Undo(Follow)).
 */
async function handleUndoActivity(activity) {
  const innerObject = activity.object;
  if (!innerObject) return;

  const innerType = typeof innerObject === 'string' ? null : innerObject.type;
  if (innerType === 'Follow') {
    const followerUri = innerObject.actor || activity.actor;
    const objectUri = typeof innerObject.object === 'string' ? innerObject.object : innerObject.object?.id;
    if (followerUri && objectUri) {
      const result = await pool.query(
        'DELETE FROM social_graph.followers WHERE actor_uri = $1 AND follower_uri = $2',
        [objectUri, followerUri]
      );
      console.log(`[federation] Undo Follow: ${followerUri} unfollowed ${objectUri}, deleted=${result.rowCount}`);
    }
  }
}

/**
 * POST /ap/inbox — Shared inbox handler.
 */
async function handleInboxPost(req, res) {
  let body, rawBody;
  try {
    ({ parsed: body, raw: rawBody } = await readJsonBody(req));
  } catch (err) {
    return json(res, 400, { error: 'Bad Request', message: err.message });
  }

  if (!body) {
    return json(res, 400, { error: 'Bad Request', message: 'Empty body' });
  }

  console.log('[federation] Incoming activity:', JSON.stringify(body).substring(0, 500));

  const { pathname } = parseUrl(req);
  const sigResult = await verifyHttpSignature({
    method: req.method,
    path: pathname,
    headers: req.headers,
    rawBody,
  });

  if (!sigResult.valid) {
    console.warn('[federation] Signature verification failed:', sigResult.error);
  } else {
    console.log('[federation] Signature verified for actor:', sigResult.actorUrl);
  }

  const activityType = body.type;
  try {
    switch (activityType) {
      case 'Follow':
        await handleFollowActivity(body, sigResult.remoteActor);
        break;
      case 'Undo':
        await handleUndoActivity(body);
        break;
      case 'Create':
        await handleCreateActivity(body, sigResult.remoteActor);
        break;
      case 'Announce':
        await handleAnnounceActivity(body, sigResult.remoteActor);
        break;
      case 'Accept':
        console.log('[federation] Received Accept from:', body.actor);
        break;
      case 'Reject':
        console.log('[federation] Received Reject from:', body.actor);
        break;
      case 'Delete':
        await handleDeleteActivity(body);
        break;
      case 'Update':
        await handleUpdateActivity(body);
        break;
      default:
        console.log(`[federation] Unhandled activity type: ${activityType}`);
    }
  } catch (err) {
    console.error(`[federation] Error handling ${activityType}:`, err);
  }

  json(res, 202, { status: 'accepted' });
}

export default function registerRoutes(routes) {
  // GET /.well-known/webfinger
  routes.push({
    method: 'GET',
    pattern: '/.well-known/webfinger',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const resource = searchParams.get('resource');

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Accept',
      };

      if (!resource) {
        return jsonWithType(res, 400, 'application/json', {
          error: 'Bad Request',
          message: 'Missing required "resource" query parameter',
        }, corsHeaders);
      }

      const acctMatch = resource.match(/^acct:([^@]+)@(.+)$/);
      if (!acctMatch) {
        return jsonWithType(res, 400, 'application/json', {
          error: 'Bad Request',
          message: 'Invalid resource format. Expected acct:handle@domain',
        }, corsHeaders);
      }

      const [, handle, resourceDomain] = acctMatch;
      const ourDomain = `${SUBDOMAIN}.${DOMAIN}`;
      if (resourceDomain !== ourDomain) {
        return jsonWithType(res, 404, 'application/json', {
          error: 'Not Found',
          message: `Unknown domain: ${resourceDomain}`,
        }, corsHeaders);
      }

      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return jsonWithType(res, 404, 'application/json', {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        }, corsHeaders);
      }

      const actorUri = `${BASE_URL}/ap/actor/${handle}`;
      const profilePageUri = `${BASE_URL}/@${handle}`;

      const webfingerDoc = {
        subject: `acct:${handle}@${ourDomain}`,
        aliases: [actorUri],
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: actorUri,
          },
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: profilePageUri,
          },
        ],
      };

      jsonWithType(res, 200, 'application/jrd+json; charset=utf-8', webfingerDoc, {
        ...corsHeaders,
        'Cache-Control': 'max-age=259200, public',
      });
    },
  });

  // GET /.well-known/nodeinfo — NodeInfo discovery
  routes.push({
    method: 'GET',
    pattern: '/.well-known/nodeinfo',
    handler: async (req, res) => {
      const nodeInfoDoc = {
        links: [{
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
          href: `${BASE_URL}/nodeinfo/2.0`,
        }],
      };
      json(res, 200, nodeInfoDoc);
    },
  });

  // GET /nodeinfo/2.0 — NodeInfo 2.0 document
  routes.push({
    method: 'GET',
    pattern: '/nodeinfo/2.0',
    handler: async (req, res) => {
      let userCount = 0;
      let postCount = 0;
      try {
        const result = await pool.query(
          'SELECT COUNT(*)::int AS cnt FROM social_profiles.profile_index'
        );
        userCount = result.rows[0]?.cnt || 0;
      } catch (err) {
        console.error('[nodeinfo] Failed to query user count:', err.message);
      }
      try {
        const result = await pool.query(
          'SELECT COUNT(*)::int AS cnt FROM social_profiles.posts'
        );
        postCount = result.rows[0]?.cnt || 0;
      } catch {
        // posts table may not exist yet
      }

      const nodeInfoDoc = {
        version: '2.0',
        software: {
          name: 'peermesh-social-lab',
          version: VERSION,
        },
        protocols: ['activitypub'],
        usage: {
          users: { total: userCount },
          localPosts: postCount,
        },
        openRegistrations: true,
      };

      jsonWithType(res, 200, 'application/json; charset=utf-8', nodeInfoDoc, {
        'Cache-Control': 'max-age=1800, public',
      });
    },
  });

  // GET /ap/actor/:handle/followers
  routes.push({
    method: 'GET',
    pattern: /^\/ap\/actor\/([^/]+)\/followers$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No actor found for handle: ${handle}` });
      }

      const actorUri = `${BASE_URL}/ap/actor/${handle}`;
      const result = await pool.query(
        `SELECT follower_uri FROM social_graph.followers WHERE actor_uri = $1 AND status = 'accepted' ORDER BY created_at DESC`,
        [actorUri]
      );

      const followersDoc = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUri}/followers`,
        type: 'OrderedCollection',
        totalItems: result.rowCount,
        orderedItems: result.rows.map(r => r.follower_uri),
      };

      jsonWithType(res, 200, 'application/activity+json; charset=utf-8', followersDoc);
    },
  });

  // GET /ap/actor/:handle/following
  routes.push({
    method: 'GET',
    pattern: /^\/ap\/actor\/([^/]+)\/following$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No actor found for handle: ${handle}` });
      }

      const actorUri = `${BASE_URL}/ap/actor/${handle}`;

      const followingDoc = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorUri}/following`,
        type: 'OrderedCollection',
        totalItems: 0,
        orderedItems: [],
      };

      jsonWithType(res, 200, 'application/activity+json; charset=utf-8', followingDoc);
    },
  });

  // POST /ap/actor/:handle/inbox — Per-actor inbox
  routes.push({
    method: 'POST',
    pattern: /^\/ap\/actor\/([^/]+)\/inbox$/,
    handler: handleInboxPost,
  });

  // GET /ap/actor/:handle — Actor document
  routes.push({
    method: 'GET',
    pattern: /^\/ap\/actor\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No actor found for handle: ${handle}` });
      }

      const keys = await getOrCreateActorKeys(profile);
      const actorUri = `${BASE_URL}/ap/actor/${handle}`;

      const actorDoc = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1',
          {
            'toot': 'http://joinmastodon.org/ns#',
            'discoverable': 'toot:discoverable',
            'indexable': 'toot:indexable',
            'suspended': 'toot:suspended',
            'memorial': 'toot:memorial',
            'featured': { '@id': 'toot:featured', '@type': '@id' },
            'featuredTags': { '@id': 'toot:featuredTags', '@type': '@id' },
            'alsoKnownAs': { '@id': 'as:alsoKnownAs', '@type': '@id' },
            'movedTo': { '@id': 'as:movedTo', '@type': '@id' },
            'schema': 'http://schema.org#',
            'PropertyValue': 'schema:PropertyValue',
            'value': 'schema:value',
            'focalPoint': { '@container': '@list', '@id': 'toot:focalPoint' },
            'manuallyApprovesFollowers': 'as:manuallyApprovesFollowers',
          },
        ],
        id: actorUri,
        type: 'Person',
        preferredUsername: handle,
        name: profile.display_name || handle,
        summary: profile.bio || '',
        url: `${BASE_URL}/@${handle}`,
        inbox: `${BASE_URL}/ap/inbox`,
        outbox: `${BASE_URL}/ap/outbox/${handle}`,
        followers: `${BASE_URL}/ap/actor/${handle}/followers`,
        following: `${BASE_URL}/ap/actor/${handle}/following`,
        published: '2026-03-21T00:00:00Z',
        manuallyApprovesFollowers: false,
        discoverable: true,
        indexable: true,
        endpoints: {
          sharedInbox: `${BASE_URL}/ap/inbox`,
        },
        publicKey: {
          id: keys.key_id,
          owner: actorUri,
          publicKeyPem: keys.public_key_pem,
        },
      };

      if (profile.avatar_url) {
        actorDoc.icon = {
          type: 'Image',
          url: profile.avatar_url,
        };
      }

      jsonWithType(res, 200, 'application/activity+json; charset=utf-8', actorDoc, {
        'Cache-Control': 'max-age=259200, public',
      });
    },
  });

  // HEAD /ap/actor/:handle — Actor existence check (HTTP compliance)
  routes.push({
    method: 'HEAD',
    pattern: /^\/ap\/actor\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'application/activity+json; charset=utf-8',
        'Cache-Control': 'max-age=259200, public',
      });
      res.end();
    },
  });

  // POST /ap/inbox — Shared inbox
  routes.push({
    method: 'POST',
    pattern: '/ap/inbox',
    handler: handleInboxPost,
  });

  // GET /ap/inbox — Method not allowed
  routes.push({
    method: 'GET',
    pattern: '/ap/inbox',
    handler: async (req, res) => {
      res.writeHead(405, { 'Allow': 'POST' });
      res.end(JSON.stringify({ error: 'Method Not Allowed', message: 'POST only' }));
    },
  });

  // GET /ap/outbox/:handle — Actor outbox (posts as Create(Note) activities)
  routes.push({
    method: 'GET',
    pattern: /^\/ap\/outbox\/([^/]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No actor found for handle: ${handle}` });
      }

      const actorUri = `${BASE_URL}/ap/actor/${handle}`;

      // Fetch posts for this profile
      let posts = [];
      try {
        const postsResult = await pool.query(
          `SELECT id, content_text, content_html, media_urls, in_reply_to, created_at
           FROM social_profiles.posts
           WHERE webid = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [profile.webid]
        );
        posts = postsResult.rows;
      } catch {
        // posts table may not exist yet
      }

      const orderedItems = posts.map(post => {
        const noteId = `${BASE_URL}/ap/note/${post.id}`;
        const noteObject = {
          id: noteId,
          type: 'Note',
          attributedTo: actorUri,
          content: post.content_html || `<p>${post.content_text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
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

        return {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${noteId}/activity`,
          type: 'Create',
          actor: actorUri,
          published: new Date(post.created_at).toISOString(),
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [`${actorUri}/followers`],
          object: noteObject,
        };
      });

      const outboxDoc = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${BASE_URL}/ap/outbox/${handle}`,
        type: 'OrderedCollection',
        totalItems: orderedItems.length,
        orderedItems,
      };

      jsonWithType(res, 200, 'application/activity+json; charset=utf-8', outboxDoc);
    },
  });
}

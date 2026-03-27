// =============================================================================
// Timeline Routes — Merged Feed API
// =============================================================================
// GET /api/timeline/:handle              — Merged timeline for a user
// GET /api/timeline/:handle/protocol/:p  — Filter timeline by protocol
//
// Returns incoming posts from followed accounts across all protocols,
// unified into one chronological feed.

import { pool } from '../db.js';
import {
  json, parseUrl, lookupProfileByHandle, BASE_URL,
} from '../lib/helpers.js';

/**
 * Query timeline items for a given webid with optional protocol filter.
 * Supports cursor-based pagination via ?limit=N&before=ISO-timestamp.
 */
async function queryTimeline(webid, { limit = 20, before = null, protocol = null }) {
  // Cap limit to prevent abuse
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);

  const conditions = ['t.owner_webid = $1'];
  const params = [webid];
  let paramIdx = 2;

  if (before) {
    conditions.push(`t.received_at < $${paramIdx}`);
    params.push(before);
    paramIdx++;
  }

  if (protocol) {
    conditions.push(`t.source_protocol = $${paramIdx}`);
    params.push(protocol);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT t.id, t.source_protocol, t.source_actor_uri, t.source_post_id,
            t.content_text, t.content_html, t.media_urls,
            t.author_name, t.author_handle, t.author_avatar_url,
            t.in_reply_to, t.received_at, t.published_at
     FROM social_profiles.timeline t
     WHERE ${whereClause}
     ORDER BY t.received_at DESC
     LIMIT $${paramIdx}`,
    [...params, safeLimit]
  );

  return result.rows.map(row => ({
    id: row.id,
    source_protocol: row.source_protocol,
    source_actor_uri: row.source_actor_uri,
    source_post_id: row.source_post_id,
    content_text: row.content_text,
    content_html: row.content_html,
    media_urls: row.media_urls || [],
    author: {
      name: row.author_name,
      handle: row.author_handle,
      avatar_url: row.author_avatar_url,
    },
    in_reply_to: row.in_reply_to,
    received_at: row.received_at,
    published_at: row.published_at,
  }));
}

export default function registerRoutes(routes) {
  // GET /api/timeline/:handle — Merged timeline
  routes.push({
    method: 'GET',
    pattern: /^\/api\/timeline\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const { searchParams } = parseUrl(req);
      const limit = searchParams.get('limit') || 20;
      const before = searchParams.get('before') || null;

      try {
        const items = await queryTimeline(profile.webid, { limit, before });

        // Build next cursor if we got a full page
        let next_before = null;
        if (items.length > 0) {
          next_before = items[items.length - 1].received_at;
        }

        json(res, 200, {
          handle,
          count: items.length,
          next_before,
          items,
        });
      } catch (err) {
        console.error('[timeline] Error querying timeline:', err.message);
        json(res, 500, { error: 'Internal Server Error', message: 'Failed to load timeline' });
      }
    },
  });

  // GET /api/timeline/:handle/protocol/:protocol — Filter by protocol
  routes.push({
    method: 'GET',
    pattern: /^\/api\/timeline\/([a-zA-Z0-9_.-]+)\/protocol\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const protocol = matches[2];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const { searchParams } = parseUrl(req);
      const limit = searchParams.get('limit') || 20;
      const before = searchParams.get('before') || null;

      try {
        const items = await queryTimeline(profile.webid, { limit, before, protocol });

        let next_before = null;
        if (items.length > 0) {
          next_before = items[items.length - 1].received_at;
        }

        json(res, 200, {
          handle,
          protocol,
          count: items.length,
          next_before,
          items,
        });
      } catch (err) {
        console.error('[timeline] Error querying timeline:', err.message);
        json(res, 500, { error: 'Internal Server Error', message: 'Failed to load timeline' });
      }
    },
  });
}

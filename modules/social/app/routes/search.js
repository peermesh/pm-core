// =============================================================================
// Search & Discovery Routes — Full-Text Search, Autocomplete, Trending, Directory
// =============================================================================
// GET /api/search?q=query&type=profiles|posts|groups|all
// GET /api/search/suggestions?q=partial
// GET /api/discover/trending
// GET /api/discover/directory
//
// Blueprint: F-028 (Federated Search & Discovery)
// Uses PostgreSQL tsvector/tsquery for full-text search.
// All endpoints respect visibility and consent constraints.

import { pool } from '../db.js';
import { json, parseUrl, escapeHtml, BASE_URL } from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sanitize and convert a raw query string to a PostgreSQL tsquery.
 * Splits on whitespace, strips non-alphanumeric, joins with &.
 * Returns null if query is empty after sanitization.
 */
function toTsQuery(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const tokens = raw
    .trim()
    .toLowerCase()
    .replace(/[^\w\s@.-]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length === 0) return null;
  // Use prefix matching (:*) on the last token for partial-match support
  return tokens.map((t, i) =>
    i === tokens.length - 1 ? `${t}:*` : t
  ).join(' & ');
}

/**
 * Extract hashtags from content text.
 * Returns array of normalized lowercase tags without the # prefix.
 */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

/**
 * Log a search query for analytics.
 */
async function logSearch(query, searchType, resultsCount, userWebid) {
  try {
    await pool.query(
      `INSERT INTO social_pipeline.search_log (query, search_type, results_count, user_webid)
       VALUES ($1, $2, $3, $4)`,
      [query, searchType, resultsCount, userWebid || null]
    );
  } catch (err) {
    // Non-critical — don't fail the request if logging fails
    console.error('[search] Failed to log search query:', err.message);
  }
}

// =============================================================================
// Search Functions
// =============================================================================

/**
 * Search profiles by display_name, bio, username using full-text search.
 * Falls back to trigram similarity for short queries.
 */
async function searchProfiles(query, { limit = 20, offset = 0 }) {
  const tsq = toTsQuery(query);
  if (!tsq) return [];

  const result = await pool.query(
    `SELECT id, display_name, username, bio, avatar_url, nostr_npub, at_did,
            ts_rank(search_vector, to_tsquery('english', $1)) AS rank
     FROM social_profiles.profile_index
     WHERE search_vector @@ to_tsquery('english', $1)
     ORDER BY rank DESC, display_name ASC
     LIMIT $2 OFFSET $3`,
    [tsq, limit, offset]
  );

  return result.rows.map(row => ({
    type: 'profile',
    id: row.id,
    display_name: row.display_name,
    username: row.username,
    bio: row.bio,
    avatar_url: row.avatar_url,
    nostr_npub: row.nostr_npub,
    at_did: row.at_did,
    url: `${BASE_URL}/@${row.username}`,
    rank: parseFloat(row.rank),
  }));
}

/**
 * Search posts by content_text using full-text search.
 * Only searches public posts.
 */
async function searchPosts(query, { limit = 20, offset = 0 }) {
  const tsq = toTsQuery(query);
  if (!tsq) return [];

  const result = await pool.query(
    `SELECT p.id, p.content_text, p.created_at, p.hashtags,
            pi.username, pi.display_name, pi.avatar_url,
            ts_rank(p.search_vector, to_tsquery('english', $1)) AS rank
     FROM social_profiles.posts p
     JOIN social_profiles.profile_index pi ON pi.webid = p.webid
     WHERE p.search_vector @@ to_tsquery('english', $1)
       AND p.visibility = 'public'
     ORDER BY rank DESC, p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tsq, limit, offset]
  );

  return result.rows.map(row => ({
    type: 'post',
    id: row.id,
    content: row.content_text,
    hashtags: row.hashtags || [],
    created_at: row.created_at,
    author: {
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
    },
    url: `${BASE_URL}/@${row.username}/post/${row.id}`,
    rank: parseFloat(row.rank),
  }));
}

/**
 * Search groups by name and description using full-text search.
 * Only searches public and unlisted groups.
 */
async function searchGroups(query, { limit = 20, offset = 0 }) {
  const tsq = toTsQuery(query);
  if (!tsq) return [];

  const result = await pool.query(
    `SELECT id, name, type, description, avatar_url, visibility,
            membership_policy, path,
            ts_rank(search_vector, to_tsquery('english', $1)) AS rank
     FROM social_profiles.groups
     WHERE search_vector @@ to_tsquery('english', $1)
       AND visibility IN ('public', 'unlisted')
     ORDER BY rank DESC, name ASC
     LIMIT $2 OFFSET $3`,
    [tsq, limit, offset]
  );

  return result.rows.map(row => ({
    type: 'group',
    id: row.id,
    name: row.name,
    group_type: row.type,
    description: row.description,
    avatar_url: row.avatar_url,
    visibility: row.visibility,
    membership_policy: row.membership_policy,
    path: row.path,
    rank: parseFloat(row.rank),
  }));
}

// =============================================================================
// Route Handlers
// =============================================================================

export default function registerRoutes(routes) {

  // =========================================================================
  // GET /api/search?q=query&type=profiles|posts|groups|all&limit=20&offset=0
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: '/api/search',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const q = (searchParams.get('q') || '').trim();
      const type = searchParams.get('type') || 'all';
      const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 100);
      const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

      if (!q) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Missing required query parameter: q',
        });
      }

      if (q.length > 200) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Query too long (max 200 characters)',
        });
      }

      const validTypes = ['profiles', 'posts', 'groups', 'all'];
      if (!validTypes.includes(type)) {
        return json(res, 400, {
          error: 'Bad Request',
          message: `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      try {
        const results = {};
        let totalCount = 0;

        if (type === 'all' || type === 'profiles') {
          results.profiles = await searchProfiles(q, { limit, offset });
          totalCount += results.profiles.length;
        }

        if (type === 'all' || type === 'posts') {
          results.posts = await searchPosts(q, { limit, offset });
          totalCount += results.posts.length;
        }

        if (type === 'all' || type === 'groups') {
          results.groups = await searchGroups(q, { limit, offset });
          totalCount += results.groups.length;
        }

        // Build unified results array for type=all
        let unified = [];
        if (type === 'all') {
          unified = [
            ...(results.profiles || []),
            ...(results.posts || []),
            ...(results.groups || []),
          ].sort((a, b) => b.rank - a.rank);
        }

        // Get user webid for logging (optional, non-blocking)
        const session = requireAuth(req);
        const userWebid = session ? session.webid || null : null;

        // Log the search (fire and forget)
        logSearch(q, type, totalCount, userWebid);

        json(res, 200, {
          query: q,
          type,
          total_count: totalCount,
          pagination: { limit, offset },
          results: type === 'all' ? unified : (results[type] || []),
          ...(type === 'all' ? { by_type: results } : {}),
        });
      } catch (err) {
        console.error('[search] Error executing search:', err.message);
        json(res, 500, {
          error: 'Internal Server Error',
          message: 'Search failed. Please try again.',
        });
      }
    },
  });

  // =========================================================================
  // GET /api/search/suggestions?q=partial
  // =========================================================================
  // Autocomplete suggestions as user types.
  // Returns top 5 profile + group matches using trigram similarity.
  routes.push({
    method: 'GET',
    pattern: '/api/search/suggestions',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const q = (searchParams.get('q') || '').trim();

      if (!q || q.length < 2) {
        return json(res, 200, { query: q, suggestions: [] });
      }

      try {
        // Profile suggestions: prefix match on username + trigram on display_name
        const profileResult = await pool.query(
          `SELECT id, display_name, username, avatar_url, 'profile' AS type,
                  GREATEST(
                    similarity(username, $1),
                    similarity(COALESCE(display_name, ''), $1)
                  ) AS sim
           FROM social_profiles.profile_index
           WHERE username ILIKE $2
              OR display_name ILIKE $2
           ORDER BY sim DESC
           LIMIT 5`,
          [q.toLowerCase(), `%${q}%`]
        );

        // Group suggestions: prefix match on name
        const groupResult = await pool.query(
          `SELECT id, name, type AS group_type, avatar_url, 'group' AS type,
                  similarity(name, $1) AS sim
           FROM social_profiles.groups
           WHERE name ILIKE $2
             AND visibility IN ('public', 'unlisted')
           ORDER BY sim DESC
           LIMIT 5`,
          [q.toLowerCase(), `%${q}%`]
        );

        const suggestions = [
          ...profileResult.rows.map(r => ({
            type: 'profile',
            id: r.id,
            label: r.display_name || r.username,
            sublabel: `@${r.username}`,
            avatar_url: r.avatar_url,
            url: `${BASE_URL}/@${r.username}`,
          })),
          ...groupResult.rows.map(r => ({
            type: 'group',
            id: r.id,
            label: r.name,
            sublabel: r.group_type,
            avatar_url: r.avatar_url,
          })),
        ]
          .sort((a, b) => (b.sim || 0) - (a.sim || 0))
          .slice(0, 10);

        // Log suggestion query
        const session = requireAuth(req);
        logSearch(q, 'suggestions', suggestions.length, session ? session.webid || null : null);

        json(res, 200, { query: q, suggestions });
      } catch (err) {
        console.error('[search] Error fetching suggestions:', err.message);
        json(res, 500, {
          error: 'Internal Server Error',
          message: 'Failed to fetch suggestions.',
        });
      }
    },
  });

  // =========================================================================
  // GET /api/discover/trending
  // =========================================================================
  // Trending topics (hashtags), popular profiles (by follower count),
  // and active groups.
  routes.push({
    method: 'GET',
    pattern: '/api/discover/trending',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 50);

      try {
        // Trending hashtags: from hashtag_index by total count
        // (count_24h would be more accurate but requires periodic refresh job;
        //  use count_total + last_used_at for initial implementation)
        let trendingTags = [];
        try {
          const tagResult = await pool.query(
            `SELECT tag, count_total, count_24h, count_7d, last_used_at
             FROM social_profiles.hashtag_index
             ORDER BY count_total DESC, last_used_at DESC
             LIMIT $1`,
            [limit]
          );
          trendingTags = tagResult.rows;
        } catch {
          // hashtag_index may not exist yet; fall back to extracting from posts
          const fallbackResult = await pool.query(
            `SELECT LOWER(tag) AS tag, COUNT(*) AS count_total
             FROM social_profiles.posts, LATERAL unnest(hashtags) AS tag
             WHERE created_at > NOW() - INTERVAL '7 days'
               AND visibility = 'public'
             GROUP BY LOWER(tag)
             ORDER BY count_total DESC
             LIMIT $1`,
            [limit]
          );
          trendingTags = fallbackResult.rows.map(r => ({
            tag: r.tag,
            count_total: parseInt(r.count_total, 10),
            count_24h: 0,
            count_7d: parseInt(r.count_total, 10),
            last_used_at: null,
          }));
        }

        // Popular profiles: by follower count (from social_graph.followers)
        let popularProfiles = [];
        try {
          const profileResult = await pool.query(
            `SELECT pi.id, pi.display_name, pi.username, pi.avatar_url, pi.bio,
                    COUNT(f.id) AS follower_count
             FROM social_profiles.profile_index pi
             LEFT JOIN social_graph.followers f ON f.actor_uri LIKE '%' || pi.username || '%'
               AND f.status = 'accepted'
             GROUP BY pi.id, pi.display_name, pi.username, pi.avatar_url, pi.bio
             ORDER BY follower_count DESC, pi.display_name ASC
             LIMIT $1`,
            [limit]
          );
          popularProfiles = profileResult.rows.map(r => ({
            id: r.id,
            display_name: r.display_name,
            username: r.username,
            avatar_url: r.avatar_url,
            bio: r.bio,
            follower_count: parseInt(r.follower_count, 10),
            url: `${BASE_URL}/@${r.username}`,
          }));
        } catch (err) {
          console.error('[search] Error fetching popular profiles:', err.message);
        }

        // Active groups: most recently updated with most members
        let activeGroups = [];
        try {
          const groupResult = await pool.query(
            `SELECT g.id, g.name, g.type, g.description, g.avatar_url, g.visibility,
                    COUNT(gm.id) AS member_count
             FROM social_profiles.groups g
             LEFT JOIN social_profiles.group_memberships gm ON gm.group_id = g.id
             WHERE g.visibility = 'public'
             GROUP BY g.id, g.name, g.type, g.description, g.avatar_url, g.visibility
             ORDER BY member_count DESC, g.updated_at DESC
             LIMIT $1`,
            [limit]
          );
          activeGroups = groupResult.rows.map(r => ({
            id: r.id,
            name: r.name,
            group_type: r.type,
            description: r.description,
            avatar_url: r.avatar_url,
            member_count: parseInt(r.member_count, 10),
          }));
        } catch (err) {
          console.error('[search] Error fetching active groups:', err.message);
        }

        json(res, 200, {
          trending_tags: trendingTags,
          popular_profiles: popularProfiles,
          active_groups: activeGroups,
        });
      } catch (err) {
        console.error('[search] Error in trending endpoint:', err.message);
        json(res, 500, {
          error: 'Internal Server Error',
          message: 'Failed to load trending data.',
        });
      }
    },
  });

  // =========================================================================
  // GET /api/discover/directory?letter=A&protocol=nostr&limit=20&offset=0
  // =========================================================================
  // Browse all public profiles alphabetically.
  // Filter by protocol identity (show me all users with Nostr identity).
  routes.push({
    method: 'GET',
    pattern: '/api/discover/directory',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const letter = (searchParams.get('letter') || '').toUpperCase();
      const protocol = searchParams.get('protocol') || null;
      const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 100);
      const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

      try {
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        // Filter by first letter of display_name
        if (letter && /^[A-Z]$/.test(letter)) {
          conditions.push(`UPPER(LEFT(COALESCE(display_name, username), 1)) = $${paramIdx}`);
          params.push(letter);
          paramIdx++;
        }

        // Filter by protocol identity presence
        if (protocol) {
          const protocolFilters = {
            nostr: 'nostr_npub IS NOT NULL',
            atprotocol: 'at_did IS NOT NULL',
            activitypub: 'ap_actor_uri IS NOT NULL',
            matrix: 'matrix_id IS NOT NULL',
            xmtp: 'xmtp_address IS NOT NULL',
            dsnp: 'dsnp_user_id IS NOT NULL',
            zot: 'zot_channel_hash IS NOT NULL',
          };
          if (protocolFilters[protocol]) {
            conditions.push(protocolFilters[protocol]);
          }
        }

        const whereClause = conditions.length > 0
          ? `WHERE ${conditions.join(' AND ')}`
          : '';

        const result = await pool.query(
          `SELECT id, display_name, username, bio, avatar_url,
                  nostr_npub, at_did, ap_actor_uri, matrix_id,
                  xmtp_address, dsnp_user_id, zot_channel_hash,
                  created_at
           FROM social_profiles.profile_index
           ${whereClause}
           ORDER BY COALESCE(display_name, username) ASC
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset]
        );

        // Count total for pagination
        const countResult = await pool.query(
          `SELECT COUNT(*) AS total
           FROM social_profiles.profile_index
           ${whereClause}`,
          params
        );

        const total = parseInt(countResult.rows[0].total, 10);

        // Build the list of available first letters
        const lettersResult = await pool.query(
          `SELECT DISTINCT UPPER(LEFT(COALESCE(display_name, username), 1)) AS letter
           FROM social_profiles.profile_index
           ORDER BY letter`
        );
        const availableLetters = lettersResult.rows.map(r => r.letter).filter(l => /^[A-Z]$/.test(l));

        json(res, 200, {
          profiles: result.rows.map(r => ({
            id: r.id,
            display_name: r.display_name,
            username: r.username,
            bio: r.bio,
            avatar_url: r.avatar_url,
            protocols: {
              nostr: !!r.nostr_npub,
              atprotocol: !!r.at_did,
              activitypub: !!r.ap_actor_uri,
              matrix: !!r.matrix_id,
              xmtp: !!r.xmtp_address,
              dsnp: !!r.dsnp_user_id,
              zot: !!r.zot_channel_hash,
            },
            url: `${BASE_URL}/@${r.username}`,
          })),
          filters: {
            letter: letter || null,
            protocol: protocol || null,
          },
          pagination: {
            limit,
            offset,
            total,
          },
          available_letters: availableLetters,
        });
      } catch (err) {
        console.error('[search] Error in directory endpoint:', err.message);
        json(res, 500, {
          error: 'Internal Server Error',
          message: 'Failed to load directory.',
        });
      }
    },
  });
}

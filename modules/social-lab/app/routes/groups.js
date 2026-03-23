// =============================================================================
// Group Routes — Universal Group System (Phase 1: CRUD + Membership)
// =============================================================================
// Blueprint: ARCH-011 (Universal Group System)
//
// POST   /api/group               — Create a group
// GET    /api/groups              — List groups (filter by type, parent_id, taxonomy_type)
// GET    /api/group/:id           — Get group details + member count + sub-groups
// PUT    /api/group/:id           — Update group
// DELETE /api/group/:id           — Delete group (must be empty)
//
// POST   /api/group/:id/join      — Join a group
// POST   /api/group/:id/leave     — Leave a group
// GET    /api/group/:id/members   — List members
//
// GET    /api/group/:id/subgroups — List child groups
// GET    /api/group/:id/posts     — List posts in this group
// GET    /api/group/:id/timeline  — Group timeline (newest first, ?include_subgroups=true)

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import {
  json, parseUrl, readJsonBody, BASE_URL, INSTANCE_DOMAIN,
} from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a URL-safe slug from a string.
 * Used for materialized path segments.
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64);
}

/**
 * Ensure the platform group exists for this instance.
 * Called on module load (startup).
 * Per ARCH-011 Section 7: auto-register platform on first boot.
 */
async function ensurePlatformGroup() {
  const platformName = process.env.PLATFORM_NAME || 'PeerMesh Social Lab';
  const domain = INSTANCE_DOMAIN;
  const platformSlug = slugify(domain);
  const platformId = `platform-${platformSlug}`;
  const platformPath = `/ecosystem/${platformSlug}`;

  try {
    // Check if platform group already exists
    const existing = await pool.query(
      'SELECT id FROM social_profiles.groups WHERE id = $1',
      [platformId]
    );

    if (existing.rowCount > 0) {
      console.log(`[groups] Platform group already exists: ${platformId}`);
      return;
    }

    // Check if this is a solo instance (only one user)
    const userCount = await pool.query(
      'SELECT COUNT(*) AS cnt FROM social_profiles.profile_index'
    );
    const isSolo = parseInt(userCount.rows[0].cnt, 10) <= 1;

    const metadata = {
      domain,
      solo: isSolo,
      branding: {
        tagline: `${platformName} on PeerMesh`,
      },
      taxonomies: isSolo ? [] : [
        { type: 'geography', label: 'By Location', icon: 'map-pin' },
        { type: 'interest', label: 'By Interest', icon: 'sparkles' },
      ],
      features: {
        allowUserGroupCreation: !isSolo,
        maxGroupDepth: isSolo ? 1 : 5,
        allowCrossGroupPosting: !isSolo,
      },
    };

    await pool.query(
      `INSERT INTO social_profiles.groups
         (id, name, type, parent_id, path, description, visibility, membership_policy, metadata, created_at)
       VALUES ($1, $2, 'platform', 'ecosystem-root', $3, $4, 'public', 'open', $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        platformId,
        platformName,
        platformPath,
        `${platformName} — a PeerMesh social platform at ${domain}`,
        JSON.stringify(metadata),
      ]
    );

    console.log(`[groups] Registered platform group: ${platformId} (solo=${isSolo})`);
  } catch (err) {
    // Table may not exist yet if migration hasn't run; that's OK on first boot
    console.error(`[groups] Platform group registration skipped:`, err.message);
  }
}

// Run platform auto-registration on module load
ensurePlatformGroup();

// =============================================================================
// Route Handlers
// =============================================================================

export default function registerRoutes(routes) {

  // =========================================================================
  // POST /api/group — Create a group
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: '/api/group',
    handler: async (req, res) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.name) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: name' });
      }

      const id = randomUUID();
      const name = body.name;
      const type = body.type || 'user';
      const parentId = body.parent_id || body.parentId || null;
      const description = body.description || null;
      const visibility = body.visibility || 'public';
      const membershipPolicy = body.membership_policy || body.membershipPolicy || 'open';
      const taxonomyType = body.taxonomy_type || body.taxonomyType || null;
      const metadata = body.metadata || {};

      // Validate type
      const validTypes = ['ecosystem', 'platform', 'category', 'topic', 'user', 'custom'];
      if (!validTypes.includes(type)) {
        return json(res, 400, { error: 'Bad Request', message: `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}` });
      }

      // Build materialized path
      let path;
      if (parentId) {
        const parentResult = await pool.query(
          'SELECT path FROM social_profiles.groups WHERE id = $1',
          [parentId]
        );
        if (parentResult.rowCount === 0) {
          return json(res, 400, { error: 'Bad Request', message: `Parent group not found: ${parentId}` });
        }
        path = `${parentResult.rows[0].path}/${slugify(name)}`;
      } else {
        // Top-level group under ecosystem root
        path = `/ecosystem/${slugify(name)}`;
      }

      // Look up creator's webid from session
      let createdBy = null;
      if (session.profileId) {
        const profileResult = await pool.query(
          'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
          [session.profileId]
        );
        if (profileResult.rowCount > 0) {
          createdBy = profileResult.rows[0].webid;
        }
      }

      try {
        const result = await pool.query(
          `INSERT INTO social_profiles.groups
             (id, name, type, parent_id, path, description, visibility, membership_policy, taxonomy_type, metadata, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
           RETURNING *`,
          [id, name, type, parentId, path, description, visibility, membershipPolicy, taxonomyType, JSON.stringify(metadata), createdBy]
        );

        const group = result.rows[0];

        // Auto-join the creator as owner
        if (createdBy) {
          await pool.query(
            `INSERT INTO social_profiles.group_memberships (id, group_id, user_webid, role, joined_at)
             VALUES ($1, $2, $3, 'owner', NOW())
             ON CONFLICT (group_id, user_webid) DO NOTHING`,
            [randomUUID(), id, createdBy]
          );
        }

        console.log(`[groups] Created group: ${id} "${name}" (type=${type}, path=${path})`);
        json(res, 201, { group });
      } catch (err) {
        console.error(`[groups] Create error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/groups — List groups (with filters)
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: '/api/groups',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const type = searchParams.get('type');
      const parentId = searchParams.get('parent_id');
      const taxonomyType = searchParams.get('taxonomy_type');
      const visibility = searchParams.get('visibility');
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      let query = `SELECT g.*,
                     (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count,
                     (SELECT COUNT(*) FROM social_profiles.groups c WHERE c.parent_id = g.id) AS child_count
                   FROM social_profiles.groups g WHERE 1=1`;
      const params = [];
      let paramIdx = 1;

      if (type) {
        query += ` AND g.type = $${paramIdx}`;
        params.push(type);
        paramIdx++;
      }

      if (parentId) {
        query += ` AND g.parent_id = $${paramIdx}`;
        params.push(parentId);
        paramIdx++;
      }

      if (taxonomyType) {
        query += ` AND g.taxonomy_type = $${paramIdx}`;
        params.push(taxonomyType);
        paramIdx++;
      }

      if (visibility) {
        query += ` AND g.visibility = $${paramIdx}`;
        params.push(visibility);
        paramIdx++;
      } else {
        // Default: exclude private groups from public listing
        query += ` AND g.visibility != 'private'`;
      }

      query += ` ORDER BY g.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      try {
        const result = await pool.query(query, params);
        json(res, 200, {
          groups: result.rows,
          count: result.rowCount,
          pagination: { limit, offset },
        });
      } catch (err) {
        console.error(`[groups] List error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/group/:id — Get group details
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)$/,
    handler: async (req, res, matches) => {
      const id = matches[1];

      try {
        const groupResult = await pool.query(
          `SELECT g.*,
             (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count,
             (SELECT COUNT(*) FROM social_profiles.groups c WHERE c.parent_id = g.id) AS child_count
           FROM social_profiles.groups g
           WHERE g.id = $1`,
          [id]
        );

        if (groupResult.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: `Group not found: ${id}` });
        }

        const group = groupResult.rows[0];

        // Fetch sub-groups (direct children)
        const subgroupsResult = await pool.query(
          `SELECT id, name, type, path, description, visibility, taxonomy_type,
             (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count
           FROM social_profiles.groups g
           WHERE g.parent_id = $1
           ORDER BY g.name ASC
           LIMIT 50`,
          [id]
        );

        json(res, 200, {
          group,
          subgroups: subgroupsResult.rows,
        });
      } catch (err) {
        console.error(`[groups] Get error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // PUT /api/group/:id — Update group
  // =========================================================================
  routes.push({
    method: 'PUT',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const id = matches[1];

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || Object.keys(body).length === 0) {
        return json(res, 400, { error: 'Bad Request', message: 'Request body with fields to update is required' });
      }

      const fieldMap = {
        name: 'name',
        description: 'description',
        avatar_url: 'avatar_url',
        avatarUrl: 'avatar_url',
        banner_url: 'banner_url',
        bannerUrl: 'banner_url',
        visibility: 'visibility',
        membership_policy: 'membership_policy',
        membershipPolicy: 'membership_policy',
        taxonomy_type: 'taxonomy_type',
        taxonomyType: 'taxonomy_type',
        metadata: 'metadata',
      };

      const setClauses = [];
      const values = [];
      let paramIdx = 1;

      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body) {
          const val = column === 'metadata' ? JSON.stringify(body[key]) : body[key];
          setClauses.push(`${column} = $${paramIdx}`);
          values.push(val);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return json(res, 400, { error: 'Bad Request', message: 'No recognized fields to update' });
      }

      // If name changed, update path too
      if (body.name) {
        const existingResult = await pool.query(
          'SELECT path, parent_id FROM social_profiles.groups WHERE id = $1',
          [id]
        );
        if (existingResult.rowCount > 0) {
          const existing = existingResult.rows[0];
          const pathParts = existing.path.split('/');
          pathParts[pathParts.length - 1] = slugify(body.name);
          const newPath = pathParts.join('/');
          setClauses.push(`path = $${paramIdx}`);
          values.push(newPath);
          paramIdx++;
        }
      }

      values.push(id);
      const query = `UPDATE social_profiles.groups
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIdx}
        RETURNING *`;

      try {
        const result = await pool.query(query, values);
        if (result.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: `Group not found: ${id}` });
        }
        json(res, 200, { group: result.rows[0] });
      } catch (err) {
        console.error(`[groups] Update error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // DELETE /api/group/:id — Delete group
  // =========================================================================
  routes.push({
    method: 'DELETE',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const id = matches[1];

      // Check for child groups — prevent deletion if non-empty hierarchy
      const childResult = await pool.query(
        'SELECT COUNT(*) AS cnt FROM social_profiles.groups WHERE parent_id = $1',
        [id]
      );
      if (parseInt(childResult.rows[0].cnt, 10) > 0) {
        return json(res, 409, {
          error: 'Conflict',
          message: 'Cannot delete group with child groups. Remove or re-parent children first.',
        });
      }

      try {
        // Memberships cascade-delete via FK ON DELETE CASCADE
        const result = await pool.query(
          'DELETE FROM social_profiles.groups WHERE id = $1',
          [id]
        );

        if (result.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: `Group not found: ${id}` });
        }

        console.log(`[groups] Deleted group: ${id}`);
        json(res, 200, { deleted: true, id });
      } catch (err) {
        console.error(`[groups] Delete error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/group/:id/join — Join a group
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/join$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];

      // Look up the group
      const groupResult = await pool.query(
        'SELECT id, membership_policy FROM social_profiles.groups WHERE id = $1',
        [groupId]
      );
      if (groupResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Group not found: ${groupId}` });
      }

      const group = groupResult.rows[0];

      // Look up user's webid
      let userWebid = null;
      if (session.profileId) {
        const profileResult = await pool.query(
          'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
          [session.profileId]
        );
        if (profileResult.rowCount > 0) {
          userWebid = profileResult.rows[0].webid;
        }
      }

      if (!userWebid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session' });
      }

      // Check if already a member
      const existingMembership = await pool.query(
        'SELECT id FROM social_profiles.group_memberships WHERE group_id = $1 AND user_webid = $2',
        [groupId, userWebid]
      );
      if (existingMembership.rowCount > 0) {
        return json(res, 409, { error: 'Conflict', message: 'Already a member of this group' });
      }

      // For open groups, join immediately
      // For request/invite groups, Phase 1 treats all as open (join requests/invites deferred)
      if (group.membership_policy === 'invite') {
        return json(res, 403, { error: 'Forbidden', message: 'This group is invite-only. Join requests not yet implemented in Phase 1.' });
      }

      const membershipId = randomUUID();
      try {
        await pool.query(
          `INSERT INTO social_profiles.group_memberships (id, group_id, user_webid, role, joined_at)
           VALUES ($1, $2, $3, 'member', NOW())`,
          [membershipId, groupId, userWebid]
        );

        console.log(`[groups] User ${userWebid} joined group ${groupId}`);
        json(res, 200, {
          membership: {
            id: membershipId,
            groupId,
            userWebid,
            role: 'member',
            status: group.membership_policy === 'request' ? 'pending' : 'active',
          },
        });
      } catch (err) {
        console.error(`[groups] Join error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/group/:id/leave — Leave a group
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/leave$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];

      // Look up user's webid
      let userWebid = null;
      if (session.profileId) {
        const profileResult = await pool.query(
          'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
          [session.profileId]
        );
        if (profileResult.rowCount > 0) {
          userWebid = profileResult.rows[0].webid;
        }
      }

      if (!userWebid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session' });
      }

      try {
        const result = await pool.query(
          'DELETE FROM social_profiles.group_memberships WHERE group_id = $1 AND user_webid = $2',
          [groupId, userWebid]
        );

        if (result.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: 'Not a member of this group' });
        }

        console.log(`[groups] User ${userWebid} left group ${groupId}`);
        json(res, 200, { left: true, groupId });
      } catch (err) {
        console.error(`[groups] Leave error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/group/:id/members — List members
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/members$/,
    handler: async (req, res, matches) => {
      const groupId = matches[1];
      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      try {
        const result = await pool.query(
          `SELECT m.id, m.group_id, m.user_webid, m.role, m.joined_at,
                  p.display_name, p.username, p.avatar_url
           FROM social_profiles.group_memberships m
           LEFT JOIN social_profiles.profile_index p ON p.webid = m.user_webid
           WHERE m.group_id = $1
           ORDER BY m.joined_at ASC
           LIMIT $2 OFFSET $3`,
          [groupId, limit, offset]
        );

        json(res, 200, {
          members: result.rows,
          count: result.rowCount,
          pagination: { limit, offset },
        });
      } catch (err) {
        console.error(`[groups] Members list error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/group/:id/subgroups — List child groups
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/subgroups$/,
    handler: async (req, res, matches) => {
      const groupId = matches[1];
      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      try {
        const result = await pool.query(
          `SELECT g.*,
             (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count,
             (SELECT COUNT(*) FROM social_profiles.groups c WHERE c.parent_id = g.id) AS child_count
           FROM social_profiles.groups g
           WHERE g.parent_id = $1
           ORDER BY g.name ASC
           LIMIT $2 OFFSET $3`,
          [groupId, limit, offset]
        );

        json(res, 200, {
          subgroups: result.rows,
          count: result.rowCount,
          pagination: { limit, offset },
        });
      } catch (err) {
        console.error(`[groups] Subgroups list error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/group/:id/posts — List posts in this group
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/posts$/,
    handler: async (req, res, matches) => {
      const groupId = matches[1];
      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
      const offset = parseInt(searchParams.get('offset') || '0', 10);

      try {
        // Verify group exists
        const groupCheck = await pool.query(
          'SELECT id FROM social_profiles.groups WHERE id = $1',
          [groupId]
        );
        if (groupCheck.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: `Group not found: ${groupId}` });
        }

        const result = await pool.query(
          `SELECT p.id, p.webid, p.content_text, p.content_html, p.media_urls,
                  p.visibility, p.in_reply_to, p.group_id, p.created_at, p.updated_at,
                  pi.username AS handle, pi.display_name, pi.avatar_url
           FROM social_profiles.posts p
           JOIN social_profiles.profile_index pi ON pi.webid = p.webid
           WHERE p.group_id = $1
           ORDER BY p.created_at DESC
           LIMIT $2 OFFSET $3`,
          [groupId, limit, offset]
        );

        json(res, 200, {
          posts: result.rows,
          count: result.rowCount,
          pagination: { limit, offset },
        });
      } catch (err) {
        console.error(`[groups] Posts list error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/group/:id/timeline — Group timeline (newest first, with author)
  // Supports ?include_subgroups=true to include posts from child groups.
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/timeline$/,
    handler: async (req, res, matches) => {
      const groupId = matches[1];
      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
      const offset = parseInt(searchParams.get('offset') || '0', 10);
      const includeSubgroups = searchParams.get('include_subgroups') === 'true';

      try {
        // Verify group exists and get its path for sub-group queries
        const groupCheck = await pool.query(
          'SELECT id, path FROM social_profiles.groups WHERE id = $1',
          [groupId]
        );
        if (groupCheck.rowCount === 0) {
          return json(res, 404, { error: 'Not Found', message: `Group not found: ${groupId}` });
        }

        let result;
        if (includeSubgroups) {
          const groupPath = groupCheck.rows[0].path;
          // Posts from this group OR any sub-group (path starts with group's path)
          result = await pool.query(
            `SELECT p.id, p.webid, p.content_text, p.content_html, p.media_urls,
                    p.visibility, p.in_reply_to, p.group_id, p.created_at, p.updated_at,
                    pi.username AS handle, pi.display_name, pi.avatar_url,
                    g.name AS group_name, g.path AS group_path
             FROM social_profiles.posts p
             JOIN social_profiles.profile_index pi ON pi.webid = p.webid
             JOIN social_profiles.groups g ON g.id = p.group_id
             WHERE p.group_id IN (
               SELECT id FROM social_profiles.groups WHERE id = $1 OR path LIKE $2
             )
             ORDER BY p.created_at DESC
             LIMIT $3 OFFSET $4`,
            [groupId, groupPath + '/%', limit, offset]
          );
        } else {
          result = await pool.query(
            `SELECT p.id, p.webid, p.content_text, p.content_html, p.media_urls,
                    p.visibility, p.in_reply_to, p.group_id, p.created_at, p.updated_at,
                    pi.username AS handle, pi.display_name, pi.avatar_url
             FROM social_profiles.posts p
             JOIN social_profiles.profile_index pi ON pi.webid = p.webid
             WHERE p.group_id = $1
             ORDER BY p.created_at DESC
             LIMIT $2 OFFSET $3`,
            [groupId, limit, offset]
          );
        }

        json(res, 200, {
          groupId,
          includeSubgroups,
          posts: result.rows,
          count: result.rowCount,
          pagination: { limit, offset },
        });
      } catch (err) {
        console.error(`[groups] Timeline error:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /studio/groups — Studio Groups Page
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: '/studio/groups',
    handler: async (req, res) => {
      // Import studio helpers dynamically to avoid circular deps
      const { requireAuth: authCheck } = await import('../lib/session.js');
      const { html: sendHtml, escapeHtml } = await import('../lib/helpers.js');

      const session = authCheck(req);
      if (!session) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      // Load profile
      let profile = null;
      if (session.profileId) {
        const profileResult = await pool.query(
          `SELECT id, webid, display_name, username, avatar_url FROM social_profiles.profile_index WHERE id = $1`,
          [session.profileId]
        );
        if (profileResult.rowCount > 0) profile = profileResult.rows[0];
      }

      // Load user's groups
      let myGroups = [];
      if (profile) {
        const myGroupsResult = await pool.query(
          `SELECT g.id, g.name, g.type, g.path, g.description, g.visibility, g.taxonomy_type,
                  m.role, m.joined_at,
                  (SELECT COUNT(*) FROM social_profiles.group_memberships mm WHERE mm.group_id = g.id) AS member_count
           FROM social_profiles.group_memberships m
           JOIN social_profiles.groups g ON g.id = m.group_id
           WHERE m.user_webid = $1
           ORDER BY m.joined_at DESC`,
          [profile.webid]
        );
        myGroups = myGroupsResult.rows;
      }

      // Load all public groups for browsing
      const allGroupsResult = await pool.query(
        `SELECT g.id, g.name, g.type, g.path, g.description, g.visibility, g.taxonomy_type,
                (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count
         FROM social_profiles.groups g
         WHERE g.visibility != 'private'
         ORDER BY g.type ASC, g.name ASC
         LIMIT 100`
      );
      const allGroups = allGroupsResult.rows;

      // Build the HTML content
      const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
      const handle = profile ? escapeHtml(profile.username || '') : '';
      const avatarUrl = profile ? profile.avatar_url : null;
      const initial = displayName.charAt(0).toUpperCase();

      const avatarHtml = avatarUrl
        ? `<img class="topbar-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}" style="object-fit:cover">`
        : `<div class="topbar-avatar">${initial}</div>`;

      // Group type badge colors
      const typeBadge = (type) => {
        const colors = {
          ecosystem: 'var(--color-violet-500)',
          platform: 'var(--color-cyan-500)',
          category: 'var(--color-amber-500)',
          topic: 'var(--color-green-500)',
          user: 'var(--color-accent)',
          custom: 'var(--color-text-tertiary)',
        };
        const color = colors[type] || 'var(--color-text-tertiary)';
        return `<span style="display:inline-flex;align-items:center;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.6875rem;font-weight:500;background:${color}22;color:${color};border:1px solid ${color}44;">${escapeHtml(type)}</span>`;
      };

      // Render my groups list
      let myGroupsHtml = '';
      if (myGroups.length > 0) {
        myGroupsHtml = myGroups.map(g => `
          <a href="/studio/groups/${escapeHtml(g.id)}" style="display:flex;align-items:center;gap:0.75rem;padding:1rem 1.25rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);transition:border-color 0.15s;text-decoration:none;color:inherit;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span style="font-size:0.875rem;font-weight:600;color:var(--color-text-primary);">${escapeHtml(g.name)}</span>
                ${typeBadge(g.type)}
                <span style="font-size:0.6875rem;color:var(--color-text-tertiary);">${escapeHtml(g.role)}</span>
              </div>
              ${g.description ? `<div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:0.25rem;">${escapeHtml(g.description)}</div>` : ''}
              <div style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-top:0.25rem;">${g.member_count} member${g.member_count !== 1 ? 's' : ''} &middot; ${escapeHtml(g.path)}</div>
            </div>
          </a>`).join('\n');
      } else {
        myGroupsHtml = `
          <div style="text-align:center;padding:2rem;color:var(--color-text-secondary);">
            <div style="font-size:1.125rem;font-weight:500;color:var(--color-text-primary);margin-bottom:0.25rem;">No groups yet</div>
            <div>Join a group or create one below.</div>
          </div>`;
      }

      // Render all groups for browsing
      let browseHtml = allGroups.map(g => `
        <a href="/studio/groups/${escapeHtml(g.id)}" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-md);transition:border-color 0.15s;text-decoration:none;color:inherit;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <span style="font-size:0.875rem;font-weight:500;color:var(--color-text-primary);">${escapeHtml(g.name)}</span>
              ${typeBadge(g.type)}
            </div>
            ${g.description ? `<div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:0.125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.description)}</div>` : ''}
            <div style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-top:0.125rem;">${g.member_count} member${g.member_count !== 1 ? 's' : ''}${g.taxonomy_type ? ` &middot; ${escapeHtml(g.taxonomy_type)}` : ''}</div>
          </div>
        </a>`).join('\n');

      const pageHtml = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Groups - Studio - PeerMesh Social Lab</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      /* Layout aliases - all tokens from tokens.css */
      --sidebar-width: var(--space-sidebar-width);
      --sidebar-collapsed: var(--space-sidebar-width-collapsed);
      --topbar-height: var(--space-topbar-height);
      --tab-height: var(--space-tab-height);
      --content-max-width: var(--space-content-max-width-studio);
    }
    body { font-family: var(--font-family-primary); background: var(--color-bg-primary); color: var(--color-text-primary); min-height: 100vh; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    a { color: var(--color-primary); text-decoration: none; }
    a:hover { color: var(--color-primary-hover); }

    .studio-topbar { position: fixed; top: 0; left: 0; right: 0; height: var(--topbar-height); background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem; z-index: 100; }
    .topbar-left { display: flex; align-items: center; gap: 1rem; }
    .topbar-logo { font-size: 1rem; font-weight: 600; color: var(--color-primary); text-decoration: none; }
    .topbar-divider { width: 1px; height: 24px; background: var(--color-border-strong); }
    .topbar-title { font-size: 0.875rem; font-weight: 500; color: var(--color-text-primary); }
    .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
    .topbar-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 600; border: 2px solid var(--color-border-strong); }

    .studio-sidebar { position: fixed; top: var(--topbar-height); left: 0; bottom: 0; width: var(--sidebar-width); background: var(--color-bg-secondary); border-right: 1px solid var(--color-border); padding: 1rem 0; display: flex; flex-direction: column; z-index: 100; }
    .sidebar-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; margin: 0 0.5rem; border-radius: var(--radius-md); color: var(--color-text-secondary); text-decoration: none; font-size: 0.875rem; font-weight: 400; transition: background 0.15s, color 0.15s; min-height: 44px; }
    .sidebar-item:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
    .sidebar-item.active { background: var(--color-primary-light); color: var(--color-text-primary); font-weight: 500; }

    .studio-content { margin-top: var(--topbar-height); margin-left: var(--sidebar-width); padding: 1.5rem; min-height: calc(100vh - var(--topbar-height)); }
    .studio-content-inner { max-width: 1280px; margin: 0 auto; }

    .page-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .page-title { font-size: 1.5rem; font-weight: 600; color: var(--color-text-primary); }

    .section { margin-bottom: 1.5rem; }
    .section-title { font-size: 1.25rem; font-weight: 500; color: var(--color-text-primary); margin-bottom: 1rem; }

    .btn { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--font-family-primary); font-size: 0.875rem; font-weight: 500; border: none; border-radius: var(--radius-pill); cursor: pointer; transition: background 0.15s; text-decoration: none; min-height: 44px; padding: 0.75rem 1.5rem; }
    .btn-primary { background: var(--color-primary); color: var(--color-text-inverse); }
    .btn-primary:hover { background: var(--color-primary-hover); color: var(--color-text-inverse); }
    .btn-secondary { background: transparent; border: 1px solid var(--color-border-strong); color: var(--color-text-primary); }
    .btn-secondary:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }

    .form-field { display: flex; flex-direction: column; gap: 0.5rem; }
    .form-label { font-size: 0.875rem; font-weight: 500; color: var(--color-text-primary); }
    .form-input, .form-select { background: var(--color-bg-tertiary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; font-size: 1rem; font-family: var(--font-family-primary); color: var(--color-text-primary); min-height: 44px; width: 100%; }
    .form-input:focus, .form-select:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.5); }
    .form-textarea { min-height: 80px; resize: vertical; }

    @media (max-width: 767px) {
      .studio-sidebar { display: none; }
      .studio-content { margin-left: 0; padding: 1rem; }
    }
  </style>
</head>
<body>
  <header class="studio-topbar">
    <div class="topbar-left">
      <a href="/studio" class="topbar-logo">Studio</a>
      <div class="topbar-divider"></div>
      <span class="topbar-title">Groups</span>
    </div>
    <div class="topbar-right">
      ${avatarHtml}
    </div>
  </header>

  <nav class="studio-sidebar">
    <a class="sidebar-item" href="/studio">Dashboard</a>
    <a class="sidebar-item" href="/studio/feed">Feed</a>
    <a class="sidebar-item" href="/studio/links">Links</a>
    <a class="sidebar-item active" href="/studio/groups">Groups</a>
    <a class="sidebar-item" href="/studio/analytics">Analytics</a>
    <a class="sidebar-item" href="/studio/customize">Customize</a>
    <a class="sidebar-item" href="/studio/settings">Settings</a>
  </nav>

  <main class="studio-content">
    <div class="studio-content-inner">
      <div class="page-header">
        <h1 class="page-title">Groups</h1>
      </div>

      <!-- My Groups -->
      <div class="section">
        <h2 class="section-title">My Groups</h2>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${myGroupsHtml}
        </div>
      </div>

      <!-- Create Group -->
      <div class="section">
        <h2 class="section-title">Create a Group</h2>
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;">
          <form id="create-group-form" style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));">
            <div class="form-field">
              <label class="form-label" for="group-name">Name</label>
              <input class="form-input" type="text" id="group-name" name="name" placeholder="e.g., Portland Creators" required>
            </div>
            <div class="form-field">
              <label class="form-label" for="group-type">Type</label>
              <select class="form-input form-select" id="group-type" name="type">
                <option value="user">User Group</option>
                <option value="topic">Topic</option>
                <option value="category">Category</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="form-field">
              <label class="form-label" for="group-taxonomy">Taxonomy</label>
              <select class="form-input form-select" id="group-taxonomy" name="taxonomy_type">
                <option value="">None</option>
                <option value="geography">Geography</option>
                <option value="interest">Interest</option>
                <option value="watershed">Watershed</option>
                <option value="county">County</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="form-field">
              <label class="form-label" for="group-visibility">Visibility</label>
              <select class="form-input form-select" id="group-visibility" name="visibility">
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div class="form-field" style="grid-column:1/-1;">
              <label class="form-label" for="group-description">Description</label>
              <textarea class="form-input form-textarea" id="group-description" name="description" placeholder="What is this group about?"></textarea>
            </div>
            <div style="grid-column:1/-1;">
              <button class="btn btn-primary" type="submit">Create Group</button>
            </div>
          </form>
          <div id="create-result" style="margin-top:1rem;font-size:0.875rem;"></div>
          <script>
            document.getElementById('create-group-form').addEventListener('submit', async (e) => {
              e.preventDefault();
              const form = e.target;
              const body = {
                name: form.name.value,
                type: form.type.value,
                taxonomy_type: form.taxonomy_type.value || undefined,
                visibility: form.visibility.value,
                description: form.description.value || undefined,
              };
              try {
                const resp = await fetch('/api/group', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await resp.json();
                if (resp.ok) {
                  document.getElementById('create-result').innerHTML =
                    '<span style="color:var(--color-success);">Group created! Reloading...</span>';
                  setTimeout(() => location.reload(), 1000);
                } else {
                  document.getElementById('create-result').innerHTML =
                    '<span style="color:var(--color-error);">Error: ' + (data.message || 'Unknown error') + '</span>';
                }
              } catch (err) {
                document.getElementById('create-result').innerHTML =
                  '<span style="color:var(--color-error);">Network error: ' + err.message + '</span>';
              }
            });
          </script>
        </div>
      </div>

      <!-- Browse All Groups -->
      <div class="section">
        <h2 class="section-title">Browse Groups</h2>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          ${browseHtml || '<div style="padding:1.5rem;text-align:center;color:var(--color-text-secondary);">No public groups yet.</div>'}
        </div>
      </div>

      <!-- API Reference -->
      <div class="section">
        <h2 class="section-title">Groups API</h2>
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;">
          <div style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--color-text-secondary);display:flex;flex-direction:column;gap:0.5rem;">
            <div>GET <a href="/api/groups">/api/groups</a></div>
            <div>GET <a href="/api/groups?type=platform">/api/groups?type=platform</a></div>
            <div>POST /api/group</div>
            <div>POST /api/post (with group_id)</div>
            <div>GET /api/group/:id</div>
            <div>GET /api/group/:id/posts</div>
            <div>GET /api/group/:id/timeline</div>
            <div>GET /api/group/:id/timeline?include_subgroups=true</div>
            <div>POST /api/group/:id/join</div>
            <div>GET /api/group/:id/members</div>
          </div>
        </div>
      </div>
    </div>
  </main>
</body>
</html>`;

      sendHtml(res, 200, pageHtml);
    },
  });

  // =========================================================================
  // GET /studio/groups/:id — Studio Group Detail Page
  // Shows group info, timeline, compose form, members, sub-groups
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/studio\/groups\/([a-zA-Z0-9_-]+)$/,
    handler: async (req, res, matches) => {
      const { requireAuth: authCheck } = await import('../lib/session.js');
      const { html: sendHtml, escapeHtml, readFormBody: _rfb } = await import('../lib/helpers.js');

      const session = authCheck(req);
      if (!session) {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      const groupId = matches[1];

      // Load profile
      let profile = null;
      if (session.profileId) {
        const profileResult = await pool.query(
          `SELECT id, webid, display_name, username, avatar_url FROM social_profiles.profile_index WHERE id = $1`,
          [session.profileId]
        );
        if (profileResult.rowCount > 0) profile = profileResult.rows[0];
      }

      // Load group
      const groupResult = await pool.query(
        `SELECT g.*,
           (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count,
           (SELECT COUNT(*) FROM social_profiles.groups c WHERE c.parent_id = g.id) AS child_count
         FROM social_profiles.groups g
         WHERE g.id = $1`,
        [groupId]
      );

      if (groupResult.rowCount === 0) {
        sendHtml(res, 404, `<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>Group not found</h1><p><a href="/studio/groups">Back to groups</a></p></body></html>`);
        return;
      }

      const group = groupResult.rows[0];
      const displayName = profile ? escapeHtml(profile.display_name || profile.username || 'User') : 'User';
      const avatarUrl = profile ? profile.avatar_url : null;
      const initial = displayName.charAt(0).toUpperCase();

      const avatarHtml = avatarUrl
        ? `<img class="topbar-avatar" src="${escapeHtml(avatarUrl)}" alt="${displayName}" style="object-fit:cover">`
        : `<div class="topbar-avatar">${initial}</div>`;

      // Check if user is a member
      let membership = null;
      if (profile) {
        const memberCheck = await pool.query(
          `SELECT role FROM social_profiles.group_memberships WHERE group_id = $1 AND user_webid = $2`,
          [groupId, profile.webid]
        );
        if (memberCheck.rowCount > 0) membership = memberCheck.rows[0];
      }

      // Load group posts (timeline)
      let posts = [];
      try {
        const postsResult = await pool.query(
          `SELECT p.id, p.content_text, p.content_html, p.media_urls, p.created_at,
                  pi.username AS handle, pi.display_name AS author_name, pi.avatar_url AS author_avatar
           FROM social_profiles.posts p
           JOIN social_profiles.profile_index pi ON pi.webid = p.webid
           WHERE p.group_id = $1
           ORDER BY p.created_at DESC
           LIMIT 50`,
          [groupId]
        );
        posts = postsResult.rows;
      } catch {
        // group_id column may not exist yet if migration hasn't run
      }

      // Load members
      const membersResult = await pool.query(
        `SELECT m.user_webid, m.role, m.joined_at,
                p.display_name, p.username, p.avatar_url
         FROM social_profiles.group_memberships m
         LEFT JOIN social_profiles.profile_index p ON p.webid = m.user_webid
         WHERE m.group_id = $1
         ORDER BY m.joined_at ASC
         LIMIT 50`,
        [groupId]
      );
      const members = membersResult.rows;

      // Load sub-groups
      const subgroupsResult = await pool.query(
        `SELECT g.id, g.name, g.type, g.path, g.description, g.visibility,
           (SELECT COUNT(*) FROM social_profiles.group_memberships m WHERE m.group_id = g.id) AS member_count
         FROM social_profiles.groups g
         WHERE g.parent_id = $1
         ORDER BY g.name ASC
         LIMIT 50`,
        [groupId]
      );
      const subgroups = subgroupsResult.rows;

      // Group type badge
      const typeBadge = (type) => {
        const colors = {
          ecosystem: 'var(--color-violet-500)', platform: 'var(--color-cyan-500)',
          category: 'var(--color-amber-500)', topic: 'var(--color-green-500)',
          user: 'var(--color-accent)', custom: 'var(--color-text-tertiary)',
        };
        const color = colors[type] || 'var(--color-text-tertiary)';
        return `<span style="display:inline-flex;align-items:center;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.6875rem;font-weight:500;background:${color}22;color:${color};border:1px solid ${color}44;">${escapeHtml(type)}</span>`;
      };

      // Format time ago
      const timeAgo = (d) => {
        const now = new Date();
        const diffMs = now - new Date(d);
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHr / 24);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHr < 24) return `${diffHr}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      };

      // Render posts timeline
      let postsHtml = '';
      if (posts.length > 0) {
        postsHtml = posts.map(p => {
          const authorAvatar = p.author_avatar
            ? `<img src="${escapeHtml(p.author_avatar)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:var(--color-text-inverse);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${escapeHtml((p.author_name || p.handle || '?').charAt(0).toUpperCase())}</div>`;
          const content = p.content_html || escapeHtml(p.content_text);
          return `
          <div style="display:flex;gap:0.75rem;padding:1rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);">
            ${authorAvatar}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                <span style="font-size:0.875rem;font-weight:600;color:var(--color-text-primary);">${escapeHtml(p.author_name || p.handle)}</span>
                <span style="font-size:0.75rem;color:var(--color-text-tertiary);">@${escapeHtml(p.handle)}</span>
                <span style="font-size:0.6875rem;color:var(--color-text-tertiary);">${timeAgo(p.created_at)}</span>
              </div>
              <div style="font-size:0.875rem;color:var(--color-text-primary);line-height:1.5;">${content}</div>
            </div>
          </div>`;
        }).join('\n');
      } else {
        postsHtml = `<div style="text-align:center;padding:2rem;color:var(--color-text-secondary);">No posts in this group yet. Be the first to post!</div>`;
      }

      // Compose form (only shown if member)
      let composeHtml = '';
      if (membership) {
        composeHtml = `
        <div class="section">
          <h2 class="section-title">Post to Group</h2>
          <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;">
            <form id="group-post-form" style="display:flex;flex-direction:column;gap:0.75rem;">
              <textarea class="form-input form-textarea" name="content" placeholder="Write something for ${escapeHtml(group.name)}..." maxlength="500" required style="min-height:80px;resize:vertical;"></textarea>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span id="group-char-count" style="font-size:0.75rem;color:var(--color-text-tertiary);">0 / 500</span>
                <button class="btn btn-primary" type="submit">Post</button>
              </div>
            </form>
            <div id="group-post-result" style="margin-top:0.75rem;font-size:0.875rem;"></div>
            <script>
              (function() {
                var form = document.getElementById('group-post-form');
                var textarea = form.querySelector('textarea');
                var charCount = document.getElementById('group-char-count');
                textarea.addEventListener('input', function() {
                  charCount.textContent = textarea.value.length + ' / 500';
                  charCount.style.color = textarea.value.length > 450 ? (textarea.value.length >= 500 ? 'var(--color-error)' : 'var(--color-warning)') : 'var(--color-text-tertiary)';
                });
                form.addEventListener('submit', async function(e) {
                  e.preventDefault();
                  var content = textarea.value.trim();
                  if (!content) return;
                  var resultEl = document.getElementById('group-post-result');
                  try {
                    var resp = await fetch('/api/post', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content: content, group_id: '${escapeHtml(groupId)}' }),
                    });
                    var data = await resp.json();
                    if (resp.ok) {
                      resultEl.innerHTML = '<span style="color:var(--color-success);">Posted! Reloading...</span>';
                      setTimeout(function() { location.reload(); }, 1000);
                    } else {
                      resultEl.innerHTML = '<span style="color:var(--color-error);">Error: ' + (data.message || 'Unknown error') + '</span>';
                    }
                  } catch (err) {
                    resultEl.innerHTML = '<span style="color:var(--color-error);">Network error: ' + err.message + '</span>';
                  }
                });
              })();
            </script>
          </div>
        </div>`;
      } else {
        composeHtml = `
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.25rem;text-align:center;margin-bottom:1.5rem;">
          <div style="color:var(--color-text-secondary);margin-bottom:0.75rem;">Join this group to post.</div>
          <button class="btn btn-primary" id="join-group-btn">Join Group</button>
          <div id="join-result" style="margin-top:0.75rem;font-size:0.875rem;"></div>
          <script>
            document.getElementById('join-group-btn').addEventListener('click', async function() {
              try {
                var resp = await fetch('/api/group/${escapeHtml(groupId)}/join', { method: 'POST' });
                var data = await resp.json();
                if (resp.ok) {
                  document.getElementById('join-result').innerHTML = '<span style="color:var(--color-success);">Joined! Reloading...</span>';
                  setTimeout(function() { location.reload(); }, 1000);
                } else {
                  document.getElementById('join-result').innerHTML = '<span style="color:var(--color-error);">' + (data.message || 'Error') + '</span>';
                }
              } catch (err) {
                document.getElementById('join-result').innerHTML = '<span style="color:var(--color-error);">Network error</span>';
              }
            });
          </script>
        </div>`;
      }

      // Members section
      let membersHtml = members.map(m => {
        const mAvatar = m.avatar_url
          ? `<img src="${escapeHtml(m.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">`
          : `<div style="width:28px;height:28px;border-radius:50%;background:var(--color-primary);color:var(--color-text-inverse);display:flex;align-items:center;justify-content:center;font-size:0.6875rem;font-weight:600;">${escapeHtml((m.display_name || m.username || '?').charAt(0).toUpperCase())}</div>`;
        return `
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;">
          ${mAvatar}
          <div>
            <span style="font-size:0.8125rem;font-weight:500;color:var(--color-text-primary);">${escapeHtml(m.display_name || m.username || 'Unknown')}</span>
            ${m.username ? `<span style="font-size:0.75rem;color:var(--color-text-tertiary);margin-left:0.25rem;">@${escapeHtml(m.username)}</span>` : ''}
            <span style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-left:0.25rem;">${escapeHtml(m.role)}</span>
          </div>
        </div>`;
      }).join('');

      // Sub-groups section
      let subgroupsHtml = '';
      if (subgroups.length > 0) {
        subgroupsHtml = `
        <div class="section">
          <h2 class="section-title">Sub-Groups (${subgroups.length})</h2>
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            ${subgroups.map(sg => `
              <a href="/studio/groups/${escapeHtml(sg.id)}" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-md);text-decoration:none;color:inherit;">
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span style="font-size:0.875rem;font-weight:500;color:var(--color-text-primary);">${escapeHtml(sg.name)}</span>
                    ${typeBadge(sg.type)}
                  </div>
                  ${sg.description ? `<div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:0.125rem;">${escapeHtml(sg.description)}</div>` : ''}
                  <div style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-top:0.125rem;">${sg.member_count} member${sg.member_count !== 1 ? 's' : ''}</div>
                </div>
              </a>`).join('\n')}
          </div>
        </div>`;
      }

      const pageHtml = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(group.name)} - Groups - Studio</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="stylesheet" href="/static/tokens.css">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --sidebar-width: var(--space-sidebar-width);
      --sidebar-collapsed: var(--space-sidebar-width-collapsed);
      --topbar-height: var(--space-topbar-height);
      --tab-height: var(--space-tab-height);
      --content-max-width: var(--space-content-max-width-studio);
    }
    body { font-family: var(--font-family-primary); background: var(--color-bg-primary); color: var(--color-text-primary); min-height: 100vh; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    a { color: var(--color-primary); text-decoration: none; }
    a:hover { color: var(--color-primary-hover); }

    .studio-topbar { position: fixed; top: 0; left: 0; right: 0; height: var(--topbar-height); background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem; z-index: 100; }
    .topbar-left { display: flex; align-items: center; gap: 1rem; }
    .topbar-logo { font-size: 1rem; font-weight: 600; color: var(--color-primary); text-decoration: none; }
    .topbar-divider { width: 1px; height: 24px; background: var(--color-border-strong); }
    .topbar-title { font-size: 0.875rem; font-weight: 500; color: var(--color-text-primary); }
    .topbar-right { display: flex; align-items: center; gap: 0.75rem; }
    .topbar-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: flex; align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 600; border: 2px solid var(--color-border-strong); }

    .studio-sidebar { position: fixed; top: var(--topbar-height); left: 0; bottom: 0; width: var(--sidebar-width); background: var(--color-bg-secondary); border-right: 1px solid var(--color-border); padding: 1rem 0; display: flex; flex-direction: column; z-index: 100; }
    .sidebar-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; margin: 0 0.5rem; border-radius: var(--radius-md); color: var(--color-text-secondary); text-decoration: none; font-size: 0.875rem; font-weight: 400; transition: background 0.15s, color 0.15s; min-height: 44px; }
    .sidebar-item:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
    .sidebar-item.active { background: var(--color-primary-light); color: var(--color-text-primary); font-weight: 500; }

    .studio-content { margin-top: var(--topbar-height); margin-left: var(--sidebar-width); padding: 1.5rem; min-height: calc(100vh - var(--topbar-height)); }
    .studio-content-inner { max-width: 1280px; margin: 0 auto; }

    .page-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .page-title { font-size: 1.5rem; font-weight: 600; color: var(--color-text-primary); }

    .section { margin-bottom: 1.5rem; }
    .section-title { font-size: 1.25rem; font-weight: 500; color: var(--color-text-primary); margin-bottom: 1rem; }

    .btn { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--font-family-primary); font-size: 0.875rem; font-weight: 500; border: none; border-radius: var(--radius-pill); cursor: pointer; transition: background 0.15s; text-decoration: none; min-height: 44px; padding: 0.75rem 1.5rem; }
    .btn-primary { background: var(--color-primary); color: var(--color-text-inverse); }
    .btn-primary:hover { background: var(--color-primary-hover); color: var(--color-text-inverse); }
    .btn-secondary { background: transparent; border: 1px solid var(--color-border-strong); color: var(--color-text-primary); }
    .btn-secondary:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }

    .form-field { display: flex; flex-direction: column; gap: 0.5rem; }
    .form-label { font-size: 0.875rem; font-weight: 500; color: var(--color-text-primary); }
    .form-input, .form-select { background: var(--color-bg-tertiary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; font-size: 1rem; font-family: var(--font-family-primary); color: var(--color-text-primary); min-height: 44px; width: 100%; }
    .form-input:focus, .form-select:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.5); }
    .form-textarea { min-height: 80px; resize: vertical; }

    @media (max-width: 767px) {
      .studio-sidebar { display: none; }
      .studio-content { margin-left: 0; padding: 1rem; }
    }
  </style>
</head>
<body>
  <header class="studio-topbar">
    <div class="topbar-left">
      <a href="/studio" class="topbar-logo">Studio</a>
      <div class="topbar-divider"></div>
      <a href="/studio/groups" style="font-size:0.875rem;color:var(--color-text-secondary);text-decoration:none;">Groups</a>
      <div class="topbar-divider"></div>
      <span class="topbar-title">${escapeHtml(group.name)}</span>
    </div>
    <div class="topbar-right">
      ${avatarHtml}
    </div>
  </header>

  <nav class="studio-sidebar">
    <a class="sidebar-item" href="/studio">Dashboard</a>
    <a class="sidebar-item" href="/studio/feed">Feed</a>
    <a class="sidebar-item" href="/studio/links">Links</a>
    <a class="sidebar-item active" href="/studio/groups">Groups</a>
    <a class="sidebar-item" href="/studio/analytics">Analytics</a>
    <a class="sidebar-item" href="/studio/customize">Customize</a>
    <a class="sidebar-item" href="/studio/settings">Settings</a>
  </nav>

  <main class="studio-content">
    <div class="studio-content-inner">
      <!-- Group Header -->
      <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:1.5rem;">
        <div style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
              <h1 style="font-size:1.5rem;font-weight:600;color:var(--color-text-primary);">${escapeHtml(group.name)}</h1>
              ${typeBadge(group.type)}
              ${membership ? `<span style="display:inline-flex;align-items:center;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.6875rem;font-weight:500;background:var(--color-success)22;color:var(--color-success);border:1px solid var(--color-success)44;">${escapeHtml(membership.role)}</span>` : ''}
            </div>
            ${group.description ? `<p style="font-size:0.875rem;color:var(--color-text-secondary);margin-bottom:0.5rem;">${escapeHtml(group.description)}</p>` : ''}
            <div style="display:flex;gap:1.5rem;font-size:0.8125rem;color:var(--color-text-tertiary);">
              <span>${group.member_count} member${group.member_count !== 1 ? 's' : ''}</span>
              <span>${posts.length} post${posts.length !== 1 ? 's' : ''}</span>
              ${group.child_count > 0 ? `<span>${group.child_count} sub-group${group.child_count !== 1 ? 's' : ''}</span>` : ''}
              <span>${escapeHtml(group.visibility)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Compose / Join -->
      ${composeHtml}

      <!-- Timeline -->
      <div class="section">
        <h2 class="section-title">Timeline</h2>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${postsHtml}
        </div>
      </div>

      <!-- Sub-Groups -->
      ${subgroupsHtml}

      <!-- Members -->
      <div class="section">
        <h2 class="section-title">Members (${members.length})</h2>
        <div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1rem;">
          ${membersHtml || '<div style="color:var(--color-text-secondary);">No members yet.</div>'}
        </div>
      </div>
    </div>
  </main>
</body>
</html>`;

      sendHtml(res, 200, pageHtml);
    },
  });
}

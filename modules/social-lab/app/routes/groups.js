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
// GET    /api/group/:id/posts     — List posts in this group (placeholder)

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import {
  json, parseUrl, readJsonBody, BASE_URL, SUBDOMAIN, DOMAIN,
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
  const domain = `${SUBDOMAIN}.${DOMAIN}`;
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
  // GET /api/group/:id/posts — List posts in this group (placeholder)
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/group\/([a-zA-Z0-9_-]+)\/posts$/,
    handler: async (req, res, matches) => {
      const groupId = matches[1];

      // Phase 1: posts-in-groups not yet wired (requires AS2 context field on posts table)
      // Return empty for now, with a note about future implementation
      json(res, 200, {
        posts: [],
        count: 0,
        note: 'Group posts require AS2 context field on posts table. Coming in Phase 2 (Content Flow).',
      });
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
          <div style="display:flex;align-items:center;gap:0.75rem;padding:1rem 1.25rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);transition:border-color 0.15s;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span style="font-size:0.875rem;font-weight:600;color:var(--color-text-primary);">${escapeHtml(g.name)}</span>
                ${typeBadge(g.type)}
                <span style="font-size:0.6875rem;color:var(--color-text-tertiary);">${escapeHtml(g.role)}</span>
              </div>
              ${g.description ? `<div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:0.25rem;">${escapeHtml(g.description)}</div>` : ''}
              <div style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-top:0.25rem;">${g.member_count} member${g.member_count !== 1 ? 's' : ''} &middot; ${escapeHtml(g.path)}</div>
            </div>
          </div>`).join('\n');
      } else {
        myGroupsHtml = `
          <div style="text-align:center;padding:2rem;color:var(--color-text-secondary);">
            <div style="font-size:1.125rem;font-weight:500;color:var(--color-text-primary);margin-bottom:0.25rem;">No groups yet</div>
            <div>Join a group or create one below.</div>
          </div>`;
      }

      // Render all groups for browsing
      let browseHtml = allGroups.map(g => `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-md);transition:border-color 0.15s;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <span style="font-size:0.875rem;font-weight:500;color:var(--color-text-primary);">${escapeHtml(g.name)}</span>
              ${typeBadge(g.type)}
            </div>
            ${g.description ? `<div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:0.125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.description)}</div>` : ''}
            <div style="font-size:0.6875rem;color:var(--color-text-tertiary);margin-top:0.125rem;">${g.member_count} member${g.member_count !== 1 ? 's' : ''}${g.taxonomy_type ? ` &middot; ${escapeHtml(g.taxonomy_type)}` : ''}</div>
          </div>
        </div>`).join('\n');

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
            <div>GET /api/group/:id</div>
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
}

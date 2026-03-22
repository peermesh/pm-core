// =============================================================================
// Bio Links Route — GET /api/profile/:id/links
// =============================================================================

import { pool } from '../db.js';
import { json, getBioLinks } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // GET /api/profile/:id/links — List bio links for a profile
  routes.push({
    method: 'GET',
    pattern: /^\/api\/profile\/([^/]+)\/links$/,
    handler: async (req, res, matches) => {
      const profileId = matches[1];

      const profileResult = await pool.query(
        'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
        [profileId]
      );

      if (profileResult.rowCount === 0) {
        return json(res, 404, { error: 'Not Found', message: `Profile ${profileId} not found` });
      }

      const links = await getBioLinks(pool, profileResult.rows[0].webid);
      json(res, 200, { links, count: links.length });
    },
  });
}

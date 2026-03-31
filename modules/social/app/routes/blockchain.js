// =============================================================================
// Blockchain Protocol Routes (Lens + Farcaster)
// =============================================================================
// GET /api/lens/profile/:handle        — Lens Profile mapping (stub)
// GET /api/farcaster/identity/:handle  — Farcaster FID mapping (stub, opt-in)
//
// Both endpoints are thin protocol surface stubs per F-017 and F-018 blueprints.
// Lens integration is an optional Omni-Account protocol adapter.
// Farcaster integration is low-priority, behind a feature flag concept,
// and user-initiated only. Protocol viability is uncertain.

import { pool } from '../db.js';
import { json, jsonStubSurface, lookupProfileByHandle, BASE_URL } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // GET /api/lens/profile/:handle — Lens Profile mapping
  //
  // Returns the Lens Profile ID for a given handle, if provisioned.
  // Phase 1 stub: returns the stored lens_profile_id or a placeholder
  // indicating the profile has not yet been linked to Lens Protocol.
  routes.push({
    method: 'GET',
    pattern: /^\/api\/lens\/profile\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      // Query for lens_profile_id (column added by migration 010)
      const result = await pool.query(
        `SELECT lens_profile_id FROM social_profiles.profile_index WHERE id = $1`,
        [profile.id]
      );

      const lensProfileId = result.rows[0]?.lens_profile_id || null;

      jsonStubSurface(res, 200, {
        handle: profile.username,
        webid: profile.webid,
        lens: {
          profileId: lensProfileId,
          linked: lensProfileId !== null,
          protocol: 'lens',
          network: 'polygon',
          status: lensProfileId ? 'active' : 'not_provisioned',
          note: lensProfileId
            ? undefined
            : 'Lens Profile not yet provisioned. Auto-provision or link-existing available via Omni-Account pipeline.',
        },
        _links: {
          self: `${BASE_URL}/api/lens/profile/${handle}`,
          profile: `${BASE_URL}/api/profile/${profile.id}`,
        },
      });
    },
  });

  // GET /api/farcaster/identity/:handle — Farcaster FID mapping
  //
  // Returns the Farcaster ID (FID) for a given handle, if the user
  // has opted in. Farcaster integration is explicitly low-priority
  // and behind a feature flag concept. Returns null if not configured.
  // Per F-018: user-initiated opt-in only, never auto-provisioned.
  routes.push({
    method: 'GET',
    pattern: /^\/api\/farcaster\/identity\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      // Query for farcaster_fid (column added by migration 010)
      const result = await pool.query(
        `SELECT farcaster_fid FROM social_profiles.profile_index WHERE id = $1`,
        [profile.id]
      );

      const farcasterFid = result.rows[0]?.farcaster_fid || null;

      jsonStubSurface(res, 200, {
        handle: profile.username,
        webid: profile.webid,
        farcaster: {
          fid: farcasterFid,
          linked: farcasterFid !== null,
          protocol: 'farcaster',
          network: 'optimism',
          optInOnly: true,
          featureFlag: 'farcaster_enabled',
          status: farcasterFid ? 'active' : 'not_configured',
          protocolHealthWarning: 'Farcaster protocol long-term viability uncertain as of 2026-03-20. This is a thin adapter integration.',
          note: farcasterFid
            ? undefined
            : 'Farcaster FID not configured. Opt-in via Social settings. This integration is behind a feature flag.',
        },
        _links: {
          self: `${BASE_URL}/api/farcaster/identity/${handle}`,
          profile: `${BASE_URL}/api/profile/${profile.id}`,
        },
      });
    },
  });
}

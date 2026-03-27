// =============================================================================
// Notification Routes — Push Subscription & Notification Management
// =============================================================================
// POST   /api/notifications/subscribe      — Register push subscription
// DELETE /api/notifications/subscribe      — Unsubscribe
// GET    /api/notifications                — List recent notifications
// PUT    /api/notifications/:id/read       — Mark notification as read
// GET    /api/notifications/preferences    — Get notification preferences
// PUT    /api/notifications/preferences    — Update notification preferences
// GET    /api/notifications/vapid-key      — Get VAPID public key
//
// All routes require authentication (session cookie).
// Blueprint: F-029 (Push Notification Unification)

import { pool } from '../db.js';
import { json, readJsonBody, parseUrl, BASE_URL } from '../lib/helpers.js';
import { getSession } from '../lib/session.js';
import { getVapidPublicKey } from '../lib/webpush.js';

// =============================================================================
// Auth helper — returns user session or sends 401
// =============================================================================

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: 'Authentication required' });
    return null;
  }
  return session;
}

/**
 * Derive user_webid from session profileId.
 * Matches the pattern used in auth.js signup.
 */
function getWebId(session) {
  return `${BASE_URL}/profile/${session.profileId}#me`;
}

// =============================================================================
// Route Registration
// =============================================================================

export default function registerRoutes(routes) {

  // ─── GET /api/notifications/vapid-key — Public VAPID key for client ───

  routes.push({
    method: 'GET',
    pattern: '/api/notifications/vapid-key',
    handler: async (req, res) => {
      json(res, 200, { publicKey: getVapidPublicKey() });
    },
  });

  // ─── POST /api/notifications/subscribe — Register push subscription ───

  routes.push({
    method: 'POST',
    pattern: '/api/notifications/subscribe',
    handler: async (req, res) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const { parsed: body } = await readJsonBody(req);
      if (!body) {
        return json(res, 400, { error: 'Request body required' });
      }

      const { endpoint, keys, transport, userAgent } = body;

      // Validate required fields
      if (!endpoint || typeof endpoint !== 'string') {
        return json(res, 400, { error: 'endpoint is required and must be a string' });
      }
      if (!keys || !keys.p256dh || !keys.auth) {
        return json(res, 400, { error: 'keys.p256dh and keys.auth are required' });
      }

      const userWebid = getWebId(session);
      const transportValue = transport === 'unifiedpush' ? 'unifiedpush' : 'webpush';

      try {
        // Upsert subscription (update keys if endpoint already registered)
        await pool.query(
          `INSERT INTO social_profiles.notification_subscriptions
             (user_webid, endpoint, p256dh_key, auth_key, transport, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_webid, endpoint)
           DO UPDATE SET
             p256dh_key = EXCLUDED.p256dh_key,
             auth_key = EXCLUDED.auth_key,
             transport = EXCLUDED.transport,
             user_agent = EXCLUDED.user_agent`,
          [userWebid, endpoint, keys.p256dh, keys.auth, transportValue, userAgent || null]
        );

        console.log(`[notifications] Subscription registered for ${session.username} (${transportValue})`);
        json(res, 201, { ok: true, transport: transportValue });
      } catch (err) {
        console.error('[notifications] Subscribe error:', err.message);
        json(res, 500, { error: 'Failed to register subscription' });
      }
    },
  });

  // ─── DELETE /api/notifications/subscribe — Unsubscribe ───

  routes.push({
    method: 'DELETE',
    pattern: '/api/notifications/subscribe',
    handler: async (req, res) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const { parsed: body } = await readJsonBody(req);
      if (!body || !body.endpoint) {
        return json(res, 400, { error: 'endpoint is required' });
      }

      const userWebid = getWebId(session);

      try {
        const result = await pool.query(
          `DELETE FROM social_profiles.notification_subscriptions
           WHERE user_webid = $1 AND endpoint = $2`,
          [userWebid, body.endpoint]
        );

        if (result.rowCount === 0) {
          return json(res, 404, { error: 'Subscription not found' });
        }

        console.log(`[notifications] Subscription removed for ${session.username}`);
        json(res, 200, { ok: true });
      } catch (err) {
        console.error('[notifications] Unsubscribe error:', err.message);
        json(res, 500, { error: 'Failed to remove subscription' });
      }
    },
  });

  // ─── GET /api/notifications — List recent notifications ───

  routes.push({
    method: 'GET',
    pattern: '/api/notifications',
    handler: async (req, res) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const userWebid = getWebId(session);
      const { searchParams } = parseUrl(req);
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
      const unreadOnly = searchParams.get('unread') === 'true';

      try {
        let query = `
          SELECT id, type, title, body, icon, data, priority,
                 protocol_origin, canonical_id, tag, sent_at, read_at, dismissed_at
          FROM social_profiles.notification_log
          WHERE user_webid = $1`;
        const params = [userWebid];

        if (unreadOnly) {
          query += ' AND read_at IS NULL';
        }

        query += ' ORDER BY sent_at DESC LIMIT $2 OFFSET $3';
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Also get unread count
        const countResult = await pool.query(
          `SELECT COUNT(*) as unread_count
           FROM social_profiles.notification_log
           WHERE user_webid = $1 AND read_at IS NULL`,
          [userWebid]
        );

        json(res, 200, {
          notifications: result.rows,
          unreadCount: parseInt(countResult.rows[0].unread_count, 10),
          limit,
          offset,
        });
      } catch (err) {
        console.error('[notifications] List error:', err.message);
        json(res, 500, { error: 'Failed to fetch notifications' });
      }
    },
  });

  // ─── PUT /api/notifications/:id/read — Mark as read ───

  routes.push({
    method: 'PUT',
    pattern: /^\/api\/notifications\/([^/]+)\/read$/,
    handler: async (req, res, match) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const notificationId = match[1];
      const userWebid = getWebId(session);

      try {
        const result = await pool.query(
          `UPDATE social_profiles.notification_log
           SET read_at = NOW()
           WHERE id = $1 AND user_webid = $2 AND read_at IS NULL`,
          [notificationId, userWebid]
        );

        if (result.rowCount === 0) {
          return json(res, 404, { error: 'Notification not found or already read' });
        }

        json(res, 200, { ok: true, id: notificationId });
      } catch (err) {
        console.error('[notifications] Mark read error:', err.message);
        json(res, 500, { error: 'Failed to mark notification as read' });
      }
    },
  });

  // ─── GET /api/notifications/preferences — Get preferences ───

  routes.push({
    method: 'GET',
    pattern: '/api/notifications/preferences',
    handler: async (req, res) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const userWebid = getWebId(session);

      try {
        const result = await pool.query(
          `SELECT id, notification_type, protocol_source, enabled, delivery, updated_at
           FROM social_profiles.notification_preferences
           WHERE user_webid = $1
           ORDER BY notification_type, protocol_source`,
          [userWebid]
        );

        json(res, 200, { preferences: result.rows });
      } catch (err) {
        console.error('[notifications] Get preferences error:', err.message);
        json(res, 500, { error: 'Failed to fetch preferences' });
      }
    },
  });

  // ─── PUT /api/notifications/preferences — Update preferences ───

  routes.push({
    method: 'PUT',
    pattern: '/api/notifications/preferences',
    handler: async (req, res) => {
      const session = requireAuth(req, res);
      if (!session) return;

      const { parsed: body } = await readJsonBody(req);
      if (!body || !Array.isArray(body.preferences)) {
        return json(res, 400, { error: 'preferences array is required' });
      }

      const userWebid = getWebId(session);

      // Validate notification types and delivery methods
      const validTypes = ['follow', 'like', 'repost', 'reply', 'mention', 'dm', 'moderation', 'zap', '*'];
      const validProtocols = ['ap', 'at', 'nostr', 'matrix', 'indieweb', '*', null];
      const validDelivery = ['push', 'in-app', 'email', 'none'];

      try {
        for (const pref of body.preferences) {
          if (!validTypes.includes(pref.notification_type)) {
            return json(res, 400, {
              error: `Invalid notification_type: ${pref.notification_type}`,
            });
          }
          if (!validProtocols.includes(pref.protocol_source ?? null)) {
            return json(res, 400, {
              error: `Invalid protocol_source: ${pref.protocol_source}`,
            });
          }
          if (pref.delivery && !validDelivery.includes(pref.delivery)) {
            return json(res, 400, {
              error: `Invalid delivery method: ${pref.delivery}`,
            });
          }

          // Upsert each preference
          await pool.query(
            `INSERT INTO social_profiles.notification_preferences
               (user_webid, notification_type, protocol_source, enabled, delivery)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_webid, notification_type, protocol_source)
             DO UPDATE SET
               enabled = EXCLUDED.enabled,
               delivery = EXCLUDED.delivery`,
            [
              userWebid,
              pref.notification_type,
              pref.protocol_source || '*',
              pref.enabled !== false,
              pref.delivery || 'push',
            ]
          );
        }

        console.log(`[notifications] Preferences updated for ${session.username} (${body.preferences.length} rules)`);
        json(res, 200, { ok: true, updated: body.preferences.length });
      } catch (err) {
        console.error('[notifications] Update preferences error:', err.message);
        json(res, 500, { error: 'Failed to update preferences' });
      }
    },
  });
}

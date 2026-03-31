// =============================================================================
// Recovery API — baseline (F-027)
// =============================================================================
// GET  /api/recovery/status     — public: schema + capability flags
// GET  /api/recovery/passphrase — session: passphrase backup status
// POST /api/recovery/passphrase — session: create/replace passphrase backup
// GET  /api/recovery/social     — session: social recovery (share) status
// POST /api/recovery/social     — session: accept setup parameters (baseline)
//
// Studio links (studio.js) use GET /api/recovery/passphrase and
// GET /api/recovery/social as entry points; they return JSON for the SPA or
// API clients. If migration 023 is not applied, responses are degraded and
// never throw from missing tables.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { json, readJsonBody } from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';
import { createPassphraseBackup } from '../lib/recovery.js';

const RECOVERY_TABLES = ['recovery_backups', 'recovery_shares', 'recovery_attempts'];

/**
 * Detect whether recovery DDL from migration 023 is present.
 * Uses information_schema so missing tables do not raise SQL errors.
 * @param {import('pg').Pool} db
 * @returns {Promise<{ available: boolean, not_configured?: boolean, unavailable?: boolean, tables_found?: number, reason?: string, error_code?: string, message?: string }>}
 */
export async function getRecoveryDatabaseState(db) {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM information_schema.tables
       WHERE table_schema = 'social_keys'
         AND table_name = ANY($1::text[])`,
      [RECOVERY_TABLES]
    );
    const n = r.rows[0]?.n ?? 0;
    if (n === RECOVERY_TABLES.length) {
      return { available: true, tables_ready: true };
    }
    return {
      available: false,
      not_configured: true,
      unavailable: true,
      tables_found: n,
      reason: 'recovery_tables_incomplete_or_missing',
    };
  } catch (err) {
    return {
      available: false,
      unavailable: true,
      not_configured: false,
      reason: 'database_error',
      error_code: err.code,
      message: err.message,
    };
  }
}

async function resolveWebId(session) {
  if (!session?.profileId) return null;
  const result = await pool.query(
    'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
    [session.profileId]
  );
  return result.rowCount > 0 ? result.rows[0].webid : null;
}

function degradedPayload(dbState, extra = {}) {
  return {
    recovery: {
      degraded: true,
      unavailable: true,
      not_configured: dbState.not_configured === true,
      database: dbState,
      ...extra,
    },
  };
}

export default function registerRoutes(routes) {
  // -------------------------------------------------------------------------
  // GET /api/recovery/status — public
  // -------------------------------------------------------------------------
  routes.push({
    method: 'GET',
    pattern: '/api/recovery/status',
    handler: async (req, res) => {
      const dbState = await getRecoveryDatabaseState(pool);
      json(res, 200, {
        recovery: {
          service: 'account-recovery',
          database: dbState,
          capabilities: {
            passphrase_backup: dbState.available === true,
            social_recovery: dbState.available === true,
          },
          endpoints: {
            status: '/api/recovery/status',
            passphrase: '/api/recovery/passphrase',
            social: '/api/recovery/social',
          },
        },
      });
    },
  });

  // -------------------------------------------------------------------------
  // GET /api/recovery/passphrase
  // -------------------------------------------------------------------------
  routes.push({
    method: 'GET',
    pattern: '/api/recovery/passphrase',
    handler: async (req, res) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const dbState = await getRecoveryDatabaseState(pool);
      if (!dbState.available) {
        return json(res, 200, degradedPayload(dbState, {
          passphrase: { configured: false },
        }));
      }

      const webid = await resolveWebId(session);
      if (!webid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      const row = await pool.query(
        `SELECT id, created_at, key_derivation, is_active
         FROM social_keys.recovery_backups
         WHERE user_webid = $1 AND is_active = TRUE
         LIMIT 1`,
        [webid]
      );

      json(res, 200, {
        recovery: {
          database: dbState,
          passphrase: {
            configured: row.rowCount > 0,
            backup_id: row.rowCount > 0 ? row.rows[0].id : null,
            created_at: row.rowCount > 0 ? row.rows[0].created_at : null,
            key_derivation: row.rowCount > 0 ? row.rows[0].key_derivation : null,
          },
        },
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/recovery/passphrase
  // Body: { passphrase: string, keys?: object }
  // -------------------------------------------------------------------------
  routes.push({
    method: 'POST',
    pattern: '/api/recovery/passphrase',
    handler: async (req, res) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const dbState = await getRecoveryDatabaseState(pool);
      if (!dbState.available) {
        return json(res, 200, {
          ...degradedPayload(dbState),
          success: false,
        });
      }

      const webid = await resolveWebId(session);
      if (!webid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch {
        return json(res, 400, { error: 'Bad Request', message: 'Invalid JSON body.' });
      }

      const passphrase = body?.passphrase;
      if (!passphrase || typeof passphrase !== 'string') {
        return json(res, 400, { error: 'Bad Request', message: 'passphrase is required.' });
      }

      const keys = body?.keys && typeof body.keys === 'object'
        ? body.keys
        : { masterKey: randomUUID(), createdAt: new Date().toISOString() };

      let backup;
      try {
        backup = await createPassphraseBackup(keys, passphrase);
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      const ins = await pool.query(
        `INSERT INTO social_keys.recovery_backups
           (id, user_webid, encrypted_blob, salt, iv, auth_tag, key_derivation, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (user_webid) DO UPDATE SET
           encrypted_blob = EXCLUDED.encrypted_blob,
           salt = EXCLUDED.salt,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_derivation = EXCLUDED.key_derivation,
           is_active = TRUE,
           created_at = NOW()
         RETURNING id`,
        [
          randomUUID(),
          webid,
          backup.encryptedBlob,
          backup.salt,
          backup.iv,
          backup.authTag,
          backup.keyDerivation,
        ]
      );

      json(res, 201, {
        recovery: {
          success: true,
          passphrase: {
            configured: true,
            backup_id: ins.rows[0].id,
            key_derivation: backup.keyDerivation,
          },
        },
      });
    },
  });

  // -------------------------------------------------------------------------
  // GET /api/recovery/social
  // -------------------------------------------------------------------------
  routes.push({
    method: 'GET',
    pattern: '/api/recovery/social',
    handler: async (req, res) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const dbState = await getRecoveryDatabaseState(pool);
      if (!dbState.available) {
        return json(res, 200, degradedPayload(dbState, {
          social: { configured: false, share_count: 0 },
        }));
      }

      const webid = await resolveWebId(session);
      if (!webid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      const agg = await pool.query(
        `SELECT
           COUNT(*)::int AS share_count,
           MAX(threshold) AS threshold,
           MAX(total_shares) AS total_shares
         FROM social_keys.recovery_shares
         WHERE user_webid = $1`,
        [webid]
      );

      const row = agg.rows[0];
      const shareCount = row.share_count ?? 0;

      json(res, 200, {
        recovery: {
          database: dbState,
          social: {
            configured: shareCount > 0,
            share_count: shareCount,
            threshold: row.threshold,
            total_shares: row.total_shares,
          },
        },
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /api/recovery/social — baseline: validate intended K-of-N setup
  // -------------------------------------------------------------------------
  routes.push({
    method: 'POST',
    pattern: '/api/recovery/social',
    handler: async (req, res) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const dbState = await getRecoveryDatabaseState(pool);
      if (!dbState.available) {
        return json(res, 200, {
          ...degradedPayload(dbState),
          success: false,
        });
      }

      const webid = await resolveWebId(session);
      if (!webid) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch {
        return json(res, 400, { error: 'Bad Request', message: 'Invalid JSON body.' });
      }

      const threshold = body?.threshold;
      const totalShares = body?.totalShares ?? body?.total_shares;
      if (typeof threshold !== 'number' || typeof totalShares !== 'number') {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'threshold and totalShares (numbers) are required.',
        });
      }
      if (threshold < 2 || threshold > 10 || totalShares < threshold || totalShares > 10) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'threshold must be 2–10, totalShares must be >= threshold and <= 10.',
        });
      }

      json(res, 200, {
        recovery: {
          success: true,
          social: {
            user_webid: webid,
            threshold,
            total_shares: totalShares,
            note: 'baseline: distribute wrapped shares to trustees; persistence uses recovery_shares when shares are submitted.',
          },
        },
      });
    },
  });
}

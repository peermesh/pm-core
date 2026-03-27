// =============================================================================
// Encryption API Routes — Phase 1 (AES-256-GCM)
// =============================================================================
// Blueprint: ARCH-005 (Encryption & Security Architecture)
//            F-019    (MLS Integration — Phase 1 foundation)
//
// POST   /api/encryption/group/:groupId/init    — Initialize encryption for a group
// POST   /api/encryption/group/:groupId/encrypt — Encrypt content for group members
// POST   /api/encryption/group/:groupId/decrypt — Decrypt content
// GET    /api/encryption/group/:groupId/status  — Encryption status for a group
//
// POST   /api/encryption/group/:groupId/member/add    — Add member to encryption group
// POST   /api/encryption/group/:groupId/member/remove — Remove member (triggers key rotation)
//
// All routes require authentication.
// Phase 1 uses AesGcmProvider; Phase 2 swaps to MlsEncryptionProvider
// via the EncryptionProviderRegistry.
// =============================================================================

import { pool } from '../db.js';
import {
  json, readJsonBody,
} from '../lib/helpers.js';
import { requireAuth } from '../lib/session.js';
import { encryptionRegistry } from '../lib/encryption-provider.js';
import { AesGcmProvider } from '../lib/aes-gcm-provider.js';

// ---------------------------------------------------------------------------
// Bootstrap: register the Phase 1 AES-GCM provider
// ---------------------------------------------------------------------------
try {
  const aesProvider = new AesGcmProvider(pool);
  encryptionRegistry.register(aesProvider, true);
} catch (err) {
  console.error('[encryption] Failed to register AES-GCM provider:', err.message);
}

// ---------------------------------------------------------------------------
// Helper: resolve the authenticated user's WebID from session
// ---------------------------------------------------------------------------
async function resolveWebId(session) {
  if (!session || !session.profileId) return null;
  const result = await pool.query(
    'SELECT webid FROM social_profiles.profile_index WHERE id = $1',
    [session.profileId]
  );
  return result.rowCount > 0 ? result.rows[0].webid : null;
}

// ---------------------------------------------------------------------------
// Helper: check if a user is a member of the social group (group_memberships)
// ---------------------------------------------------------------------------
async function isGroupMember(groupId, webId) {
  const result = await pool.query(
    `SELECT id FROM social_profiles.group_memberships
     WHERE group_id = $1 AND user_webid = $2`,
    [groupId, webId]
  );
  return result.rowCount > 0;
}

// =============================================================================
// Route Registration
// =============================================================================

export default function registerRoutes(routes) {

  // =========================================================================
  // POST /api/encryption/group/:groupId/init
  // Initialize encryption for a group.
  // Body: { members?: string[] }  (optional explicit member list)
  // If members not provided, fetches from group_memberships.
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/init$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];
      const webId = await resolveWebId(session);
      if (!webId) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      // Verify the caller is a group member
      const isMember = await isGroupMember(groupId, webId);
      if (!isMember) {
        return json(res, 403, { error: 'Forbidden', message: 'You must be a group member to initialize encryption.' });
      }

      let body = {};
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch {
        // Body is optional
        body = {};
      }

      // Get members: from body or from group_memberships
      let members = body?.members;
      if (!members || members.length === 0) {
        const membersResult = await pool.query(
          `SELECT user_webid FROM social_profiles.group_memberships WHERE group_id = $1`,
          [groupId]
        );
        members = membersResult.rows.map(r => r.user_webid);
      }

      if (members.length === 0) {
        return json(res, 400, { error: 'Bad Request', message: 'No members found for this group.' });
      }

      try {
        const provider = encryptionRegistry.getDefault();
        const handle = await provider.createGroup(groupId, { memberWebIds: members });
        json(res, 201, {
          encryption: handle,
          provider: provider.providerId,
        });
      } catch (err) {
        console.error(`[encryption] Init error for ${groupId}:`, err.message);

        // Distinguish "already exists" from other errors
        if (err.message.includes('already exists')) {
          return json(res, 409, { error: 'Conflict', message: err.message });
        }
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/encryption/group/:groupId/encrypt
  // Encrypt content for group members.
  // Body: { plaintext: string }
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/encrypt$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];
      const webId = await resolveWebId(session);
      if (!webId) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.plaintext) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: plaintext' });
      }

      try {
        const provider = encryptionRegistry.getDefault();
        const encrypted = await provider.encrypt(groupId, body.plaintext);
        json(res, 200, { encrypted });
      } catch (err) {
        console.error(`[encryption] Encrypt error for ${groupId}:`, err.message);

        if (err.message.includes('not found')) {
          return json(res, 404, { error: 'Not Found', message: err.message });
        }
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/encryption/group/:groupId/decrypt
  // Decrypt content.
  // Body: { ciphertext, iv, tag, epoch, algorithm }
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/decrypt$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];
      const webId = await resolveWebId(session);
      if (!webId) {
        return json(res, 400, { error: 'Bad Request', message: 'No profile associated with session.' });
      }

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.ciphertext || !body.iv || !body.tag || body.epoch == null) {
        return json(res, 400, {
          error: 'Bad Request',
          message: 'Missing required fields: ciphertext, iv, tag, epoch',
        });
      }

      try {
        const provider = encryptionRegistry.getDefault();
        const decrypted = await provider.decrypt(groupId, {
          ciphertext: body.ciphertext,
          iv: body.iv,
          tag: body.tag,
          epoch: body.epoch,
          algorithm: body.algorithm || 'aes-256-gcm',
        });
        json(res, 200, { plaintext: decrypted.toString('utf8') });
      } catch (err) {
        console.error(`[encryption] Decrypt error for ${groupId}:`, err.message);

        if (err.message.includes('not found')) {
          return json(res, 404, { error: 'Not Found', message: err.message });
        }
        // GCM auth failure
        if (err.message.includes('Unsupported state') || err.code === 'ERR_OSSL_EVP_BAD_DECRYPT') {
          return json(res, 400, { error: 'Bad Request', message: 'Decryption failed: invalid ciphertext or key.' });
        }
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // GET /api/encryption/group/:groupId/status
  // Get encryption status for a group.
  // =========================================================================
  routes.push({
    method: 'GET',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/status$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];

      try {
        const provider = encryptionRegistry.getDefault();
        const status = await provider.getGroupStatus(groupId);

        if (!status) {
          return json(res, 200, {
            groupId,
            encrypted: false,
            message: 'Encryption not initialized for this group.',
          });
        }

        json(res, 200, {
          groupId,
          encrypted: true,
          provider: provider.providerId,
          capabilities: provider.capabilities,
          ...status,
        });
      } catch (err) {
        console.error(`[encryption] Status error for ${groupId}:`, err.message);
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/encryption/group/:groupId/member/add
  // Add a member to the encryption group.
  // Body: { memberWebId: string }
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/member\/add$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.memberWebId) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: memberWebId' });
      }

      try {
        const provider = encryptionRegistry.getDefault();
        const result = await provider.addMember(groupId, body.memberWebId);
        json(res, 200, { update: result });
      } catch (err) {
        console.error(`[encryption] Add member error for ${groupId}:`, err.message);

        if (err.message.includes('not found')) {
          return json(res, 404, { error: 'Not Found', message: err.message });
        }
        if (err.message.includes('already in')) {
          return json(res, 409, { error: 'Conflict', message: err.message });
        }
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });

  // =========================================================================
  // POST /api/encryption/group/:groupId/member/remove
  // Remove a member from the encryption group (triggers key rotation).
  // Body: { memberWebId: string }
  // =========================================================================
  routes.push({
    method: 'POST',
    pattern: /^\/api\/encryption\/group\/([a-zA-Z0-9_:-]+)\/member\/remove$/,
    handler: async (req, res, matches) => {
      const session = requireAuth(req);
      if (!session) {
        return json(res, 401, { error: 'Unauthorized', message: 'Authentication required.' });
      }

      const groupId = matches[1];

      let body;
      try {
        ({ parsed: body } = await readJsonBody(req));
      } catch (err) {
        return json(res, 400, { error: 'Bad Request', message: err.message });
      }

      if (!body || !body.memberWebId) {
        return json(res, 400, { error: 'Bad Request', message: 'Missing required field: memberWebId' });
      }

      try {
        const provider = encryptionRegistry.getDefault();
        const result = await provider.removeMember(groupId, body.memberWebId);
        json(res, 200, {
          update: result,
          message: 'Member removed. Key rotated for forward secrecy.',
        });
      } catch (err) {
        console.error(`[encryption] Remove member error for ${groupId}:`, err.message);

        if (err.message.includes('not found') || err.message.includes('not in')) {
          return json(res, 404, { error: 'Not Found', message: err.message });
        }
        json(res, 500, { error: 'Internal Server Error', message: err.message });
      }
    },
  });
}

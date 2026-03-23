// =============================================================================
// AES-256-GCM Encryption Provider (Phase 1)
// =============================================================================
// Blueprint: ARCH-005 Mechanic 7 (Encryption Layer Modularity)
//            ARCH-005 Mechanic 9 (Migration Path from POC to MLS)
//
// Phase 1 implementation of GroupEncryptionProvider using node:crypto
// AES-256-GCM symmetric encryption. This is the "good enough for now"
// provider that MLS replaces in Phase 2 (F-019).
//
// Key management:
//   - Group key: random 256-bit AES key per group, stored in social_keys.group_keys
//   - Key rotation: on member removal, a new key is generated and re-stored
//   - Epoch tracking: each key rotation increments the epoch
//   - Historical keys retained for decrypting old content
//
// Security properties (Phase 1 limitations):
//   - Forward secrecy: YES (key rotation on removal)
//   - Post-compromise security: NO (requires MLS self-update, Phase 2)
//   - Exporter secrets: YES (HKDF derivation from group key)
//   - Max group size: unlimited (but O(n) key distribution)
//
// Phase 2 replaces this with MlsEncryptionProvider (OpenMLS WASM):
//   - O(log n) group operations via TreeKEM
//   - Post-compromise security via self-update
//   - Standardized ciphersuites (RFC 9420)
//   - Post-quantum hybrid support
// =============================================================================

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomUUID,
} from 'node:crypto';

import { GroupEncryptionProvider } from './encryption-provider.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 12;   // 96 bits per NIST recommendation for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * AES-256-GCM implementation of GroupEncryptionProvider.
 *
 * Stores group keys in the social_keys.group_keys table.
 * Rotates keys on member removal for forward secrecy.
 * Derives exporter secrets via HMAC-SHA256 (HKDF-like).
 */
class AesGcmProvider extends GroupEncryptionProvider {

  /**
   * @param {import('pg').Pool} pool - PostgreSQL connection pool
   */
  constructor(pool) {
    super('aes-gcm-phase1', {
      supportsPostQuantum: false,
      maxGroupSize: null,           // No inherent limit
      supportsExporterSecrets: true,
      supportsForwardSecrecy: true,
      supportsPostCompromiseSecurity: false, // Requires MLS (Phase 2)
    });

    this._pool = pool;
  }

  // ===========================================================================
  // Group Lifecycle
  // ===========================================================================

  /**
   * Create a new encryption group with a random AES-256 key.
   *
   * @param {string} groupId
   * @param {import('./encryption-provider.js').GroupConfig} config
   * @returns {Promise<import('./encryption-provider.js').GroupHandle>}
   */
  async createGroup(groupId, config) {
    const members = config.memberWebIds || [];

    // Check if group already exists
    const existing = await this._pool.query(
      `SELECT group_id FROM social_keys.group_keys
       WHERE group_id = $1 AND is_current = TRUE`,
      [groupId]
    );
    if (existing.rowCount > 0) {
      throw new Error(`Encryption group already exists: ${groupId}`);
    }

    // Generate random 256-bit key
    const groupKey = randomBytes(KEY_LENGTH);
    const epoch = 1;

    // Store the key (one row per member, each holding the same symmetric key)
    // Phase 1: key stored directly. Phase 2 (MLS): key derived via TreeKEM.
    for (const webId of members) {
      await this._insertKeyRow(groupId, webId, groupKey, epoch);
    }

    // Audit log
    await this._auditLog('group_created', groupId, members[0] || 'system', {
      memberCount: members.length,
      algorithm: ALGORITHM,
    });

    console.log(`[aes-gcm] Created encryption group: ${groupId} (${members.length} members, epoch=${epoch})`);

    return {
      groupId,
      algorithm: ALGORITHM,
      epoch,
      memberCount: members.length,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Add a member to the group. Gives them the current group key.
   * Does NOT rotate the key (member additions don't compromise forward secrecy).
   *
   * @param {string} groupId
   * @param {string} memberWebId
   * @returns {Promise<import('./encryption-provider.js').GroupUpdateResult>}
   */
  async addMember(groupId, memberWebId) {
    const currentKey = await this._getCurrentKey(groupId);
    if (!currentKey) {
      throw new Error(`Encryption group not found: ${groupId}`);
    }

    // Check if already a member
    const existing = await this._pool.query(
      `SELECT id FROM social_keys.group_keys
       WHERE group_id = $1 AND member_webid = $2 AND is_current = TRUE`,
      [groupId, memberWebId]
    );
    if (existing.rowCount > 0) {
      throw new Error(`Member already in encryption group: ${memberWebId}`);
    }

    await this._insertKeyRow(groupId, memberWebId, currentKey.key, currentKey.epoch);

    const memberCount = await this._getMemberCount(groupId);

    await this._auditLog('member_added', groupId, memberWebId, {
      epoch: currentKey.epoch,
    });

    console.log(`[aes-gcm] Added member ${memberWebId} to group ${groupId} (epoch=${currentKey.epoch})`);

    return {
      groupId,
      newEpoch: currentKey.epoch,
      keyRotated: false,
      memberCount,
    };
  }

  /**
   * Remove a member from the group.
   * ALWAYS rotates the key to ensure forward secrecy (ARCH-005 SEC-1).
   *
   * @param {string} groupId
   * @param {string} memberWebId
   * @returns {Promise<import('./encryption-provider.js').GroupUpdateResult>}
   */
  async removeMember(groupId, memberWebId) {
    const currentKey = await this._getCurrentKey(groupId);
    if (!currentKey) {
      throw new Error(`Encryption group not found: ${groupId}`);
    }

    // Remove the member's key row (mark as not current)
    const deleteResult = await this._pool.query(
      `UPDATE social_keys.group_keys
       SET is_current = FALSE
       WHERE group_id = $1 AND member_webid = $2 AND is_current = TRUE`,
      [groupId, memberWebId]
    );
    if (deleteResult.rowCount === 0) {
      throw new Error(`Member not in encryption group: ${memberWebId}`);
    }

    // Generate new key for remaining members (forward secrecy)
    const newKey = randomBytes(KEY_LENGTH);
    const newEpoch = currentKey.epoch + 1;

    // Mark all current keys as historical
    await this._pool.query(
      `UPDATE social_keys.group_keys
       SET is_current = FALSE
       WHERE group_id = $1 AND is_current = TRUE`,
      [groupId]
    );

    // Get remaining members and give them the new key
    const remainingMembers = await this._pool.query(
      `SELECT DISTINCT member_webid FROM social_keys.group_keys
       WHERE group_id = $1 AND member_webid != $2`,
      [groupId, memberWebId]
    );

    for (const row of remainingMembers.rows) {
      await this._insertKeyRow(groupId, row.member_webid, newKey, newEpoch);
    }

    const memberCount = remainingMembers.rowCount;

    await this._auditLog('member_removed', groupId, memberWebId, {
      oldEpoch: currentKey.epoch,
      newEpoch,
      keyRotated: true,
    });

    console.log(`[aes-gcm] Removed member ${memberWebId} from group ${groupId} (epoch ${currentKey.epoch} -> ${newEpoch})`);

    return {
      groupId,
      newEpoch,
      keyRotated: true,
      memberCount,
    };
  }

  // ===========================================================================
  // Encrypt / Decrypt
  // ===========================================================================

  /**
   * Encrypt plaintext using the group's current AES-256-GCM key.
   *
   * @param {string} groupId
   * @param {string|Buffer} plaintext
   * @returns {Promise<import('./encryption-provider.js').EncryptedPayload>}
   */
  async encrypt(groupId, plaintext) {
    const currentKey = await this._getCurrentKey(groupId);
    if (!currentKey) {
      throw new Error(`Encryption group not found: ${groupId}`);
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, currentKey.key, iv, {
      authTagLength: TAG_LENGTH,
    });

    const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      epoch: currentKey.epoch,
      algorithm: ALGORITHM,
    };
  }

  /**
   * Decrypt an encrypted payload. Uses the key from the payload's epoch
   * (supports decrypting historical content encrypted under older keys).
   *
   * @param {string} groupId
   * @param {import('./encryption-provider.js').EncryptedPayload} encryptedPayload
   * @returns {Promise<Buffer>}
   */
  async decrypt(groupId, encryptedPayload) {
    const { ciphertext, iv, tag, epoch } = encryptedPayload;

    // Fetch key for the specified epoch (may be historical)
    const keyRow = await this._pool.query(
      `SELECT encrypted_key FROM social_keys.group_keys
       WHERE group_id = $1 AND epoch = $2
       LIMIT 1`,
      [groupId, epoch]
    );
    if (keyRow.rowCount === 0) {
      throw new Error(`No key found for group ${groupId} epoch ${epoch}`);
    }

    const key = Buffer.from(keyRow.rows[0].encrypted_key, 'base64');

    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64'),
      { authTagLength: TAG_LENGTH }
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);

    return decrypted;
  }

  // ===========================================================================
  // Exporter Secrets
  // ===========================================================================

  /**
   * Derive an application-specific secret from the current group key.
   *
   * Uses HMAC-SHA256 as a simple KDF (HKDF-Extract equivalent).
   * Phase 2 (MLS) uses proper MLS exporter secrets.
   *
   * Per ARCH-005 Mechanic 5: labels like 'pmsl-doc-key', 'pmsl-access-token'.
   *
   * @param {string} groupId
   * @param {string} label   - Application label
   * @param {number} [length=32] - Desired key length in bytes
   * @returns {Promise<Buffer>}
   */
  async exportSecret(groupId, label, length = 32) {
    const currentKey = await this._getCurrentKey(groupId);
    if (!currentKey) {
      throw new Error(`Encryption group not found: ${groupId}`);
    }

    // HMAC-SHA256(key=groupKey, data=label+groupId) -> derived key
    const hmac = createHmac('sha256', currentKey.key);
    hmac.update(`${label}:${groupId}:${currentKey.epoch}`);
    const derived = hmac.digest();

    // Truncate or return as-is
    if (length <= 32) {
      return derived.subarray(0, length);
    }

    // For lengths > 32, chain HMAC outputs (HKDF-Expand style)
    const output = [derived];
    let counter = 1;
    while (Buffer.concat(output).length < length) {
      counter++;
      const h = createHmac('sha256', currentKey.key);
      h.update(Buffer.concat([derived, Buffer.from(`${label}:${counter}`)]));
      output.push(h.digest());
    }
    return Buffer.concat(output).subarray(0, length);
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get the encryption status of a group.
   *
   * @param {string} groupId
   * @returns {Promise<import('./encryption-provider.js').GroupHandle|null>}
   */
  async getGroupStatus(groupId) {
    const result = await this._pool.query(
      `SELECT epoch, created_at
       FROM social_keys.group_keys
       WHERE group_id = $1 AND is_current = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
      [groupId]
    );

    if (result.rowCount === 0) return null;

    const memberCount = await this._getMemberCount(groupId);

    return {
      groupId,
      algorithm: ALGORITHM,
      epoch: result.rows[0].epoch,
      memberCount,
      createdAt: result.rows[0].created_at,
    };
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Insert a key row for a member.
   * @private
   */
  async _insertKeyRow(groupId, memberWebId, key, epoch) {
    await this._pool.query(
      `INSERT INTO social_keys.group_keys
         (id, group_id, encrypted_key, member_webid, algorithm, epoch, is_current, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
      [
        randomUUID(),
        groupId,
        key.toString('base64'),
        memberWebId,
        ALGORITHM,
        epoch,
      ]
    );
  }

  /**
   * Get the current key for a group (any member's row -- they all hold the same key).
   * @private
   * @returns {Promise<{key: Buffer, epoch: number}|null>}
   */
  async _getCurrentKey(groupId) {
    const result = await this._pool.query(
      `SELECT encrypted_key, epoch FROM social_keys.group_keys
       WHERE group_id = $1 AND is_current = TRUE
       LIMIT 1`,
      [groupId]
    );
    if (result.rowCount === 0) return null;
    return {
      key: Buffer.from(result.rows[0].encrypted_key, 'base64'),
      epoch: result.rows[0].epoch,
    };
  }

  /**
   * Count current members in an encryption group.
   * @private
   */
  async _getMemberCount(groupId) {
    const result = await this._pool.query(
      `SELECT COUNT(DISTINCT member_webid) AS cnt
       FROM social_keys.group_keys
       WHERE group_id = $1 AND is_current = TRUE`,
      [groupId]
    );
    return parseInt(result.rows[0].cnt, 10);
  }

  /**
   * Write to the encryption audit log.
   * @private
   */
  async _auditLog(operation, groupId, actor, details = {}) {
    try {
      await this._pool.query(
        `INSERT INTO social_keys.encryption_audit
           (id, operation, group_id, actor, details, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [randomUUID(), operation, groupId, actor, JSON.stringify(details)]
      );
    } catch (err) {
      // Audit failure should not block the operation
      console.error(`[aes-gcm] Audit log error:`, err.message);
    }
  }
}

export { AesGcmProvider };

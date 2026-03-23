// =============================================================================
// Invite System — Code Generation, Validation, Tree & Stats
// =============================================================================
// Implements invite-only registration gating per F-031 blueprint.
//
// Core functions:
//   generateInviteCode(prefix)          — generate PEER-XXXX-XXXX format code
//   createInviteCodes(creatorWebid, count, maxUses, expiryDays)
//   validateInviteCode(code)            — check valid, not expired, not exhausted
//   useInviteCode(code, usedByWebid)    — mark as used, update tree
//   revokeInviteCode(code, revokerWebid) — revoke a code
//   getInvitationTree(webid)            — who this user invited (recursive)
//   getInviterChain(webid)              — who invited this user (path to root)
//   getInviteStats()                    — platform-wide stats
//
// Config env vars:
//   REGISTRATION_MODE     — 'invite-only' | 'open' | 'waitlist' (default: 'open')
//   INVITE_POOL_SIZE      — codes per user (default: 5)
//   INVITE_EXPIRY_DAYS    — code expiration in days (default: 30)
//   INVITE_CODE_FORMAT    — code prefix (default: 'PEER')

import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';

// =============================================================================
// Configuration
// =============================================================================

const REGISTRATION_MODE = process.env.REGISTRATION_MODE || 'open';
const INVITE_POOL_SIZE = parseInt(process.env.INVITE_POOL_SIZE || '5', 10);
const INVITE_EXPIRY_DAYS = parseInt(process.env.INVITE_EXPIRY_DAYS || '30', 10);
const INVITE_CODE_PREFIX = process.env.INVITE_CODE_FORMAT || 'PEER';

// Characters used in code generation — excludes ambiguous: 0/O, 1/I/L
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Generate a single invite code in PREFIX-XXXX-XXXX format.
 * Uses crypto.randomBytes for cryptographic randomness.
 * @param {string} [prefix] — override default prefix
 * @returns {string} Generated code (e.g. 'PEER-A7X3-KM9B')
 */
function generateInviteCode(prefix) {
  const pfx = prefix || INVITE_CODE_PREFIX;
  const bytes = randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    part2 += CODE_CHARS[bytes[i + 4] % CODE_CHARS.length];
  }
  return `${pfx}-${part1}-${part2}`;
}

/**
 * Create invite codes in bulk and store them in the database.
 * Collision-checks against existing codes.
 *
 * @param {string} creatorWebid — WebID of the user creating codes
 * @param {number} [count=1]   — number of codes to create
 * @param {number} [maxUses=1] — uses per code
 * @param {number} [expiryDays] — expiry in days (default from env)
 * @returns {Promise<Array<{id: string, code: string, status: string, expires_at: string}>>}
 */
async function createInviteCodes(creatorWebid, count = 1, maxUses = 1, expiryDays) {
  const expDays = expiryDays || INVITE_EXPIRY_DAYS;
  const codes = [];
  const maxAttempts = count * 10; // prevent infinite loop
  let attempts = 0;

  while (codes.length < count && attempts < maxAttempts) {
    attempts++;
    const code = generateInviteCode();

    // Collision check
    const existing = await pool.query(
      'SELECT 1 FROM social_profiles.invite_codes WHERE code = $1',
      [code]
    );
    if (existing.rowCount > 0) continue;

    const result = await pool.query(
      `INSERT INTO social_profiles.invite_codes
         (code, created_by_webid, status, max_uses, expires_at)
       VALUES ($1, $2, 'active', $3, NOW() + ($4 || ' days')::interval)
       RETURNING id, code, status, max_uses, expires_at, created_at`,
      [code, creatorWebid, maxUses, String(expDays)]
    );
    codes.push(result.rows[0]);
  }

  return codes;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate an invite code. Returns status info without consuming it.
 *
 * @param {string} code
 * @returns {Promise<{valid: boolean, error?: string, code_record?: object}>}
 */
async function validateInviteCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Invite code is required.' };
  }

  const result = await pool.query(
    `SELECT id, code, created_by_webid, status, max_uses, use_count, expires_at, revoked_at
     FROM social_profiles.invite_codes
     WHERE code = $1`,
    [code.trim().toUpperCase()]
  );

  if (result.rowCount === 0) {
    return { valid: false, error: 'Invite code not found. Please check and try again.' };
  }

  const rec = result.rows[0];

  if (rec.status === 'revoked') {
    return { valid: false, error: 'This invite code has been revoked.', code_record: rec };
  }

  if (rec.status === 'used') {
    return { valid: false, error: 'This invite code has already been used.', code_record: rec };
  }

  if (rec.status === 'exhausted') {
    return { valid: false, error: 'This invite code has reached its maximum uses.', code_record: rec };
  }

  // Check expiry
  if (new Date(rec.expires_at) < new Date()) {
    // Update status to expired if not already
    await pool.query(
      `UPDATE social_profiles.invite_codes SET status = 'expired' WHERE id = $1 AND status = 'active'`,
      [rec.id]
    );
    return { valid: false, error: 'This invite code has expired.', code_record: rec };
  }

  if (rec.status !== 'active') {
    return { valid: false, error: `Invite code status: ${rec.status}`, code_record: rec };
  }

  return { valid: true, code_record: rec };
}

// =============================================================================
// Redemption
// =============================================================================

/**
 * Use (redeem) an invite code during signup.
 * - Validates the code
 * - Updates code status and use_count
 * - Creates invitation_tree entry with correct depth
 *
 * @param {string} code
 * @param {string} usedByWebid — WebID of the new user
 * @returns {Promise<{success: boolean, error?: string, tree_entry?: object}>}
 */
async function useInviteCode(code, usedByWebid) {
  const validation = await validateInviteCode(code);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const rec = validation.code_record;
  const newUseCount = rec.use_count + 1;
  const newStatus = newUseCount >= rec.max_uses
    ? (rec.max_uses === 1 ? 'used' : 'exhausted')
    : 'active';

  // Update the invite code
  await pool.query(
    `UPDATE social_profiles.invite_codes
     SET use_count = $1,
         status = $2,
         used_by_webid = $3,
         used_at = NOW()
     WHERE id = $4`,
    [newUseCount, newStatus, usedByWebid, rec.id]
  );

  // Compute depth: look up the inviter's depth in the tree
  let depth = 0;
  const inviterEntry = await pool.query(
    `SELECT depth FROM social_profiles.invitation_tree
     WHERE invitee_webid = $1`,
    [rec.created_by_webid]
  );
  if (inviterEntry.rowCount > 0) {
    depth = inviterEntry.rows[0].depth + 1;
  }
  // If the inviter is not in the tree (root/admin), depth stays 0
  // The invitee is at depth = inviter_depth + 1, but if inviter is root, depth = 1
  // Actually: if inviter IS in tree as invitee, their depth is known.
  // If inviter is NOT in tree (they're a root account), invitee depth = 1.
  // If inviter IS in tree, invitee depth = inviter_depth + 1.
  if (inviterEntry.rowCount > 0) {
    depth = inviterEntry.rows[0].depth + 1;
  } else {
    // Inviter is a root account (not invited by anyone) — invitee is depth 1
    depth = 1;
  }

  // Create invitation tree entry
  const treeResult = await pool.query(
    `INSERT INTO social_profiles.invitation_tree
       (inviter_webid, invitee_webid, invite_code, depth)
     VALUES ($1, $2, $3, $4)
     RETURNING id, inviter_webid, invitee_webid, invite_code, depth, created_at`,
    [rec.created_by_webid, usedByWebid, rec.code, depth]
  );

  console.log(`[invites] Code ${rec.code} redeemed by ${usedByWebid} (depth: ${depth})`);

  return {
    success: true,
    tree_entry: treeResult.rows[0],
  };
}

// =============================================================================
// Revocation
// =============================================================================

/**
 * Revoke an invite code.
 *
 * @param {string} code
 * @param {string} revokerWebid — WebID of the user revoking (must be creator or admin)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function revokeInviteCode(code, revokerWebid) {
  if (!code) {
    return { success: false, error: 'Code is required.' };
  }

  const result = await pool.query(
    `SELECT id, code, created_by_webid, status
     FROM social_profiles.invite_codes
     WHERE code = $1`,
    [code.trim().toUpperCase()]
  );

  if (result.rowCount === 0) {
    return { success: false, error: 'Code not found.' };
  }

  const rec = result.rows[0];

  if (rec.status === 'revoked') {
    return { success: false, error: 'Code is already revoked.' };
  }

  // Allow revocation by creator or any user (admin check done at route level)
  await pool.query(
    `UPDATE social_profiles.invite_codes
     SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1`,
    [rec.id]
  );

  console.log(`[invites] Code ${rec.code} revoked by ${revokerWebid}`);
  return { success: true };
}

// =============================================================================
// Tree Queries
// =============================================================================

/**
 * Get the invitation tree (subtree) for a user — who they invited, recursively.
 * Uses iterative breadth-first expansion (no recursive SQL per blueprint mandate).
 *
 * @param {string} webid
 * @param {number} [maxDepth=10] — max levels to traverse
 * @returns {Promise<Array<{invitee_webid: string, inviter_webid: string, depth: number, created_at: string}>>}
 */
async function getInvitationTree(webid, maxDepth = 10) {
  // Get all descendants — since depth is pre-computed, we can use a flat query
  // and reconstruct the tree client-side. Fetch all tree entries where the
  // inviter chain leads back to this webid.
  //
  // Strategy: start with direct invitees, then their invitees, etc.
  const allEntries = [];
  let currentInviters = [webid];

  for (let level = 0; level < maxDepth; level++) {
    if (currentInviters.length === 0) break;

    const result = await pool.query(
      `SELECT t.id, t.inviter_webid, t.invitee_webid, t.invite_code, t.depth, t.created_at,
              p.display_name, p.username, p.avatar_url
       FROM social_profiles.invitation_tree t
       LEFT JOIN social_profiles.profile_index p ON p.webid = t.invitee_webid
       WHERE t.inviter_webid = ANY($1)
       ORDER BY t.created_at ASC`,
      [currentInviters]
    );

    if (result.rowCount === 0) break;

    allEntries.push(...result.rows);
    currentInviters = result.rows.map(r => r.invitee_webid);
  }

  return allEntries;
}

/**
 * Get the inviter chain for a user — path from this user up to the root.
 *
 * @param {string} webid
 * @returns {Promise<Array<{inviter_webid: string, invitee_webid: string, depth: number}>>}
 */
async function getInviterChain(webid) {
  const chain = [];
  let currentWebid = webid;
  const maxSteps = 50; // safety limit

  for (let i = 0; i < maxSteps; i++) {
    const result = await pool.query(
      `SELECT t.inviter_webid, t.invitee_webid, t.depth, t.created_at,
              p.display_name, p.username
       FROM social_profiles.invitation_tree t
       LEFT JOIN social_profiles.profile_index p ON p.webid = t.inviter_webid
       WHERE t.invitee_webid = $1`,
      [currentWebid]
    );

    if (result.rowCount === 0) break;

    chain.push(result.rows[0]);
    currentWebid = result.rows[0].inviter_webid;
  }

  return chain;
}

// =============================================================================
// Stats
// =============================================================================

/**
 * Get platform-wide invite statistics.
 *
 * @returns {Promise<object>} Stats object
 */
async function getInviteStats() {
  // Total codes
  const totalResult = await pool.query(
    'SELECT COUNT(*) AS total FROM social_profiles.invite_codes'
  );
  const total = parseInt(totalResult.rows[0].total, 10);

  // By status
  const statusResult = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM social_profiles.invite_codes
     GROUP BY status`
  );
  const byStatus = {};
  for (const row of statusResult.rows) {
    byStatus[row.status] = parseInt(row.count, 10);
  }

  // Conversion rate (used+exhausted / total)
  const redeemed = (byStatus.used || 0) + (byStatus.exhausted || 0);
  const conversionRate = total > 0 ? (redeemed / total) : 0;

  // Tree depth stats
  const depthResult = await pool.query(
    `SELECT
       COUNT(*) AS total_invitations,
       COALESCE(AVG(depth), 0) AS avg_depth,
       COALESCE(MAX(depth), 0) AS max_depth
     FROM social_profiles.invitation_tree`
  );
  const depthStats = depthResult.rows[0];

  // Top inviters
  const topInvitersResult = await pool.query(
    `SELECT t.inviter_webid, COUNT(*) AS invite_count,
            p.display_name, p.username
     FROM social_profiles.invitation_tree t
     LEFT JOIN social_profiles.profile_index p ON p.webid = t.inviter_webid
     GROUP BY t.inviter_webid, p.display_name, p.username
     ORDER BY invite_count DESC
     LIMIT 10`
  );

  return {
    total_codes: total,
    by_status: byStatus,
    redeemed,
    conversion_rate: Math.round(conversionRate * 10000) / 100, // percentage with 2 decimals
    total_invitations: parseInt(depthStats.total_invitations, 10),
    avg_depth: parseFloat(parseFloat(depthStats.avg_depth).toFixed(2)),
    max_depth: parseInt(depthStats.max_depth, 10),
    top_inviters: topInvitersResult.rows.map(r => ({
      webid: r.inviter_webid,
      display_name: r.display_name,
      username: r.username,
      invite_count: parseInt(r.invite_count, 10),
    })),
  };
}

// =============================================================================
// User's own codes
// =============================================================================

/**
 * Get all invite codes created by a specific user.
 *
 * @param {string} webid
 * @returns {Promise<Array>}
 */
async function getUserInviteCodes(webid) {
  const result = await pool.query(
    `SELECT id, code, status, max_uses, use_count, expires_at, created_at, used_at, used_by_webid
     FROM social_profiles.invite_codes
     WHERE created_by_webid = $1
     ORDER BY created_at DESC`,
    [webid]
  );
  return result.rows;
}

/**
 * Get count of active (unused) codes for a user.
 *
 * @param {string} webid
 * @returns {Promise<number>}
 */
async function getUserActiveCodeCount(webid) {
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM social_profiles.invite_codes
     WHERE created_by_webid = $1 AND status = 'active'`,
    [webid]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Check if a user can generate more codes (pool limit check).
 * Admin (first user) bypass pool limit.
 *
 * @param {string} webid
 * @param {boolean} isAdmin
 * @returns {Promise<{canGenerate: boolean, remaining: number, poolSize: number}>}
 */
async function checkPoolLimit(webid, isAdmin = false) {
  if (isAdmin) {
    return { canGenerate: true, remaining: Infinity, poolSize: Infinity };
  }

  const totalResult = await pool.query(
    `SELECT COUNT(*) AS count
     FROM social_profiles.invite_codes
     WHERE created_by_webid = $1`,
    [webid]
  );
  const totalCreated = parseInt(totalResult.rows[0].count, 10);
  const remaining = Math.max(0, INVITE_POOL_SIZE - totalCreated);

  return {
    canGenerate: remaining > 0,
    remaining,
    poolSize: INVITE_POOL_SIZE,
  };
}

/**
 * Get all invite codes (admin view) with optional status filter.
 *
 * @param {object} opts
 * @param {string} [opts.status] — filter by status
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{codes: Array, total: number}>}
 */
async function getAllInviteCodes({ status, limit = 50, offset = 0 } = {}) {
  let where = '';
  const params = [];

  if (status) {
    where = 'WHERE c.status = $1';
    params.push(status);
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM social_profiles.invite_codes c ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const paramOffset = params.length;
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT c.id, c.code, c.created_by_webid, c.used_by_webid, c.status,
            c.max_uses, c.use_count, c.expires_at, c.created_at, c.used_at,
            p.display_name AS creator_name, p.username AS creator_username
     FROM social_profiles.invite_codes c
     LEFT JOIN social_profiles.profile_index p ON p.webid = c.created_by_webid
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`,
    params
  );

  return { codes: result.rows, total };
}

// =============================================================================
// Helper: Check if user is first (admin) user
// =============================================================================

/**
 * Check if a profile is the platform admin (first registered user).
 *
 * @param {string} profileId
 * @returns {Promise<boolean>}
 */
async function isAdmin(profileId) {
  const result = await pool.query(
    `SELECT id FROM social_profiles.profile_index
     ORDER BY created_at ASC
     LIMIT 1`
  );
  return result.rowCount > 0 && result.rows[0].id === profileId;
}

// =============================================================================
// Exports
// =============================================================================

export {
  REGISTRATION_MODE,
  INVITE_POOL_SIZE,
  INVITE_EXPIRY_DAYS,
  INVITE_CODE_PREFIX,
  generateInviteCode,
  createInviteCodes,
  validateInviteCode,
  useInviteCode,
  revokeInviteCode,
  getInvitationTree,
  getInviterChain,
  getInviteStats,
  getUserInviteCodes,
  getUserActiveCodeCount,
  checkPoolLimit,
  getAllInviteCodes,
  isAdmin,
};

// =============================================================================
// Ecosystem SSO — Token Generation & Verification (Phase 1)
// =============================================================================
// Implements cross-instance SSO token creation and verification for the
// PeerMesh meta-network (ARCH-010, FLOW-004).
//
// SSO tokens are signed with the instance's Ed25519 keypair and contain:
//   - webid, handle, display_name — user identity
//   - protocol_ids — cross-protocol identifiers
//   - issued_at, expires_at — validity window
//   - target_domain — intended recipient instance
//   - source_domain — issuing instance
//
// Token format: base64url(JSON payload) + '.' + base64url(Ed25519 signature)
// Signature is over the raw base64url-encoded payload string.
//
// Dependencies: node:crypto only (no external packages).
// =============================================================================

import {
  generateKeyPairSync, createPrivateKey, createPublicKey,
  sign, verify, randomUUID,
} from 'node:crypto';
import { pool } from '../db.js';
import { SUBDOMAIN, DOMAIN, BASE_URL } from './helpers.js';

// =============================================================================
// Instance Identity — keypair naming convention
// =============================================================================

const INSTANCE_DOMAIN = `${SUBDOMAIN}.${DOMAIN}`;
const INSTANCE_OMNI_ID = `instance:${INSTANCE_DOMAIN}`;
const SSO_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes (short-lived)

// =============================================================================
// Instance Keypair Management
// =============================================================================

/**
 * Generate an Ed25519 keypair for this instance's SSO operations.
 * Stores both public and private keys in social_keys.key_metadata.
 *
 * @returns {Promise<{ publicKeySpkiB64: string, privateKeyPem: string }>}
 */
async function generateInstanceKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const publicKeySpkiB64 = Buffer.from(publicKey).toString('base64url');

  // Store public key
  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, public_key_spki, key_purpose, is_active)
     VALUES ($1, $2, 'ecosystem-sso', 'ed25519-instance', $3, $4, 'signing', TRUE)`,
    [randomUUID(), INSTANCE_OMNI_ID, publicKeySpkiB64, publicKeySpkiB64]
  );

  // Store private key (Phase 1: server-side)
  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
     VALUES ($1, $2, 'ecosystem-sso', 'ed25519-instance-private', $3, 'signing-private', TRUE)`,
    [randomUUID(), INSTANCE_OMNI_ID, privateKey]
  );

  console.log(`[sso] Generated instance Ed25519 keypair for ${INSTANCE_DOMAIN}`);
  return { publicKeySpkiB64, privateKeyPem: privateKey };
}

/**
 * Retrieve the instance's Ed25519 keypair, or generate one if none exists.
 *
 * @returns {Promise<{ publicKeySpkiB64: string, privateKeyPem: string }>}
 */
async function getOrCreateInstanceKeypair() {
  // Check for existing public key
  const pubResult = await pool.query(
    `SELECT public_key_spki FROM social_keys.key_metadata
     WHERE omni_account_id = $1
       AND key_type = 'ed25519-instance'
       AND protocol = 'ecosystem-sso'
       AND is_active = TRUE
     LIMIT 1`,
    [INSTANCE_OMNI_ID]
  );

  if (pubResult.rowCount === 0) {
    return generateInstanceKeypair();
  }

  // Fetch private key
  const privResult = await pool.query(
    `SELECT public_key_hash FROM social_keys.key_metadata
     WHERE omni_account_id = $1
       AND key_type = 'ed25519-instance-private'
       AND protocol = 'ecosystem-sso'
       AND is_active = TRUE
     LIMIT 1`,
    [INSTANCE_OMNI_ID]
  );

  if (privResult.rowCount === 0) {
    // Public key exists without private — regenerate
    console.warn('[sso] Instance public key found without private key. Regenerating.');
    await pool.query(
      `UPDATE social_keys.key_metadata SET is_active = FALSE
       WHERE omni_account_id = $1 AND protocol = 'ecosystem-sso'`,
      [INSTANCE_OMNI_ID]
    );
    return generateInstanceKeypair();
  }

  return {
    publicKeySpkiB64: pubResult.rows[0].public_key_spki,
    privateKeyPem: privResult.rows[0].public_key_hash,
  };
}

/**
 * Get just the instance public key (for sharing with other instances).
 *
 * @returns {Promise<string|null>} SPKI base64url public key or null
 */
async function getInstancePublicKey() {
  const result = await pool.query(
    `SELECT public_key_spki FROM social_keys.key_metadata
     WHERE omni_account_id = $1
       AND key_type = 'ed25519-instance'
       AND protocol = 'ecosystem-sso'
       AND is_active = TRUE
     LIMIT 1`,
    [INSTANCE_OMNI_ID]
  );
  return result.rowCount > 0 ? result.rows[0].public_key_spki : null;
}

// =============================================================================
// Instance Self-Registration
// =============================================================================

/**
 * Register this instance in the instances table (self-entry).
 * Called on startup. Idempotent — updates last_seen_at if already registered.
 *
 * @returns {Promise<void>}
 */
async function registerSelfInstance() {
  const keypair = await getOrCreateInstanceKeypair();

  const existing = await pool.query(
    'SELECT id FROM social_federation.instances WHERE domain = $1',
    [INSTANCE_DOMAIN]
  );

  if (existing.rowCount > 0) {
    // Update last_seen_at and public key
    await pool.query(
      `UPDATE social_federation.instances
       SET last_seen_at = NOW(),
           public_key = $1,
           name = $2,
           nodeinfo_url = $3,
           software_name = 'peermesh-social-lab',
           software_version = '0.6.0'
       WHERE domain = $4`,
      [
        keypair.publicKeySpkiB64,
        `PeerMesh Social Lab (${INSTANCE_DOMAIN})`,
        `${BASE_URL}/.well-known/nodeinfo`,
        INSTANCE_DOMAIN,
      ]
    );
    console.log(`[sso] Updated self-registration for ${INSTANCE_DOMAIN}`);
  } else {
    await pool.query(
      `INSERT INTO social_federation.instances
         (id, domain, name, nodeinfo_url, public_key, trust_level,
          software_name, software_version, metadata)
       VALUES ($1, $2, $3, $4, $5, 'self', 'peermesh-social-lab', '0.6.0', $6)`,
      [
        randomUUID(),
        INSTANCE_DOMAIN,
        `PeerMesh Social Lab (${INSTANCE_DOMAIN})`,
        `${BASE_URL}/.well-known/nodeinfo`,
        keypair.publicKeySpkiB64,
        JSON.stringify({
          peermesh: {
            version: '1.0',
            capabilities: ['sso', 'social-graph-sync'],
            baseUrl: BASE_URL,
          },
        }),
      ]
    );
    console.log(`[sso] Self-registered instance: ${INSTANCE_DOMAIN}`);
  }
}

// =============================================================================
// SSO Token Generation
// =============================================================================

/**
 * Generate an SSO token for cross-instance authentication.
 *
 * The token carries the user's identity claims and is signed with
 * this instance's Ed25519 private key. The receiving instance verifies
 * the signature against our public key (exchanged during registration).
 *
 * @param {object} profile - User profile object with webid, username, display_name, etc.
 * @param {string} targetDomain - Domain of the instance that will receive this token
 * @returns {Promise<string>} Signed SSO token (base64url payload + '.' + base64url signature)
 */
async function generateSSOToken(profile, targetDomain) {
  const keypair = await getOrCreateInstanceKeypair();
  const now = Date.now();

  const payload = {
    // Identity claims
    webid: profile.webid,
    handle: profile.username,
    display_name: profile.display_name,

    // Cross-protocol identifiers
    protocol_ids: {
      omni_account_id: profile.omni_account_id,
      ap_actor_uri: profile.ap_actor_uri || null,
      at_did: profile.at_did || null,
      nostr_npub: profile.nostr_npub || null,
    },

    // Token metadata
    source_domain: INSTANCE_DOMAIN,
    target_domain: targetDomain,
    issued_at: now,
    expires_at: now + SSO_TOKEN_TTL_MS,
    token_id: randomUUID(),
  };

  // Encode payload as base64url
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64url');

  // Sign with instance Ed25519 private key
  const privateKey = createPrivateKey(keypair.privateKeyPem);
  const signatureBuffer = sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  const signatureB64 = signatureBuffer.toString('base64url');

  return `${payloadB64}.${signatureB64}`;
}

// =============================================================================
// SSO Token Verification
// =============================================================================

/**
 * Verify an SSO token from another instance.
 *
 * @param {string} token - The SSO token string (payload.signature)
 * @param {string} sourceInstancePublicKey - SPKI base64url public key of the source instance
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function verifySSOToken(token, sourceInstancePublicKey) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing or invalid token' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token: expected payload.signature format' };
  }

  const [payloadB64, signatureB64] = parts;

  // Verify signature
  try {
    const pubKeyDer = Buffer.from(sourceInstancePublicKey, 'base64url');
    const publicKey = createPublicKey({
      key: pubKeyDer,
      format: 'der',
      type: 'spki',
    });

    const signatureBytes = Buffer.from(signatureB64, 'base64url');
    const isValid = verify(null, Buffer.from(payloadB64, 'utf8'), publicKey, signatureBytes);

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed' };
    }
  } catch (err) {
    return { valid: false, error: `Signature error: ${err.message}` };
  }

  // Decode and validate payload
  let payload;
  try {
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(payloadStr);
  } catch (err) {
    return { valid: false, error: `Payload decode error: ${err.message}` };
  }

  // Check expiration
  if (!payload.expires_at || Date.now() > payload.expires_at) {
    return { valid: false, error: 'Token has expired' };
  }

  // Check issued_at is not in the future (clock skew tolerance: 30 seconds)
  if (payload.issued_at && payload.issued_at > Date.now() + 30000) {
    return { valid: false, error: 'Token issued_at is in the future' };
  }

  // Check required fields
  if (!payload.webid || !payload.source_domain) {
    return { valid: false, error: 'Token missing required fields (webid, source_domain)' };
  }

  return { valid: true, payload };
}

// =============================================================================
// Instance Lookup Helpers
// =============================================================================

/**
 * Get all known instances (non-blocked).
 *
 * @returns {Promise<Array>} Array of instance records
 */
async function listInstances() {
  const result = await pool.query(
    `SELECT id, domain, name, nodeinfo_url, public_key, trust_level,
            software_name, software_version, registered_at, last_seen_at, metadata
     FROM social_federation.instances
     WHERE trust_level != 'blocked'
     ORDER BY registered_at ASC`
  );
  return result.rows;
}

/**
 * Get a specific instance by domain.
 *
 * @param {string} domain
 * @returns {Promise<object|null>}
 */
async function getInstanceByDomain(domain) {
  const result = await pool.query(
    `SELECT id, domain, name, nodeinfo_url, public_key, trust_level,
            software_name, software_version, registered_at, last_seen_at, metadata
     FROM social_federation.instances
     WHERE domain = $1
     LIMIT 1`,
    [domain]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
}

/**
 * Register a remote instance (called via POST /api/instances/register).
 *
 * @param {object} data - Instance registration data
 * @param {string} data.domain - Remote instance domain
 * @param {string} data.name - Instance name
 * @param {string} data.public_key - Ed25519 public key (SPKI base64url)
 * @param {string} [data.nodeinfo_url] - NodeInfo URL
 * @param {string} [data.software_name] - Software name
 * @param {string} [data.software_version] - Software version
 * @param {object} [data.metadata] - Additional metadata
 * @returns {Promise<object>} The registered instance record
 */
async function registerRemoteInstance(data) {
  const existing = await pool.query(
    'SELECT id FROM social_federation.instances WHERE domain = $1',
    [data.domain]
  );

  if (existing.rowCount > 0) {
    // Update existing record
    await pool.query(
      `UPDATE social_federation.instances
       SET name = COALESCE($1, name),
           public_key = COALESCE($2, public_key),
           nodeinfo_url = COALESCE($3, nodeinfo_url),
           software_name = COALESCE($4, software_name),
           software_version = COALESCE($5, software_version),
           metadata = COALESCE($6, metadata),
           last_seen_at = NOW()
       WHERE domain = $7
       RETURNING *`,
      [
        data.name, data.public_key, data.nodeinfo_url,
        data.software_name, data.software_version,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.domain,
      ]
    );
    console.log(`[sso] Updated remote instance: ${data.domain}`);
  } else {
    await pool.query(
      `INSERT INTO social_federation.instances
         (id, domain, name, nodeinfo_url, public_key, trust_level,
          software_name, software_version, metadata)
       VALUES ($1, $2, $3, $4, $5, 'peer', $6, $7, $8)`,
      [
        randomUUID(),
        data.domain,
        data.name || data.domain,
        data.nodeinfo_url || null,
        data.public_key,
        data.software_name || null,
        data.software_version || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    console.log(`[sso] Registered remote instance: ${data.domain}`);
  }

  // Return the instance record (and our public key for mutual exchange)
  const instance = await getInstanceByDomain(data.domain);
  const ourPublicKey = await getInstancePublicKey();

  return {
    instance,
    this_instance: {
      domain: INSTANCE_DOMAIN,
      name: `PeerMesh Social Lab (${INSTANCE_DOMAIN})`,
      public_key: ourPublicKey,
      nodeinfo_url: `${BASE_URL}/.well-known/nodeinfo`,
    },
  };
}

export {
  // Keypair management
  getOrCreateInstanceKeypair,
  getInstancePublicKey,

  // Self-registration
  registerSelfInstance,

  // SSO tokens
  generateSSOToken,
  verifySSOToken,

  // Instance registry
  listInstances,
  getInstanceByDomain,
  registerRemoteInstance,

  // Constants
  INSTANCE_DOMAIN,
  SSO_TOKEN_TTL_MS,
};

// =============================================================================
// Per-User Ed25519 Identity Keypair Generation
// =============================================================================
// Generates Ed25519 signing keypairs for Universal Manifest signing (F-030).
// Uses node:crypto (no external dependencies).
//
// Each user gets one Ed25519 keypair at profile creation time, stored in
// social_keys.key_metadata. The public key is embedded in manifests as
// SPKI base64url. The private key signs manifests via RFC 8785 JCS.
//
// Phase 1: Both keys stored server-side (key_metadata table).
// Phase 2: Private key migrates to client-side key store.
// =============================================================================

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { pool } from '../db.js';

/**
 * Generate an Ed25519 keypair using node:crypto.
 * Returns the public key in SPKI/DER format (base64url) and the private
 * key in PKCS8/PEM format.
 *
 * @returns {{ publicKeySpkiB64: string, privateKeyPem: string }}
 */
function generateEd25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Encode DER public key as base64url (for embedding in manifests)
  const publicKeySpkiB64 = Buffer.from(publicKey)
    .toString('base64url');

  return {
    publicKeySpkiB64,
    privateKeyPem: privateKey,
  };
}

/**
 * Store an Ed25519 identity keypair in social_keys.key_metadata.
 * Creates two rows: one for the public key, one for the private key.
 *
 * Phase 1: Private key stored server-side in key_metadata.
 * Phase 2: Private key row will be removed; client-side only.
 *
 * @param {string} omniAccountId - The Omni-Account ID
 * @param {{ publicKeySpkiB64: string, privateKeyPem: string }} keypair
 * @returns {Promise<{ publicKeyId: string, privateKeyId: string }>}
 */
async function storeEd25519Keypair(omniAccountId, keypair) {
  const publicKeyId = randomUUID();
  const privateKeyId = randomUUID();

  // Compute a SHA-256 hash of the public key for the public_key_hash column
  const { createHash } = await import('node:crypto');
  const publicKeyHash = createHash('sha256')
    .update(keypair.publicKeySpkiB64)
    .digest('hex');

  // Store public key metadata + actual SPKI
  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, public_key_spki, key_purpose, is_active)
     VALUES ($1, $2, 'universal-manifest', 'ed25519-identity', $3, $4, 'signing', TRUE)`,
    [publicKeyId, omniAccountId, publicKeyHash, keypair.publicKeySpkiB64]
  );

  // Store private key (Phase 1: server-side storage)
  // The public_key_hash column stores the PEM for retrieval.
  // This is a known Phase 1 compromise; Phase 2 moves to client-side.
  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
     VALUES ($1, $2, 'universal-manifest', 'ed25519-identity-private', $3, 'signing-private', TRUE)`,
    [privateKeyId, omniAccountId, keypair.privateKeyPem]
  );

  console.log(`[identity-keys] Stored Ed25519 keypair for ${omniAccountId}: pub=${publicKeyId}`);

  return { publicKeyId, privateKeyId };
}

/**
 * Retrieve the active Ed25519 identity keypair for an Omni-Account.
 * Returns null if no keypair exists.
 *
 * @param {string} omniAccountId
 * @returns {Promise<{ publicKeySpkiB64: string, privateKeyPem: string } | null>}
 */
async function getEd25519Keypair(omniAccountId) {
  // Fetch public key (SPKI base64url)
  const pubResult = await pool.query(
    `SELECT public_key_spki FROM social_keys.key_metadata
     WHERE omni_account_id = $1
       AND key_type = 'ed25519-identity'
       AND is_active = TRUE
     LIMIT 1`,
    [omniAccountId]
  );

  if (pubResult.rowCount === 0) return null;

  // Fetch private key (PEM, stored in public_key_hash column for Phase 1)
  const privResult = await pool.query(
    `SELECT public_key_hash FROM social_keys.key_metadata
     WHERE omni_account_id = $1
       AND key_type = 'ed25519-identity-private'
       AND is_active = TRUE
     LIMIT 1`,
    [omniAccountId]
  );

  if (privResult.rowCount === 0) return null;

  return {
    publicKeySpkiB64: pubResult.rows[0].public_key_spki,
    privateKeyPem: privResult.rows[0].public_key_hash,
  };
}

/**
 * Generate and store an Ed25519 identity keypair for a new profile.
 * Convenience function that combines generation + storage.
 *
 * @param {string} omniAccountId - The Omni-Account ID
 * @returns {Promise<{ publicKeySpkiB64: string, privateKeyPem: string, publicKeyId: string, privateKeyId: string }>}
 */
async function provisionEd25519Identity(omniAccountId) {
  const keypair = generateEd25519Keypair();
  const { publicKeyId, privateKeyId } = await storeEd25519Keypair(omniAccountId, keypair);
  return { ...keypair, publicKeyId, privateKeyId };
}

export {
  generateEd25519Keypair,
  storeEd25519Keypair,
  getEd25519Keypair,
  provisionEd25519Identity,
};

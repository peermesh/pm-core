// =============================================================================
// Account Recovery — Shamir's Secret Sharing & Passphrase Backup
// =============================================================================
// Implements F-027 (Account Recovery Architecture):
//   - Shamir's Secret Sharing for social recovery of the Omni-Account
//   - Passphrase-based backup (PBKDF2 + AES-256-GCM)
//   - Recovery package export (portable identity backup)
//
// Uses node:crypto exclusively (no external dependencies for crypto ops).
// Shamir's SSS operates over GF(256) for byte-level splitting.
//
// Security constraints (F-027 AR-SEC):
//   - Minimum threshold: 2 (single-guardian recovery prohibited)
//   - Maximum trustees: 10
//   - Shares never stored in plaintext on server
//   - Post-recovery key rotation required (caller responsibility)
// =============================================================================

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2 as pbkdf2Callback,
  randomUUID,
} from 'node:crypto';

// =============================================================================
// Constants
// =============================================================================

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_KEY_LENGTH = 32; // 256 bits for AES-256
const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_LENGTH = 12; // 96 bits per NIST recommendation
const AES_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits

const MIN_THRESHOLD = 2;
const MAX_SHARES = 10;

// =============================================================================
// GF(256) Arithmetic for Shamir's Secret Sharing
// =============================================================================
// Operations in GF(2^8) with irreducible polynomial x^8 + x^4 + x^3 + x + 1
// (0x11B, same as AES). This avoids modular arithmetic pitfalls and ensures
// every non-zero element has a multiplicative inverse.

const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

// Build lookup tables using generator 3 (primitive element for 0x11B)
// Generator 2 only has order 51 in this field; generator 3 has full order 255.
(function initGF256Tables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_LOG[x] = i;
    // Multiply by generator 3: x = x * 3 in GF(256)
    // x * 3 = x * (2 + 1) = (x << 1) ^ x
    const x2 = (x << 1) ^ (x & 0x80 ? 0x11B : 0);
    x = x2 ^ x;
  }
  // Extend exp table for convenience (avoids modulo in multiply)
  for (let i = 255; i < 512; i++) {
    GF256_EXP[i] = GF256_EXP[i - 255];
  }
})();

function gf256Add(a, b) {
  return a ^ b; // Addition in GF(2^n) is XOR
}

function gf256Mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
}

function gf256Inv(a) {
  if (a === 0) throw new Error('Cannot invert zero in GF(256)');
  return GF256_EXP[255 - GF256_LOG[a]];
}

function gf256Div(a, b) {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return GF256_EXP[(GF256_LOG[a] + 255 - GF256_LOG[b]) % 255];
}

// =============================================================================
// Shamir's Secret Sharing over GF(256)
// =============================================================================

/**
 * Evaluate a polynomial at point x in GF(256).
 * coefficients[0] is the secret (constant term).
 *
 * @param {Uint8Array} coefficients - Polynomial coefficients
 * @param {number} x - Evaluation point (1-255, never 0)
 * @returns {number} Polynomial value at x in GF(256)
 */
function evaluatePolynomial(coefficients, x) {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result = gf256Add(gf256Mul(result, x), coefficients[i]);
  }
  return result;
}

/**
 * Split a secret byte array into N shares with threshold K using Shamir's SSS.
 * Each byte of the secret is independently split using a random polynomial
 * of degree K-1 over GF(256).
 *
 * @param {Buffer|Uint8Array} secret - The secret to split
 * @param {number} threshold - K: minimum shares needed to reconstruct
 * @param {number} totalShares - N: total shares to generate
 * @returns {Array<{ index: number, data: Buffer }>} Array of N shares
 */
function splitSecret(secret, threshold, totalShares) {
  if (threshold < MIN_THRESHOLD) {
    throw new Error(`Threshold must be at least ${MIN_THRESHOLD}`);
  }
  if (totalShares > MAX_SHARES) {
    throw new Error(`Total shares cannot exceed ${MAX_SHARES}`);
  }
  if (totalShares < threshold) {
    throw new Error('Total shares must be >= threshold');
  }
  if (totalShares > 255) {
    throw new Error('Maximum 255 shares (GF(256) constraint)');
  }

  const secretBytes = Buffer.from(secret);
  const shares = [];

  // Initialize share data buffers
  for (let i = 0; i < totalShares; i++) {
    shares.push({
      index: i + 1, // 1-based (x=0 is the secret)
      data: Buffer.alloc(secretBytes.length),
    });
  }

  // For each byte of the secret, create a random polynomial and evaluate
  for (let byteIdx = 0; byteIdx < secretBytes.length; byteIdx++) {
    // coefficients[0] = secret byte, rest are random
    const coefficients = new Uint8Array(threshold);
    coefficients[0] = secretBytes[byteIdx];

    // Generate random coefficients for degree 1 through K-1
    const randBytes = randomBytes(threshold - 1);
    for (let c = 1; c < threshold; c++) {
      coefficients[c] = randBytes[c - 1];
    }

    // Evaluate polynomial at each share's x-coordinate
    for (let s = 0; s < totalShares; s++) {
      shares[s].data[byteIdx] = evaluatePolynomial(coefficients, shares[s].index);
    }
  }

  return shares;
}

/**
 * Reconstruct a secret from K or more Shamir shares using Lagrange interpolation.
 *
 * @param {Array<{ index: number, data: Buffer }>} shares - K or more shares
 * @returns {Buffer} The reconstructed secret
 */
function reconstructSecret(shares) {
  if (!shares || shares.length < MIN_THRESHOLD) {
    throw new Error(`Need at least ${MIN_THRESHOLD} shares to reconstruct`);
  }

  const shareCount = shares.length;
  const secretLength = shares[0].data.length;

  // Verify all shares have the same length
  for (const share of shares) {
    if (share.data.length !== secretLength) {
      throw new Error('All shares must have the same length');
    }
  }

  const result = Buffer.alloc(secretLength);

  // Lagrange interpolation at x=0 for each byte position
  for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
    let value = 0;

    for (let i = 0; i < shareCount; i++) {
      const xi = shares[i].index;
      const yi = shares[i].data[byteIdx];

      // Compute Lagrange basis polynomial L_i(0)
      let basis = 1;
      for (let j = 0; j < shareCount; j++) {
        if (i === j) continue;
        const xj = shares[j].index;
        // L_i(0) = product of (0 - x_j) / (x_i - x_j) for j != i
        // In GF(256): (0 - x_j) = x_j (additive inverse = self in GF(2^n))
        //             (x_i - x_j) = x_i ^ x_j
        basis = gf256Mul(basis, gf256Div(xj, gf256Add(xi, xj)));
      }

      value = gf256Add(value, gf256Mul(yi, basis));
    }

    result[byteIdx] = value;
  }

  return result;
}

// =============================================================================
// Key Material Splitting (High-Level API)
// =============================================================================

/**
 * Generate recovery shares for key material using Shamir's Secret Sharing.
 * Splits the user's master key material into N shares where K are needed.
 *
 * The key material is first encrypted with a randomly generated Recovery
 * Encryption Key (REK). The REK is then split into shares. Both the
 * encrypted material and the shares are returned.
 *
 * @param {Object} keys - Key material to protect
 * @param {string} keys.masterKey - The master key material (hex or base64)
 * @param {Object} [keys.protocolKeys] - Optional additional protocol keys
 * @param {number} threshold - K: minimum shares needed (>= 2)
 * @param {number} totalShares - N: total shares to generate (<= 10)
 * @returns {{
 *   encryptedPayload: string,
 *   payloadIv: string,
 *   payloadTag: string,
 *   shares: Array<{ index: number, shareData: string }>,
 *   threshold: number,
 *   totalShares: number,
 * }}
 */
function generateRecoveryShares(keys, threshold, totalShares) {
  if (!keys || !keys.masterKey) {
    throw new Error('keys.masterKey is required');
  }

  // Generate a random Recovery Encryption Key (REK)
  const rek = randomBytes(32);

  // Encrypt the key material with REK using AES-256-GCM
  const payload = JSON.stringify(keys);
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, rek, iv, { authTagLength: AES_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Split the REK into shares using Shamir's SSS
  const rekShares = splitSecret(rek, threshold, totalShares);

  return {
    encryptedPayload: encrypted.toString('base64'),
    payloadIv: iv.toString('hex'),
    payloadTag: authTag.toString('hex'),
    shares: rekShares.map(s => ({
      index: s.index,
      shareData: s.data.toString('base64'),
    })),
    threshold,
    totalShares,
  };
}

/**
 * Reconstruct key material from K Shamir shares.
 *
 * @param {Array<{ index: number, shareData: string }>} shares - K shares
 * @param {string} encryptedPayload - Base64-encoded encrypted key material
 * @param {string} payloadIv - Hex-encoded IV
 * @param {string} payloadTag - Hex-encoded auth tag
 * @returns {Object} The original keys object
 */
function reconstructFromShares(shares, encryptedPayload, payloadIv, payloadTag) {
  if (!shares || shares.length < MIN_THRESHOLD) {
    throw new Error(`Need at least ${MIN_THRESHOLD} shares`);
  }

  // Convert share format
  const shamirShares = shares.map(s => ({
    index: s.index,
    data: Buffer.from(s.shareData, 'base64'),
  }));

  // Reconstruct the REK
  const rek = reconstructSecret(shamirShares);

  // Decrypt the payload
  const iv = Buffer.from(payloadIv, 'hex');
  const tag = Buffer.from(payloadTag, 'hex');
  const decipher = createDecipheriv(AES_ALGORITHM, rek, iv, { authTagLength: AES_TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

// =============================================================================
// Passphrase-Based Backup (PBKDF2 + AES-256-GCM)
// =============================================================================

/**
 * Promisified PBKDF2 key derivation.
 * @param {string} passphrase
 * @param {Buffer} salt
 * @returns {Promise<Buffer>} 32-byte derived key
 */
function deriveKey(passphrase, salt) {
  return new Promise((resolve, reject) => {
    pbkdf2Callback(
      passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST,
      (err, key) => err ? reject(err) : resolve(key)
    );
  });
}

/**
 * Create a passphrase-encrypted backup of key material.
 * Uses PBKDF2 to derive an AES-256-GCM encryption key from the passphrase.
 *
 * @param {Object} keys - Key material to encrypt
 * @param {string} passphrase - User-chosen passphrase
 * @returns {Promise<{
 *   encryptedBlob: string,
 *   salt: string,
 *   iv: string,
 *   authTag: string,
 *   keyDerivation: string,
 * }>}
 */
async function createPassphraseBackup(keys, passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters');
  }

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(passphrase, salt);
  const iv = randomBytes(AES_IV_LENGTH);

  const plaintext = JSON.stringify(keys);
  const cipher = createCipheriv(AES_ALGORITHM, derivedKey, iv, { authTagLength: AES_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedBlob: encrypted.toString('base64'),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    keyDerivation: `pbkdf2-${PBKDF2_DIGEST}-${PBKDF2_ITERATIONS}`,
  };
}

/**
 * Restore key material from a passphrase-encrypted backup.
 *
 * @param {string} encryptedBlob - Base64-encoded ciphertext
 * @param {string} passphrase - The passphrase used during backup
 * @param {string} salt - Hex-encoded salt
 * @param {string} iv - Hex-encoded IV
 * @param {string} authTag - Hex-encoded auth tag
 * @returns {Promise<Object>} The original keys object
 */
async function restoreFromPassphrase(encryptedBlob, passphrase, salt, iv, authTag) {
  const saltBuf = Buffer.from(salt, 'hex');
  const derivedKey = await deriveKey(passphrase, saltBuf);

  const ivBuf = Buffer.from(iv, 'hex');
  const tagBuf = Buffer.from(authTag, 'hex');

  const decipher = createDecipheriv(AES_ALGORITHM, derivedKey, ivBuf, { authTagLength: AES_TAG_LENGTH });
  decipher.setAuthTag(tagBuf);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBlob, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

// =============================================================================
// Recovery Package Export
// =============================================================================

/**
 * Export all identity data as a portable recovery package.
 * The package contains all recoverable protocol identities and metadata
 * needed to restore an Omni-Account on a new device or platform instance.
 *
 * NOTE: The package is returned as a plaintext JSON object. The caller is
 * responsible for encrypting it (via passphrase backup or share splitting)
 * before storage or transmission.
 *
 * @param {Object} profile - Profile data from social_profiles.profile_index
 * @param {Object} [keyMaterial] - Optional key material to include
 * @returns {{
 *   packageId: string,
 *   version: string,
 *   createdAt: string,
 *   profile: Object,
 *   protocolIdentities: Object,
 *   keyMaterial: Object|null,
 * }}
 */
function exportRecoveryPackage(profile, keyMaterial = null) {
  if (!profile || !profile.webid) {
    throw new Error('Profile with webid is required');
  }

  return {
    packageId: `urn:peermesh:recovery:${randomUUID()}`,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      webid: profile.webid,
      omniAccountId: profile.omni_account_id,
      displayName: profile.display_name,
      username: profile.username,
      bio: profile.bio,
      avatarUrl: profile.avatar_url,
      bannerUrl: profile.banner_url,
      homepageUrl: profile.homepage_url,
      sourcePodUri: profile.source_pod_uri,
    },
    protocolIdentities: {
      activityPub: profile.ap_actor_uri || null,
      atProtocol: profile.at_did || null,
      nostr: profile.nostr_npub || null,
      dsnp: profile.dsnp_user_id || null,
      zot: profile.zot_channel_hash || null,
      matrix: profile.matrix_id || null,
      xmtp: profile.xmtp_address || null,
    },
    keyMaterial: keyMaterial,
  };
}

// =============================================================================
// Exports
// =============================================================================

export {
  // Core Shamir primitives (exposed for testing)
  splitSecret,
  reconstructSecret,

  // High-level recovery share API
  generateRecoveryShares,
  reconstructFromShares,

  // Passphrase backup API
  createPassphraseBackup,
  restoreFromPassphrase,

  // Recovery package
  exportRecoveryPackage,

  // Constants (exposed for validation)
  MIN_THRESHOLD,
  MAX_SHARES,
};

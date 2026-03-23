// =============================================================================
// Universal Manifest Module - Ed25519 Signing Infrastructure
// =============================================================================
// Implements the UM v0.2 SIGNATURE-PROFILE:
//   - Ed25519 keypair generation
//   - JCS (RFC 8785) canonicalization
//   - Manifest signing and verification
//
// Dependencies: node:crypto only (no external packages).
// =============================================================================

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';


// =============================================================================
// RFC 8785 JSON Canonicalization Scheme (JCS)
// =============================================================================
// Deterministic JSON serialization. Key rules:
//   1. Object keys sorted by UTF-16 code unit order
//   2. No whitespace
//   3. Numbers serialized per ES2015 Number.toString()
//   4. Strings escaped per JSON spec
//   5. Recursive for nested objects/arrays

/**
 * Canonicalize a JavaScript value per RFC 8785 (JCS).
 * Returns a deterministic UTF-8 JSON string.
 *
 * @param {*} value - Any JSON-serializable value
 * @returns {string} JCS-canonicalized JSON string
 */
function jcsCanonicalize(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(item => jcsCanonicalize(item));
    return '[' + items.join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const key of keys) {
      if (value[key] === undefined) continue;
      pairs.push(JSON.stringify(key) + ':' + jcsCanonicalize(value[key]));
    }
    return '{' + pairs.join(',') + '}';
  }
  return 'null';
}


// =============================================================================
// UM v0.2 Constants
// =============================================================================

const UM_CONTEXT = 'https://universalmanifest.net/ns/universal-manifest/v0.2/schema.jsonld';
const UM_MANIFEST_VERSION = '0.2';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours


// =============================================================================
// Ed25519 Keypair Generation
// =============================================================================

/**
 * Generate an Ed25519 keypair using node:crypto.
 * Returns the public key in SPKI/DER format (base64url) and the private
 * key in PKCS8/PEM format.
 *
 * @returns {{ publicKeySpkiB64: string, privateKeyPem: string }}
 */
function generateKeypair() {
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

  const publicKeySpkiB64 = Buffer.from(publicKey).toString('base64url');

  return {
    publicKeySpkiB64,
    privateKeyPem: privateKey,
  };
}


// =============================================================================
// Manifest Signing (Ed25519 + JCS) - UM v0.2
// =============================================================================

/**
 * Sign a manifest with Ed25519 over JCS-canonicalized content.
 *
 * Process per UM v0.2 SIGNATURE-PROFILE Section 4:
 *   1. Build manifest without signature block
 *   2. JCS-canonicalize to deterministic UTF-8 bytes
 *   3. Ed25519 sign those bytes
 *   4. Attach signature block with mandatory v0.2 fields
 *
 * @param {object} manifest - Unsigned manifest (must not have .signature)
 * @param {string} privateKeyPem - Ed25519 private key in PKCS8 PEM format
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64
 * @param {string} [keyRef] - DID or URI reference for the signing key
 * @returns {object} Signed manifest (manifest + signature block)
 */
function signManifest(manifest, privateKeyPem, publicKeySpkiB64, keyRef) {
  // Ensure no existing signature block
  const { signature: _removed, ...manifestWithoutSig } = manifest;

  // Step 1: JCS canonicalize
  const canonicalized = jcsCanonicalize(manifestWithoutSig);
  const payloadBytes = Buffer.from(canonicalized, 'utf8');

  // Step 2: Ed25519 sign
  const privateKey = createPrivateKey(privateKeyPem);
  const signatureBuffer = sign(null, payloadBytes, privateKey);
  const signatureB64url = signatureBuffer.toString('base64url');

  // Step 3: Attach v0.2 signature block (mandatory fields)
  const signed = {
    ...manifestWithoutSig,
    signature: {
      algorithm: 'Ed25519',
      canonicalization: 'JCS-RFC8785',
      keyRef: keyRef || `${manifest.subject}#key-1`,
      publicKeySpkiB64,
      created: new Date().toISOString(),
      value: signatureB64url,
    },
  };

  return signed;
}


// =============================================================================
// Manifest Verification - UM v0.2 Verifier Checklist
// =============================================================================

/**
 * Verify a signed manifest per UM v0.2 verifier checklist.
 *
 * Per SIGNATURE-PROFILE Section 5:
 *   1. Confirm @type includes um:Manifest
 *   2. Enforce TTL (reject if now > expiresAt)
 *   3. Validate signature profile (algorithm + canonicalization)
 *   4. Obtain public key (embedded or keyRef)
 *   5. Recompute signing input and verify Ed25519
 *
 * @param {object} signedManifest - Manifest with signature block
 * @param {string} [publicKeySpkiB64Override] - Optional: override the embedded public key
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function verifyManifest(signedManifest, publicKeySpkiB64Override) {
  const errors = [];

  // Step 1: Confirm @type
  const types = signedManifest['@type'];
  const hasUmManifest = types === 'um:Manifest'
    || (Array.isArray(types) && types.includes('um:Manifest'));
  if (!hasUmManifest) {
    errors.push('@type must include um:Manifest');
  }

  // Validate v0.2 structural requirements
  if (signedManifest.manifestVersion !== UM_MANIFEST_VERSION) {
    errors.push(`manifestVersion must be ${UM_MANIFEST_VERSION}`);
  }

  if (!signedManifest.subject || typeof signedManifest.subject !== 'string') {
    errors.push('Missing or invalid subject');
  }

  // Validate issuedAt and expiresAt
  if (!signedManifest.issuedAt || !signedManifest.expiresAt) {
    errors.push('Missing issuedAt or expiresAt');
  } else {
    const issuedMs = Date.parse(signedManifest.issuedAt);
    const expiresMs = Date.parse(signedManifest.expiresAt);
    if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
      errors.push('issuedAt or expiresAt is not a valid ISO date-time');
    } else if (issuedMs > expiresMs) {
      errors.push('issuedAt must be <= expiresAt');
    }
  }

  // Step 2: TTL check
  if (signedManifest.expiresAt) {
    const expiresMs = Date.parse(signedManifest.expiresAt);
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
      errors.push('Manifest has expired');
    }
  }

  // Validate facets carry um:Facet @type
  if (signedManifest.facets) {
    if (!Array.isArray(signedManifest.facets)) {
      errors.push('facets must be an array');
    } else {
      for (const facet of signedManifest.facets) {
        if (!facet || typeof facet !== 'object') {
          errors.push('facet must be an object');
          continue;
        }
        const ft = facet['@type'];
        const hasFacetType = ft === 'um:Facet'
          || (Array.isArray(ft) && ft.includes('um:Facet'));
        if (!hasFacetType) {
          errors.push(`Missing um:Facet in facet @type for facet "${facet.name || 'unknown'}"`);
        }
      }
    }
  }

  // Step 3: Signature block checks (v0.2 mandatory)
  const sig = signedManifest.signature;
  if (!sig) {
    errors.push('Missing signature block (required in v0.2)');
    return { valid: false, errors };
  }
  if (sig.algorithm !== 'Ed25519') {
    errors.push(`Unsupported algorithm: ${sig.algorithm}. v0.2 requires Ed25519`);
  }
  if (sig.canonicalization !== 'JCS-RFC8785') {
    errors.push(`Unsupported canonicalization: ${sig.canonicalization}. v0.2 requires JCS-RFC8785`);
  }
  if (!sig.value || typeof sig.value !== 'string') {
    errors.push('Missing signature.value');
  }

  // Bail early if structural errors prevent verification
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Step 4: Get public key
  const pubKeyB64 = publicKeySpkiB64Override || sig.publicKeySpkiB64;
  if (!pubKeyB64) {
    return {
      valid: false,
      errors: ['No public key available (signature must include keyRef or publicKeySpkiB64)'],
    };
  }

  try {
    // Accept both standard base64 and base64url
    const pubKeyDer = Buffer.from(pubKeyB64, 'base64');
    const publicKey = createPublicKey({
      key: pubKeyDer,
      format: 'der',
      type: 'spki',
    });

    // Step 5: Remove signature, canonicalize, verify
    const { signature: _removed, ...manifestWithoutSig } = signedManifest;
    const canonicalized = jcsCanonicalize(manifestWithoutSig);
    const payloadBytes = Buffer.from(canonicalized, 'utf8');
    const signatureBytes = Buffer.from(sig.value, 'base64url');

    const isValid = verify(null, payloadBytes, publicKey, signatureBytes);

    if (!isValid) {
      return { valid: false, errors: ['Ed25519 signature verification failed'] };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, errors: [`Verification error: ${err.message}`] };
  }
}


export {
  // JCS
  jcsCanonicalize,

  // Constants
  UM_CONTEXT,
  UM_MANIFEST_VERSION,
  DEFAULT_TTL_MS,

  // Keypair
  generateKeypair,

  // Signing
  signManifest,
  verifyManifest,
};

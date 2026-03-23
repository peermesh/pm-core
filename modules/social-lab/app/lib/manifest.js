// =============================================================================
// Universal Manifest Generation, Signing, and Verification (F-030)
// =============================================================================
// Implements the Universal Manifest (UM) identity document for Social Lab.
//
// A UM is a portable, signed JSON-LD document carrying:
//   - Identity facet (WebID, DIDs, protocol keys)
//   - Social facet (followers, following counts)
//   - Protocol facet (which protocols are active)
//   - Spatial facet (placeholder pointers for Spatial Fabric)
//
// Signing: Ed25519 over RFC 8785 JCS-canonicalized content.
// Verification: Remove signature block, re-canonicalize, verify Ed25519.
//
// Dependencies: node:crypto only (no external packages).
// =============================================================================

import { randomUUID, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { pool } from '../db.js';

// =============================================================================
// RFC 8785 JSON Canonicalization Scheme (JCS)
// =============================================================================
// Deterministic JSON serialization. Key rules:
//   1. Object keys sorted by UTF-16 code unit order
//   2. No whitespace
//   3. Numbers serialized per ES2015 Number.toString()
//   4. Strings escaped per JSON spec
//   5. Recursive for nested objects/arrays
//
// This is a minimal correct implementation sufficient for manifest signing.

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
    // Per RFC 8785 Section 3.2.2.3: use ES2015 Number serialization
    if (!isFinite(value)) {
      return 'null';
    }
    // JSON.stringify handles -0 -> "0", integers, and floats correctly
    // per ES2015 Number::toString which is what RFC 8785 mandates
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    // JSON.stringify handles proper escaping per RFC 8785 Section 3.2.2.2
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(item => jcsCanonicalize(item));
    return '[' + items.join(',') + ']';
  }
  if (typeof value === 'object') {
    // Sort keys by UTF-16 code unit order (JavaScript default sort)
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const key of keys) {
      if (value[key] === undefined) continue; // skip undefined values
      pairs.push(JSON.stringify(key) + ':' + jcsCanonicalize(value[key]));
    }
    return '{' + pairs.join(',') + '}';
  }
  // Fallback (symbols, functions, etc.) -- not valid in JSON
  return 'null';
}


// =============================================================================
// Manifest Generation
// =============================================================================

const UM_CONTEXT = 'https://universalmanifest.net/ns/universal-manifest/v0.1/schema.jsonld';

/**
 * Build the identity facet from profile data.
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64url
 * @returns {object} Identity facet
 */
function buildIdentityFacet(profile, publicKeySpkiB64) {
  const entity = {
    '@id': profile.webid,
    '@type': ['foaf:Person'],
    webId: profile.webid,
    omniAccountId: profile.omni_account_id,
    displayName: profile.display_name || null,
    handle: profile.username || null,
    avatarUrl: profile.avatar_url || null,
    signingKey: {
      algorithm: 'Ed25519',
      publicKeySpkiB64,
    },
  };

  // Add protocol-specific DIDs if present
  if (profile.at_did) {
    entity.atProtocolDid = profile.at_did;
  }
  if (profile.nostr_npub) {
    entity.nostrNpub = profile.nostr_npub;
  }

  return {
    '@type': 'um:Facet',
    name: 'identity',
    entity,
  };
}

/**
 * Build the social facet from profile + graph data.
 * @param {object} profile - Profile row
 * @param {{ followers: number, following: number }} counts - Social graph counts
 * @returns {object} Social facet
 */
function buildSocialFacet(profile, counts) {
  return {
    '@type': 'um:Facet',
    name: 'social',
    entity: {
      '@type': ['um:SocialGraph'],
      followers: counts.followers || 0,
      following: counts.following || 0,
      handle: profile.username || null,
    },
  };
}

/**
 * Build the protocols facet listing which protocols are active.
 * @param {object} profile - Profile row
 * @returns {object} Protocols facet
 */
function buildProtocolsFacet(profile) {
  const protocols = {};

  if (profile.ap_actor_uri) {
    protocols.activitypub = {
      actorUri: profile.ap_actor_uri,
      active: true,
    };
  }

  if (profile.at_did) {
    protocols.atprotocol = {
      did: profile.at_did,
      active: true,
    };
  }

  if (profile.nostr_npub) {
    protocols.nostr = {
      npub: profile.nostr_npub,
      active: true,
    };
  }

  if (profile.dsnp_user_id) {
    protocols.dsnp = {
      userId: profile.dsnp_user_id,
      active: true,
    };
  }

  if (profile.zot_channel_hash) {
    protocols.zot = {
      channelHash: profile.zot_channel_hash,
      active: true,
    };
  }

  if (profile.matrix_id) {
    protocols.matrix = {
      mxid: profile.matrix_id,
      active: true,
    };
  }

  return {
    '@type': 'um:Facet',
    name: 'protocols',
    entity: {
      '@type': ['um:ProtocolRegistry'],
      ...protocols,
    },
  };
}

/**
 * Build the spatial facet (placeholder pointers for Spatial Fabric).
 * Social Lab does not manage spatial data -- only carries pointers.
 * @param {object} profile - Profile row
 * @returns {object} Spatial facet
 */
function buildSpatialFacet(profile) {
  return {
    '@type': 'um:Facet',
    name: 'spatial',
    entity: {
      '@type': ['um:SpatialPresence'],
      homeWorld: null,
      supportedWorlds: [],
      fabricRef: null,
    },
  };
}

/**
 * Generate an unsigned Universal Manifest from profile data.
 *
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64url
 * @param {{ followers: number, following: number }} [socialCounts] - Social graph counts
 * @param {string} [existingUmid] - Existing UMID to preserve on regeneration
 * @param {number} [version] - Manifest version number
 * @returns {object} Unsigned manifest (JSON-LD)
 */
function generateManifest(profile, publicKeySpkiB64, socialCounts, existingUmid, version) {
  const umid = existingUmid || `urn:uuid:${randomUUID()}`;
  const now = new Date().toISOString();
  // Default TTL: 24 hours
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const counts = socialCounts || { followers: 0, following: 0 };

  const manifest = {
    '@context': UM_CONTEXT,
    '@id': umid,
    '@type': ['um:Manifest'],
    manifestVersion: '0.1',
    subject: profile.webid,
    issuedAt: now,
    expiresAt,
    version: version || 1,
    facets: [
      buildIdentityFacet(profile, publicKeySpkiB64),
      buildSocialFacet(profile, counts),
      buildProtocolsFacet(profile),
      buildSpatialFacet(profile),
    ],
    consents: [
      {
        '@type': 'um:Consent',
        name: 'socialLab.profilePublic',
        value: 'allowed',
      },
    ],
  };

  return manifest;
}


// =============================================================================
// Manifest Signing (Ed25519 + JCS)
// =============================================================================

/**
 * Sign a manifest with Ed25519 over JCS-canonicalized content.
 *
 * Process per F-030 Section 2:
 *   1. Build manifest without signature block
 *   2. JCS-canonicalize to deterministic UTF-8 bytes
 *   3. Ed25519 sign those bytes
 *   4. Attach signature block
 *
 * @param {object} manifest - Unsigned manifest (must not have .signature)
 * @param {string} privateKeyPem - Ed25519 private key in PKCS8 PEM format
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64url
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

  // Step 3: Attach signature block
  const signed = {
    ...manifestWithoutSig,
    signature: {
      algorithm: 'Ed25519',
      canonicalization: 'JCS-RFC8785',
      keyRef: keyRef || manifest.subject || null,
      publicKeySpkiB64,
      created: new Date().toISOString(),
      value: signatureB64url,
    },
  };

  return signed;
}

/**
 * Verify a signed manifest's Ed25519 signature.
 *
 * Process per F-030 Section 2:
 *   1. Confirm @type includes um:Manifest
 *   2. Check TTL (reject if expired)
 *   3. Check signature.algorithm and signature.canonicalization
 *   4. Extract public key from signature.publicKeySpkiB64
 *   5. Remove signature block, JCS-canonicalize, verify
 *
 * @param {object} signedManifest - Manifest with signature block
 * @param {string} [publicKeySpkiB64Override] - Optional: override the embedded public key
 * @returns {{ valid: boolean, error?: string }}
 */
function verifyManifest(signedManifest, publicKeySpkiB64Override) {
  // Step 1: Confirm @type
  const types = signedManifest['@type'];
  if (!types || !Array.isArray(types) || !types.includes('um:Manifest')) {
    return { valid: false, error: '@type must include um:Manifest' };
  }

  // Step 2: TTL check
  if (signedManifest.expiresAt) {
    const expires = new Date(signedManifest.expiresAt);
    if (Date.now() > expires.getTime()) {
      return { valid: false, error: 'Manifest has expired' };
    }
  }

  // Step 3: Signature block checks
  const sig = signedManifest.signature;
  if (!sig) {
    return { valid: false, error: 'Missing signature block' };
  }
  if (sig.algorithm !== 'Ed25519') {
    return { valid: false, error: `Unsupported algorithm: ${sig.algorithm}` };
  }
  if (sig.canonicalization !== 'JCS-RFC8785') {
    return { valid: false, error: `Unsupported canonicalization: ${sig.canonicalization}` };
  }

  // Step 4: Get public key
  const pubKeyB64 = publicKeySpkiB64Override || sig.publicKeySpkiB64;
  if (!pubKeyB64) {
    return { valid: false, error: 'No public key available for verification' };
  }

  try {
    const pubKeyDer = Buffer.from(pubKeyB64, 'base64url');
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
      return { valid: false, error: 'Ed25519 signature verification failed' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}


// =============================================================================
// Manifest Persistence
// =============================================================================

/**
 * Fetch social graph counts for a WebID.
 * @param {string} webid
 * @returns {Promise<{ followers: number, following: number }>}
 */
async function getSocialCounts(webid) {
  const [followersResult, followingResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS count FROM social_graph.social_graph
       WHERE following_webid = $1 AND relationship = 'follow'`,
      [webid]
    ),
    pool.query(
      `SELECT COUNT(*) AS count FROM social_graph.social_graph
       WHERE follower_webid = $1 AND relationship = 'follow'`,
      [webid]
    ),
  ]);

  return {
    followers: parseInt(followersResult.rows[0].count, 10),
    following: parseInt(followingResult.rows[0].count, 10),
  };
}

/**
 * Generate, sign, and store a Universal Manifest for a user.
 *
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @param {{ publicKeySpkiB64: string, privateKeyPem: string }} keypair - Ed25519 keypair
 * @returns {Promise<object>} The signed manifest
 */
async function generateAndStoreManifest(profile, keypair) {
  const socialCounts = await getSocialCounts(profile.webid);

  // Check for existing manifest (to preserve UMID and increment version)
  const existing = await pool.query(
    `SELECT umid, version FROM social_keys.user_manifests
     WHERE user_webid = $1 AND is_active = TRUE
     LIMIT 1`,
    [profile.webid]
  );

  let umid = null;
  let version = 1;
  if (existing.rowCount > 0) {
    umid = existing.rows[0].umid;
    version = existing.rows[0].version + 1;

    // Deactivate previous version
    await pool.query(
      `UPDATE social_keys.user_manifests SET is_active = FALSE, updated_at = NOW()
       WHERE user_webid = $1 AND is_active = TRUE`,
      [profile.webid]
    );
  }

  // Generate unsigned manifest
  const manifest = generateManifest(
    profile,
    keypair.publicKeySpkiB64,
    socialCounts,
    umid,
    version
  );

  // Sign it
  const signedManifest = signManifest(
    manifest,
    keypair.privateKeyPem,
    keypair.publicKeySpkiB64,
    profile.webid
  );

  // Store
  const id = randomUUID();
  const manifestUmid = manifest['@id'];

  await pool.query(
    `INSERT INTO social_keys.user_manifests
       (id, user_webid, omni_account_id, manifest_json, signed_manifest, version, umid, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
    [
      id,
      profile.webid,
      profile.omni_account_id,
      JSON.stringify(manifest),
      JSON.stringify(signedManifest),
      version,
      manifestUmid,
    ]
  );

  console.log(`[manifest] Generated v${version} manifest for ${profile.username || profile.webid} (UMID: ${manifestUmid})`);

  return signedManifest;
}

/**
 * Retrieve the active signed manifest for a user by handle.
 *
 * @param {string} handle - Username/handle
 * @returns {Promise<object|null>} The signed manifest JSON, or null
 */
async function getManifestByHandle(handle) {
  const result = await pool.query(
    `SELECT m.signed_manifest
     FROM social_keys.user_manifests m
     JOIN social_profiles.profile_index p ON p.webid = m.user_webid
     WHERE p.username = $1 AND m.is_active = TRUE
     ORDER BY p.created_at ASC
     LIMIT 1`,
    [handle]
  );

  if (result.rowCount === 0) return null;
  return JSON.parse(result.rows[0].signed_manifest);
}

/**
 * Retrieve the active signed manifest by UMID.
 *
 * @param {string} umid - Universal Manifest ID (urn:uuid:...)
 * @returns {Promise<object|null>} The signed manifest JSON, or null
 */
async function getManifestByUmid(umid) {
  const result = await pool.query(
    `SELECT signed_manifest FROM social_keys.user_manifests
     WHERE umid = $1 AND is_active = TRUE
     LIMIT 1`,
    [umid]
  );

  if (result.rowCount === 0) return null;
  return JSON.parse(result.rows[0].signed_manifest);
}

export {
  // JCS canonicalization
  jcsCanonicalize,

  // Facet builders
  buildIdentityFacet,
  buildSocialFacet,
  buildProtocolsFacet,
  buildSpatialFacet,

  // Manifest lifecycle
  generateManifest,
  signManifest,
  verifyManifest,

  // Persistence
  getSocialCounts,
  generateAndStoreManifest,
  getManifestByHandle,
  getManifestByUmid,

  // Constants
  UM_CONTEXT,
};

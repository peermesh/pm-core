// =============================================================================
// Universal Manifest v0.2 — Generation, Signing, and Verification (F-030)
// =============================================================================
// Implements the Universal Manifest (UM) v0.2 spec for Social Lab.
//
// A UM is a portable, signed JSON-LD state capsule carrying:
//   - publicProfile facet — display name, bio, avatar, handle
//   - socialIdentity facet — all protocol identities (AP actor, Nostr npub, AT DID, etc.)
//   - socialGraph facet — follower/following counts, group memberships
//   - protocolStatus facet — which protocols are active/stub/unavailable
//   - Well-known pointers: profile URL, avatar URL, RSS feed URL
//   - Claims: protocol verifications
//   - Consents: default-deny model per ARCH-010 SSO mandate
//
// Signing: Ed25519 over RFC 8785 JCS-canonicalized content (v0.2 mandatory).
// Verification: Remove signature block, re-canonicalize, verify Ed25519.
//
// References:
//   - UM v0.2 spec: https://universalmanifest.net/spec/v02/
//   - UM v0.2 SIGNATURE-PROFILE: JCS-RFC8785 + Ed25519
//   - UM registry: REGISTRY.md well-known names
//
// Dependencies: node:crypto only (no external packages).
// =============================================================================

import { randomUUID, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { pool } from '../db.js';
import { BASE_URL, INSTANCE_DOMAIN } from './helpers.js';

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
// Facet Builders — UM v0.2 compliant
// =============================================================================

/**
 * Build the publicProfile facet per UM v0.2.
 * Uses schema:Person entity type for cross-system interop.
 *
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @returns {object} publicProfile facet
 */
function buildPublicProfileFacet(profile) {
  const entity = {
    '@id': profile.webid,
    '@type': 'schema:Person',
    name: profile.display_name || profile.username || null,
    description: profile.bio || null,
    image: profile.avatar_url || null,
    url: `${BASE_URL}/@${profile.username}`,
  };

  // Add handle as schema:alternateName
  if (profile.username) {
    entity.alternateName = `@${profile.username}@${INSTANCE_DOMAIN}`;
  }

  return {
    '@type': 'um:Facet',
    name: 'publicProfile',
    entity,
  };
}

/**
 * Build the socialIdentity facet — Omni-Account protocol identities.
 * Contains all protocol-specific identifiers for cross-protocol resolution.
 *
 * @param {object} profile - Profile row
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64
 * @returns {object} socialIdentity facet
 */
function buildSocialIdentityFacet(profile, publicKeySpkiB64) {
  const identities = {
    webId: profile.webid,
    omniAccountId: profile.omni_account_id,
  };

  // Protocol-specific identifiers
  if (profile.ap_actor_uri) {
    identities.activityPub = { actorUri: profile.ap_actor_uri };
  }
  if (profile.nostr_npub) {
    identities.nostr = { npub: profile.nostr_npub };
  }
  if (profile.at_did) {
    identities.atProtocol = { did: profile.at_did };
  }
  if (profile.dsnp_user_id) {
    identities.dsnp = { userId: profile.dsnp_user_id };
  }
  if (profile.zot_channel_hash) {
    identities.zot = { channelHash: profile.zot_channel_hash };
  }
  if (profile.matrix_id) {
    identities.matrix = { mxid: profile.matrix_id };
  }

  return {
    '@type': 'um:Facet',
    name: 'socialIdentity',
    entity: {
      '@id': profile.webid,
      '@type': 'um:Entity',
      signingKey: {
        algorithm: 'Ed25519',
        publicKeySpkiB64,
      },
      ...identities,
    },
  };
}

/**
 * Build the socialGraph facet — follower/following counts and group memberships.
 *
 * @param {object} profile - Profile row
 * @param {{ followers: number, following: number }} counts - Social graph counts
 * @param {string[]} [groups] - Group membership IDs
 * @returns {object} socialGraph facet
 */
function buildSocialGraphFacet(profile, counts, groups) {
  return {
    '@type': 'um:Facet',
    name: 'socialGraph',
    entity: {
      '@id': `${profile.webid}#social-graph`,
      '@type': 'um:Entity',
      followers: counts.followers || 0,
      following: counts.following || 0,
      groups: groups || [],
    },
  };
}

/**
 * Build the protocolStatus facet — which protocols are active/stub/unavailable.
 *
 * @param {object} profile - Profile row
 * @returns {object} protocolStatus facet
 */
function buildProtocolStatusFacet(profile) {
  const protocols = {
    activitypub: profile.ap_actor_uri
      ? { status: 'active', actorUri: profile.ap_actor_uri }
      : { status: 'unavailable' },
    atprotocol: profile.at_did
      ? { status: 'active', did: profile.at_did }
      : { status: 'unavailable' },
    nostr: profile.nostr_npub
      ? { status: 'active', npub: profile.nostr_npub }
      : { status: 'unavailable' },
    dsnp: profile.dsnp_user_id
      ? { status: 'active', userId: profile.dsnp_user_id }
      : { status: 'unavailable' },
    zot: profile.zot_channel_hash
      ? { status: 'active', channelHash: profile.zot_channel_hash }
      : { status: 'unavailable' },
    matrix: profile.matrix_id
      ? { status: 'active', mxid: profile.matrix_id }
      : { status: 'unavailable' },
  };

  return {
    '@type': 'um:Facet',
    name: 'protocolStatus',
    entity: {
      '@id': `${profile.webid}#protocol-status`,
      '@type': 'um:Entity',
      ...protocols,
    },
  };
}


// =============================================================================
// Pointer Builders — Well-known pointers per UM registry
// =============================================================================

/**
 * Build well-known pointers array for the manifest.
 *
 * @param {object} profile - Profile row
 * @returns {Array<object>} Array of pointer objects
 */
function buildPointers(profile) {
  const pointers = [];

  // Canonical profile URL
  if (profile.username) {
    pointers.push({
      name: 'profile.canonical',
      url: `${BASE_URL}/@${profile.username}`,
    });
  }

  // Avatar URL
  if (profile.avatar_url) {
    pointers.push({
      name: 'profile.avatar',
      url: profile.avatar_url,
    });
  }

  // Homepage
  if (profile.homepage_url) {
    pointers.push({
      name: 'profile.homepage',
      url: profile.homepage_url,
    });
  }

  // RSS feed
  if (profile.username) {
    pointers.push({
      name: 'feed.rss',
      url: `${BASE_URL}/feeds/${profile.username}.rss`,
    });
  }

  // Solid Pod
  if (profile.source_pod_uri) {
    pointers.push({
      name: 'solidPod.creatorCanonical',
      url: profile.source_pod_uri,
    });
  }

  // ActivityPub actor
  if (profile.ap_actor_uri) {
    pointers.push({
      name: 'activityPub.actor',
      url: profile.ap_actor_uri,
    });
  }

  // Universal Manifest self-reference
  if (profile.username) {
    pointers.push({
      name: 'universalManifest.current',
      url: `${BASE_URL}/.well-known/manifest/${profile.username}`,
    });
  }

  return pointers;
}


// =============================================================================
// Claims Builders — Protocol verifications
// =============================================================================

/**
 * Build claims array from profile verification data.
 *
 * @param {object} profile - Profile row
 * @returns {Array<object>} Array of claim objects
 */
function buildClaims(profile) {
  const claims = [];

  // Role claim
  claims.push({
    '@type': 'um:Claim',
    name: 'role',
    value: 'creator',
  });

  // Protocol verification claims
  if (profile.ap_actor_uri) {
    claims.push({
      '@type': 'um:Claim',
      name: 'verification.activitypub',
      value: 'verified',
      evidence: profile.ap_actor_uri,
    });
  }

  if (profile.at_did) {
    claims.push({
      '@type': 'um:Claim',
      name: 'verification.atprotocol',
      value: 'verified',
      evidence: profile.at_did,
    });
  }

  if (profile.nostr_npub) {
    claims.push({
      '@type': 'um:Claim',
      name: 'verification.nostr',
      value: 'verified',
      evidence: profile.nostr_npub,
    });
  }

  return claims;
}


// =============================================================================
// Consents — Default-deny model per ARCH-010 SSO mandate
// =============================================================================

/**
 * Build consents array with default-deny model.
 * Only explicitly allowed consents are present; everything else is denied by default.
 *
 * @param {object} [overrides] - Optional consent overrides
 * @returns {Array<object>} Array of consent objects
 */
function buildConsents(overrides = {}) {
  const defaults = {
    'social.profilePublic': 'allowed',
    'social.indexing': 'denied',
    'publicDisplay': 'denied',
    'analytics.proofOfPlay': 'denied',
    'telemetry.proofOfPlay': 'denied',
  };

  const merged = { ...defaults, ...overrides };

  return Object.entries(merged).map(([name, value]) => ({
    '@type': 'um:Consent',
    name,
    value,
  }));
}


// =============================================================================
// Manifest Generation — UM v0.2
// =============================================================================

/**
 * Generate an unsigned Universal Manifest v0.2 from profile data.
 *
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @param {string} publicKeySpkiB64 - Ed25519 public key in SPKI base64
 * @param {{ followers: number, following: number }} [socialCounts] - Social graph counts
 * @param {string} [existingUmid] - Existing UMID to preserve on regeneration
 * @param {number} [version] - Internal manifest version number
 * @param {{ ttlMs?: number, consents?: object }} [options] - Additional options
 * @returns {object} Unsigned manifest (JSON-LD)
 */
function generateManifest(profile, publicKeySpkiB64, socialCounts, existingUmid, version, options = {}) {
  const umid = existingUmid || `urn:uuid:${randomUUID()}`;
  const now = new Date();
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  const counts = socialCounts || { followers: 0, following: 0 };

  const manifest = {
    '@context': UM_CONTEXT,
    '@id': umid,
    '@type': 'um:Manifest',
    manifestVersion: UM_MANIFEST_VERSION,
    subject: profile.webid,
    issuedAt,
    expiresAt,
    facets: [
      buildPublicProfileFacet(profile),
      buildSocialIdentityFacet(profile, publicKeySpkiB64),
      buildSocialGraphFacet(profile, counts),
      buildProtocolStatusFacet(profile),
    ],
    claims: buildClaims(profile),
    consents: buildConsents(options.consents),
    pointers: buildPointers(profile),
  };

  // Internal version tracking (not part of UM spec, but useful for persistence)
  if (version) {
    manifest._socialLabVersion = version;
  }

  return manifest;
}


// =============================================================================
// Manifest Signing (Ed25519 + JCS) — UM v0.2
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
// Manifest Verification — UM v0.2 Verifier Checklist
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
 * Also validates:
 *   - manifestVersion === '0.2'
 *   - issuedAt <= expiresAt ordering
 *   - Required structural fields
 *
 * @param {object} signedManifest - Manifest with signature block
 * @param {string} [publicKeySpkiB64Override] - Optional: override the embedded public key
 * @returns {{ valid: boolean, error?: string, manifestVersion?: string }}
 */
function verifyManifest(signedManifest, publicKeySpkiB64Override) {
  // Step 1: Confirm @type
  const types = signedManifest['@type'];
  const hasUmManifest = types === 'um:Manifest'
    || (Array.isArray(types) && types.includes('um:Manifest'));
  if (!hasUmManifest) {
    return { valid: false, error: '@type must include um:Manifest' };
  }

  // Validate v0.2 structural requirements
  if (signedManifest.manifestVersion !== UM_MANIFEST_VERSION) {
    return { valid: false, error: `manifestVersion must be ${UM_MANIFEST_VERSION}` };
  }

  if (!signedManifest.subject || typeof signedManifest.subject !== 'string') {
    return { valid: false, error: 'Missing or invalid subject' };
  }

  // Validate issuedAt and expiresAt
  if (!signedManifest.issuedAt || !signedManifest.expiresAt) {
    return { valid: false, error: 'Missing issuedAt or expiresAt' };
  }

  const issuedMs = Date.parse(signedManifest.issuedAt);
  const expiresMs = Date.parse(signedManifest.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    return { valid: false, error: 'issuedAt or expiresAt is not a valid ISO date-time' };
  }
  if (issuedMs > expiresMs) {
    return { valid: false, error: 'issuedAt must be <= expiresAt' };
  }

  // Step 2: TTL check
  if (Date.now() > expiresMs) {
    return { valid: false, error: 'Manifest has expired' };
  }

  // Validate facets carry um:Facet @type
  if (signedManifest.facets) {
    if (!Array.isArray(signedManifest.facets)) {
      return { valid: false, error: 'facets must be an array' };
    }
    for (const facet of signedManifest.facets) {
      if (!facet || typeof facet !== 'object') {
        return { valid: false, error: 'facet must be an object' };
      }
      const ft = facet['@type'];
      const hasFacetType = ft === 'um:Facet'
        || (Array.isArray(ft) && ft.includes('um:Facet'));
      if (!hasFacetType) {
        return { valid: false, error: 'Missing um:Facet in facet @type' };
      }
    }
  }

  // Step 3: Signature block checks (v0.2 mandatory)
  const sig = signedManifest.signature;
  if (!sig) {
    return { valid: false, error: 'Missing signature block (required in v0.2)' };
  }
  if (sig.algorithm !== 'Ed25519') {
    return { valid: false, error: `Unsupported algorithm: ${sig.algorithm}. v0.2 requires Ed25519` };
  }
  if (sig.canonicalization !== 'JCS-RFC8785') {
    return { valid: false, error: `Unsupported canonicalization: ${sig.canonicalization}. v0.2 requires JCS-RFC8785` };
  }
  if (!sig.value || typeof sig.value !== 'string') {
    return { valid: false, error: 'Missing signature.value' };
  }

  // Step 4: Get public key
  const pubKeyB64 = publicKeySpkiB64Override || sig.publicKeySpkiB64;
  if (!pubKeyB64) {
    return { valid: false, error: 'No public key available (signature must include keyRef or publicKeySpkiB64)' };
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
      return { valid: false, error: 'Ed25519 signature verification failed' };
    }

    return { valid: true, manifestVersion: UM_MANIFEST_VERSION };
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
 * Generate, sign, and store a Universal Manifest v0.2 for a user.
 *
 * @param {object} profile - Profile row from social_profiles.profile_index
 * @param {{ publicKeySpkiB64: string, privateKeyPem: string }} keypair - Ed25519 keypair
 * @param {{ ttlMs?: number, consents?: object }} [options] - Additional options
 * @returns {Promise<object>} The signed manifest
 */
async function generateAndStoreManifest(profile, keypair, options = {}) {
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

  // Generate unsigned v0.2 manifest
  const manifest = generateManifest(
    profile,
    keypair.publicKeySpkiB64,
    socialCounts,
    umid,
    version,
    options
  );

  // Sign it with v0.2 mandatory Ed25519
  const signedManifest = signManifest(
    manifest,
    keypair.privateKeyPem,
    keypair.publicKeySpkiB64,
    `${profile.webid}#key-1`
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

  console.log(`[manifest] Generated v0.2 manifest v${version} for ${profile.username || profile.webid} (UMID: ${manifestUmid})`);

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


// =============================================================================
// Backward-compatible aliases
// =============================================================================
// These map old v0.1 facet builder names to v0.2 equivalents so that
// any existing callers continue to work without modification.

/** @deprecated Use buildPublicProfileFacet + buildSocialIdentityFacet */
function buildIdentityFacet(profile, publicKeySpkiB64) {
  return buildSocialIdentityFacet(profile, publicKeySpkiB64);
}

/** @deprecated Use buildSocialGraphFacet */
function buildSocialFacet(profile, counts) {
  return buildSocialGraphFacet(profile, counts);
}

/** @deprecated Use buildProtocolStatusFacet */
function buildProtocolsFacet(profile) {
  return buildProtocolStatusFacet(profile);
}

/** @deprecated Spatial facet removed in v0.2 — use pointers instead */
function buildSpatialFacet(_profile) {
  return {
    '@type': 'um:Facet',
    name: 'spatial',
    entity: {
      '@id': 'urn:placeholder:spatial',
      '@type': 'um:Entity',
      homeWorld: null,
      supportedWorlds: [],
      fabricRef: null,
    },
  };
}


export {
  // JCS canonicalization
  jcsCanonicalize,

  // v0.2 Facet builders
  buildPublicProfileFacet,
  buildSocialIdentityFacet,
  buildSocialGraphFacet,
  buildProtocolStatusFacet,

  // Pointer, claim, consent builders
  buildPointers,
  buildClaims,
  buildConsents,

  // Backward-compatible aliases (v0.1 names)
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
  UM_MANIFEST_VERSION,
  DEFAULT_TTL_MS,
};

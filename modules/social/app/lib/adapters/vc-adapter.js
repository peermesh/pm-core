// =============================================================================
// W3C Verifiable Credentials Adapter — Stub (Closest to Real Implementation)
// =============================================================================
// Status: 'stub' — W3C VCs are a stable standard (Recommendation, May 2025).
//         This adapter provides working stub implementations of issueCredential
//         and verifyCredential that return VC 2.0 compliant JSON-LD documents.
//
// Blueprint: .dev/blueprints/features/F-023-verifiable-credentials.md
// Work Order: WO-019 (Emerging Standards Adapters)
//
// W3C Verifiable Credentials 2.0 enhance the Omni-Account identity model
// with portable, verifiable claims: journalist credentials, moderator status,
// proof of humanity, organization membership. VCs are ADDITIVE to WebID/
// Omni-Account identity; they do NOT replace it.
//
// This adapter implements:
//   - issueCredential(profile, type, claims) -> VC-like JSON-LD document
//   - verifyCredential(vc) -> structural verification result
//   - Credential types: verified-journalist, community-moderator,
//     proof-of-humanity, org-membership
//   - W3C VC 2.0 data model structure
//
// For full production: cryptographic proofs (Ed25519Signature2020 or
// SD-JWT-VC), DID resolution, Bitstring Status List revocation, and the
// Digital Credentials API integration are needed.
//
// PROHIBITED:
//   - Replacing WebID or Omni-Account with VCs as primary identity
//   - Issuing VCs without user knowledge and consent
//   - Storing issuer signing keys in the Solid Pod
//   - Making VCs mandatory for basic platform participation
//   - Chat-related VCs (CEO Directive Section 4)
// =============================================================================

import { StubProtocolAdapter } from '../protocol-adapter.js';

// ---------------------------------------------------------------------------
// VC 2.0 Context and Constants
// ---------------------------------------------------------------------------
const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

// Supported credential types with their claim schemas
const CREDENTIAL_TYPES = Object.freeze({
  'verified-journalist': {
    vcType: 'JournalistCredential',
    description: 'Verifies journalist affiliation and press credentials',
    claimSchema: {
      required: ['affiliation'],
      optional: ['pressCardNumber', 'beat', 'hireDate'],
    },
    trustSignal: 'Content flagging threshold adjusted (less likely to be auto-flagged)',
    selectiveDisclosure: 'Reveal affiliation + beat only (prove role without name)',
  },
  'community-moderator': {
    vcType: 'ModeratorCredential',
    description: 'Attests moderator status and scope within a community',
    claimSchema: {
      required: ['communityId', 'moderationScope'],
      optional: ['grantedDate', 'experienceLevel', 'actionsCount'],
    },
    trustSignal: 'Fast-tracked moderation privilege requests on other platforms',
    selectiveDisclosure: 'Reveal community + scope only (prove role without personal details)',
  },
  'proof-of-humanity': {
    vcType: 'ProofOfHumanityCredential',
    description: 'Proves the account is operated by a real person without revealing identity',
    claimSchema: {
      required: ['verificationMethod'],
      optional: ['verificationDate', 'verificationLevel'],
    },
    trustSignal: 'Reduced Sybil suspicion, lower captcha frequency',
    selectiveDisclosure: 'Reveal verification method only (prove humanity without identity)',
  },
  'org-membership': {
    vcType: 'OrganizationMembershipCredential',
    description: 'Verifies organization affiliation and role',
    claimSchema: {
      required: ['organizationName', 'role'],
      optional: ['department', 'startDate', 'memberId'],
    },
    trustSignal: 'Verifiable affiliation without relying on platform verification',
    selectiveDisclosure: 'Reveal org + role only (prove affiliation without department)',
  },
});

// ---------------------------------------------------------------------------
// Stub Issuer Configuration
// ---------------------------------------------------------------------------
// In production, the issuer DID and signing key would come from the instance
// configuration. This stub uses placeholder values.
const STUB_ISSUER = Object.freeze({
  did: 'did:web:social.example.com',
  keyType: 'Ed25519',
  proofType: 'Ed25519Signature2020',
  note: 'Stub issuer. Production requires real DID and signing key.',
});

// ---------------------------------------------------------------------------
// Pod Storage Structure (extends DATA-001)
// ---------------------------------------------------------------------------
const POD_STORAGE = Object.freeze({
  issued: 'credentials/issued/{vc-id}.json',
  presentations: 'credentials/presentations/{pres-id}.json',
  issuance: 'credentials/issuance/{vc-id}.json',
  trustRegistry: 'credentials/trust-registry/trusted-issuers.json',
  revocations: 'credentials/revocations/status-list.json',
});

// ---------------------------------------------------------------------------
// Helper: Generate a deterministic-looking VC ID
// ---------------------------------------------------------------------------
function generateVcId(type, subjectId) {
  const timestamp = Date.now().toString(36);
  const typeHash = type.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return `urn:uuid:${Math.abs(typeHash).toString(16).padStart(8, '0')}-${timestamp}-stub`;
}

// ---------------------------------------------------------------------------
// Helper: Get current ISO timestamp
// ---------------------------------------------------------------------------
function isoNow() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Issue a Verifiable Credential following the W3C VC 2.0 data model.
 *
 * This is a stub implementation: the proof field contains a placeholder
 * (no real cryptographic signature). The VC structure is fully compliant
 * with the W3C Verifiable Credentials Data Model 2.0.
 *
 * @param {Object} profile - Social profile object
 * @param {string} profile.webId - User's WebID
 * @param {string} profile.name - User's display name
 * @param {string} type - Credential type key: 'verified-journalist',
 *   'community-moderator', 'proof-of-humanity', or 'org-membership'
 * @param {Object} claims - Claims to include in the credential.
 *   Must satisfy the required claims for the given type.
 * @returns {{ success: boolean, vc?: Object, error?: string }}
 */
function issueCredential(profile, type, claims) {
  // Validate credential type
  const credType = CREDENTIAL_TYPES[type];
  if (!credType) {
    return {
      success: false,
      error: `Unknown credential type: "${type}". Supported types: ${Object.keys(CREDENTIAL_TYPES).join(', ')}`,
    };
  }

  // Validate required claims
  const missingClaims = credType.claimSchema.required.filter(
    (field) => claims[field] === undefined || claims[field] === null
  );
  if (missingClaims.length > 0) {
    return {
      success: false,
      error: `Missing required claims for ${type}: ${missingClaims.join(', ')}`,
    };
  }

  // Validate profile has webId
  if (!profile || !profile.webId) {
    return {
      success: false,
      error: 'Profile must include a webId field',
    };
  }

  // Build the credential subject from provided claims
  const credentialSubject = { id: profile.webId };
  const allFields = [...credType.claimSchema.required, ...credType.claimSchema.optional];
  for (const field of allFields) {
    if (claims[field] !== undefined) {
      credentialSubject[field] = claims[field];
    }
  }

  const vcId = generateVcId(type, profile.webId);
  const now = isoNow();

  // Construct the W3C VC 2.0 JSON-LD document
  const vc = {
    '@context': [VC_CONTEXT_V2],
    id: vcId,
    type: ['VerifiableCredential', credType.vcType],
    issuer: STUB_ISSUER.did,
    validFrom: now,
    credentialSubject,
    // Stub proof — in production this would be a real Ed25519Signature2020
    // or SD-JWT-VC proof created by signing with the issuer's private key.
    proof: {
      type: STUB_ISSUER.proofType,
      created: now,
      verificationMethod: `${STUB_ISSUER.did}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: 'STUB_SIGNATURE_NOT_CRYPTOGRAPHICALLY_VALID',
      _stubNote: 'This is a structural stub. Production implementation requires real Ed25519 signing.',
    },
  };

  return {
    success: true,
    vc,
    metadata: {
      stub: true,
      credentialType: type,
      vcType: credType.vcType,
      podStoragePath: POD_STORAGE.issued.replace('{vc-id}', vcId),
    },
  };
}

/**
 * Verify a Verifiable Credential by checking its structural validity.
 *
 * This is a stub implementation: it checks the VC structure (required fields,
 * context, types, validity period) but does NOT perform cryptographic signature
 * verification or DID resolution. Production implementation needs:
 *   1. DID resolution to obtain the issuer's public key
 *   2. Cryptographic signature verification
 *   3. Bitstring Status List revocation checking
 *   4. Issuer trust registry lookup
 *
 * @param {Object} vc - The Verifiable Credential JSON-LD document to verify
 * @returns {{ valid: boolean, checks: Object, errors: string[] }}
 */
function verifyCredential(vc) {
  const errors = [];
  const checks = {
    hasContext: false,
    hasCorrectContext: false,
    hasType: false,
    isVerifiableCredential: false,
    hasIssuer: false,
    hasCredentialSubject: false,
    hasSubjectId: false,
    hasValidFrom: false,
    validFromNotFuture: false,
    notExpired: false,
    hasProof: false,
    hasProofType: false,
    hasVerificationMethod: false,
    // These would be true in production with real crypto:
    signatureValid: false,
    issuerResolved: false,
    revocationChecked: false,
  };

  if (!vc || typeof vc !== 'object') {
    errors.push('VC must be a non-null object');
    return { valid: false, checks, errors };
  }

  // Check @context
  if (vc['@context']) {
    checks.hasContext = true;
    const contexts = Array.isArray(vc['@context']) ? vc['@context'] : [vc['@context']];
    if (contexts.includes(VC_CONTEXT_V2)) {
      checks.hasCorrectContext = true;
    } else {
      errors.push(`Missing required context: ${VC_CONTEXT_V2}`);
    }
  } else {
    errors.push('VC must include @context');
  }

  // Check type
  if (vc.type) {
    checks.hasType = true;
    const types = Array.isArray(vc.type) ? vc.type : [vc.type];
    if (types.includes('VerifiableCredential')) {
      checks.isVerifiableCredential = true;
    } else {
      errors.push('VC type array must include "VerifiableCredential"');
    }
  } else {
    errors.push('VC must include type');
  }

  // Check issuer
  if (vc.issuer) {
    checks.hasIssuer = true;
    const issuerStr = typeof vc.issuer === 'string' ? vc.issuer : vc.issuer.id;
    if (!issuerStr || !issuerStr.startsWith('did:')) {
      errors.push('Issuer must be a DID (did:web:..., did:key:..., etc.)');
    }
  } else {
    errors.push('VC must include issuer');
  }

  // Check credentialSubject
  if (vc.credentialSubject) {
    checks.hasCredentialSubject = true;
    if (vc.credentialSubject.id) {
      checks.hasSubjectId = true;
    } else {
      errors.push('credentialSubject should include an id');
    }
  } else {
    errors.push('VC must include credentialSubject');
  }

  // Check validFrom
  if (vc.validFrom) {
    checks.hasValidFrom = true;
    const validFromDate = new Date(vc.validFrom);
    if (!isNaN(validFromDate.getTime())) {
      // Allow a small tolerance (1 minute) for clock skew
      const now = new Date();
      if (validFromDate.getTime() <= now.getTime() + 60000) {
        checks.validFromNotFuture = true;
      } else {
        errors.push('VC validFrom is in the future');
      }
    } else {
      errors.push('VC validFrom is not a valid ISO 8601 date');
    }
  } else {
    errors.push('VC must include validFrom');
  }

  // Check validUntil (optional, but if present must not be expired)
  if (vc.validUntil) {
    const validUntilDate = new Date(vc.validUntil);
    if (!isNaN(validUntilDate.getTime())) {
      if (validUntilDate.getTime() > Date.now()) {
        checks.notExpired = true;
      } else {
        errors.push('VC has expired (validUntil is in the past)');
      }
    } else {
      errors.push('VC validUntil is not a valid ISO 8601 date');
    }
  } else {
    // No expiry set — credential does not expire
    checks.notExpired = true;
  }

  // Check proof
  if (vc.proof) {
    checks.hasProof = true;
    if (vc.proof.type) {
      checks.hasProofType = true;
    } else {
      errors.push('Proof must include type');
    }
    if (vc.proof.verificationMethod) {
      checks.hasVerificationMethod = true;
    } else {
      errors.push('Proof must include verificationMethod');
    }

    // Stub: we cannot verify the actual signature
    checks.signatureValid = false; // Would be true with real crypto
    checks.issuerResolved = false; // Would be true with DID resolution
    checks.revocationChecked = false; // Would be true with status list check
  } else {
    errors.push('VC must include proof');
  }

  // Determine overall structural validity
  // (ignoring signatureValid, issuerResolved, revocationChecked which need real crypto)
  const structuralChecks = [
    checks.hasContext,
    checks.hasCorrectContext,
    checks.hasType,
    checks.isVerifiableCredential,
    checks.hasIssuer,
    checks.hasCredentialSubject,
    checks.hasValidFrom,
    checks.validFromNotFuture,
    checks.notExpired,
    checks.hasProof,
    checks.hasProofType,
    checks.hasVerificationMethod,
  ];
  const structurallyValid = structuralChecks.every(Boolean);

  return {
    valid: structurallyValid,
    structurallyValid,
    cryptographicallyValid: false, // Stub: no real signature verification
    errors,
    checks,
    _stubNote: structurallyValid
      ? 'VC is structurally valid per W3C VC 2.0. Cryptographic verification (signature, DID resolution, revocation) requires production implementation.'
      : 'VC has structural issues. See errors array.',
  };
}

// ---------------------------------------------------------------------------
// Adapter Class
// ---------------------------------------------------------------------------
export class VcAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'verifiable-credentials',
      version: '0.1.0',
      status: 'stub',
      description:
        'W3C Verifiable Credentials 2.0 adapter for portable trust and reputation. ' +
        'Stub implementation: issues VC-like JSON-LD documents and performs structural ' +
        'verification. Credential types: verified-journalist, community-moderator, ' +
        'proof-of-humanity, org-membership. W3C VCs are a stable Recommendation ' +
        '(May 2025); this is the closest to real implementation among emerging adapters.',
      requires: [
        'Ed25519 signing library for Data Integrity Proofs',
        'DID resolution library (did:web, did:key, did:plc)',
        'SD-JWT library for selective disclosure (@sd-jwt/sd-jwt-vc or equivalent)',
        'W3C Bitstring Status List for revocation checking',
        'W3C Digital Credentials API support (browser-native, with fallbacks)',
      ],
      stubNote:
        'VC adapter provides structural stubs for issueCredential() and ' +
        'verifyCredential(). VC documents follow W3C VC 2.0 JSON-LD structure ' +
        'but proofs are placeholder (not cryptographically valid). Production ' +
        'implementation requires Ed25519 signing, DID resolution, SD-JWT for ' +
        'selective disclosure, and Bitstring Status List for revocation.',
    });

    this.credentialTypes = CREDENTIAL_TYPES;
    this.stubIssuer = STUB_ISSUER;
    this.podStorage = POD_STORAGE;
  }

  /**
   * Issue a Verifiable Credential for a user profile.
   *
   * @param {Object} profile - Social profile ({ webId, name, ... })
   * @param {string} type - One of: 'verified-journalist', 'community-moderator',
   *   'proof-of-humanity', 'org-membership'
   * @param {Object} claims - Claims to include (must satisfy required fields for the type)
   * @returns {{ success: boolean, vc?: Object, error?: string, metadata?: Object }}
   */
  issueCredential(profile, type, claims) {
    return issueCredential(profile, type, claims);
  }

  /**
   * Verify a Verifiable Credential by checking its structural validity.
   *
   * @param {Object} vc - VC JSON-LD document
   * @returns {{ valid: boolean, structurallyValid: boolean, cryptographicallyValid: boolean, checks: Object, errors: string[] }}
   */
  verifyCredential(vc) {
    return verifyCredential(vc);
  }

  /**
   * Get the supported credential types and their schemas.
   * @returns {Object}
   */
  getCredentialTypes() {
    return this.credentialTypes;
  }

  /**
   * Get the Pod storage structure for VCs.
   * @returns {Object}
   */
  getPodStorage() {
    return this.podStorage;
  }

  // --- ProtocolAdapter interface overrides ---

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: profile?.webId || null,
      metadata: {
        stub: true,
        note:
          'VC identity is the user WebID (or a DID derived from it). ' +
          'VCs attach claims TO the identity; they do not replace it. ' +
          'Issuer DID for this instance: ' + STUB_ISSUER.did,
        issuerDid: STUB_ISSUER.did,
        supportedCredentialTypes: Object.keys(CREDENTIAL_TYPES),
        podStoragePath: 'credentials/',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'VC adapter is a structural stub (no cryptographic signing or DID resolution)',
      details: {
        stubCapabilities: [
          'issueCredential() — returns W3C VC 2.0 JSON-LD with placeholder proof',
          'verifyCredential() — checks structural validity (not cryptographic)',
        ],
        productionRequirements: this.requires,
        credentialTypes: Object.keys(CREDENTIAL_TYPES),
        standardStatus: 'W3C Recommendation (stable, May 2025)',
        closestToProduction: true,
        issuerDid: STUB_ISSUER.did,
        proofType: STUB_ISSUER.proofType,
        podStorage: POD_STORAGE,
      },
    };
  }

  toJSON() {
    return {
      ...super.toJSON(),
      credentialTypes: Object.keys(CREDENTIAL_TYPES),
      standardStatus: 'W3C Recommendation (stable)',
      stubCapabilities: ['issueCredential', 'verifyCredential'],
    };
  }
}

// Export standalone functions for direct use (e.g., from route handlers)
export { issueCredential, verifyCredential, CREDENTIAL_TYPES, VC_CONTEXT_V2 };

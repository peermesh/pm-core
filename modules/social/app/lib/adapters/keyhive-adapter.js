// =============================================================================
// Keyhive + Beelay Adapter — Design Only
// =============================================================================
// Status: 'design-only' (pre-production; Ink & Switch BeeKEM/Beelay)
//
// Blueprint: .dev/blueprints/features/F-022-keyhive-beelay-integration.md
// Work Order: WO-019 (Emerging Standards Adapters)
//
// Keyhive+Beelay is the most complete local-first social substrate available.
// BeeKEM provides offline-capable group key agreement (MLS-inspired but
// designed for concurrent/offline CRDT contexts). Beelay provides E2E
// encrypted multi-document sync. Integration with Automerge 3 (already in
// collab module) is a natural fit.
//
// This adapter documents how BeeKEM maps to our GroupEncryptionProvider
// interface (from WO-011, ARCH-005 Mechanic 7) and how Beelay would layer
// E2E encryption onto the existing Automerge CRDT architecture.
//
// PROHIBITED:
//   - Replacing Solid Pod as canonical identity source
//   - Chat or messaging over Beelay (CEO Directive Section 4)
//   - Making Keyhive+Beelay a hard dependency
//   - Storing unencrypted key material in the Solid Pod
//   - Breaking backward compat with existing Automerge documents
//   - Pod server or platform operator access to decrypted content
// =============================================================================

import { StubProtocolAdapter } from '../protocol-adapter.js';

// ---------------------------------------------------------------------------
// BeeKEM-to-GroupEncryptionProvider Interface Mapping
// ---------------------------------------------------------------------------
// GroupEncryptionProvider (encryption-provider.js) defines the abstract
// interface that all encryption providers must implement. BeeKEM would be
// registered as a provider alongside AesGcmProvider (Phase 1) and
// MlsEncryptionProvider (Phase 2, F-019).
//
// BeeKEM is specifically designed for local-first / offline CRDT contexts,
// whereas MLS (F-019) is for server-mediated real-time messaging groups.
// Both coexist: MLS for messaging, BeeKEM for document collaboration.
// ---------------------------------------------------------------------------
const BEEKEM_PROVIDER_MAPPING = Object.freeze({
  providerId: 'beekem-keyhive',

  // Maps to GroupEncryptionProvider.capabilities
  capabilities: {
    supportsPostQuantum: false,      // Not currently; future consideration
    maxGroupSize: null,              // No hard limit (performance degrades >1000)
    supportsExporterSecrets: true,   // Key derivation for document-specific keys
    supportsForwardSecrecy: true,    // Member removal rotates keys
    supportsPostCompromiseSecurity: true, // Self-update recovers security
    // BeeKEM-specific capabilities beyond the base interface:
    supportsOfflineKeyAgreement: true,   // Core differentiator from MLS
    supportsConcurrentOperations: true,  // CRDT-aware tree merges
    supportsCrdtContext: true,           // Designed for Automerge integration
  },

  // Maps to GroupEncryptionProvider methods
  methodMapping: {
    createGroup: {
      beekemOperation: 'Create Keyhive group; BeeKEM generates initial group key tree',
      returns: 'GroupHandle with BeeKEM tree root epoch',
      note: 'Group key tree is a CRDT operation that merges when peers sync',
    },
    addMember: {
      beekemOperation: 'Add member to BeeKEM tree; produces new epoch key',
      returns: 'GroupUpdateResult with keyRotated=true',
      offlineSupport: 'Addition works offline; tree update merges on sync',
      note: 'Unlike MLS, concurrent additions merge correctly via CRDT semantics',
    },
    removeMember: {
      beekemOperation: 'Remove member; rotate key material for forward secrecy',
      returns: 'GroupUpdateResult with keyRotated=true',
      forwardSecrecy: 'Removed member cannot decrypt future content',
      note: 'Removed member CAN still read content from before removal',
    },
    encrypt: {
      beekemOperation: 'Encrypt with document key derived from BeeKEM group key',
      returns: 'EncryptedPayload (AEAD with BeeKEM-derived key)',
      encryption: 'Authenticated encryption (AEAD)',
    },
    decrypt: {
      beekemOperation: 'Decrypt using group key for the given epoch',
      returns: 'Decrypted plaintext',
      note: 'Epoch tracking ensures correct key selection across key rotations',
    },
    exportSecret: {
      beekemOperation: 'Derive application-specific secret from current group key',
      returns: 'Derived key buffer',
      uses: 'Document keys, access tokens, content keys, spatial keys',
    },
    getGroupStatus: {
      beekemOperation: 'Return BeeKEM group tree state',
      returns: 'GroupHandle with current epoch, member count, tree depth',
    },
  },
});

// ---------------------------------------------------------------------------
// BeeKEM vs MLS Comparison
// ---------------------------------------------------------------------------
// BeeKEM (F-022) and MLS (F-019) serve different use cases and coexist.
// ---------------------------------------------------------------------------
const BEEKEM_VS_MLS = Object.freeze({
  onlineRequirement: {
    mls: 'Requires server-mediated key agreement',
    beekem: 'Works fully offline',
  },
  concurrency: {
    mls: 'Sequential commits only',
    beekem: 'Handles concurrent key operations (CRDT merge)',
  },
  crdtCompatibility: {
    mls: 'Not CRDT-aware',
    beekem: 'Designed for CRDT contexts (Automerge integration)',
  },
  groupRatcheting: {
    mls: 'Standard TreeKEM',
    beekem: 'TreeKEM-inspired, merge-friendly',
  },
  bestFor: {
    mls: 'Server-mediated messaging groups',
    beekem: 'Local-first document collaboration groups',
  },
  providerInterface: {
    mls: 'GroupEncryptionProvider (providerId: "mls-phase2")',
    beekem: 'GroupEncryptionProvider (providerId: "beekem-keyhive")',
  },
});

// ---------------------------------------------------------------------------
// Beelay Document Sync Architecture
// ---------------------------------------------------------------------------
// Beelay wraps Automerge with E2E encryption. The existing collab module
// (src/modules/collab/, 54 tests) provides the CRDT foundation.
// ---------------------------------------------------------------------------
const BEELAY_SYNC_ARCHITECTURE = Object.freeze({
  documentModel: {
    profileCard: 'Beelay document (Automerge CRDT)',
    post: 'Beelay document per post',
    socialGraph: 'Beelay document (following/followers)',
    mediaManifest: 'Beelay document (media blobs encrypted separately)',
  },
  encryptionFlow: {
    before: 'Automerge.change() -> Automerge.sync() -> Pod',
    after: 'Automerge.change() -> Beelay.encrypt() -> Beelay.sync() -> Pod (ciphertext)',
  },
  syncProtocol: [
    '1. Peers connect (TCP, QUIC/Iroh, WebSocket)',
    '2. Exchange Beelay sync messages (encrypted Automerge sync messages)',
    '3. Each peer decrypts using their group key',
    '4. Automerge merges decrypted operations into local state',
    '5. Conflict resolution by Automerge CRDT semantics (commutative, convergent)',
  ],
  podStorage: {
    encryptedDoc: 'encrypted-sync/{document-id}.beelay',
    keyMaterial: 'encrypted-sync/keys/{group-id}.keyhive',
    note: 'Pod stores ciphertext. Pod server cannot read content. Decryption is client-side.',
  },
  migrationPath: [
    '1. Existing Automerge documents continue to work (backward compatible)',
    '2. New documents can opt into Beelay encryption (per-document setting)',
    '3. Existing documents can be migrated (opt-in, re-encrypt with group key)',
  ],
});

// ---------------------------------------------------------------------------
// Keyhive Capability Model
// ---------------------------------------------------------------------------
// Keyhive capabilities map to OCapN (F-021) and Meadowcap (F-020).
// The key IS the capability: possession of the decryption/signing key
// grants the corresponding access level.
// ---------------------------------------------------------------------------
const KEYHIVE_CAPABILITY_MODEL = Object.freeze({
  readCapability: {
    mechanism: 'Possession of group decryption key',
    enforcement: 'Cryptographic (cannot decrypt without key)',
    ocapnEquivalent: 'OCapN read capability',
    solidWacEquivalent: 'acl:Read',
  },
  writeCapability: {
    mechanism: 'Possession of group signing key',
    enforcement: 'Cryptographic (changes rejected without valid signature)',
    ocapnEquivalent: 'OCapN write capability',
    solidWacEquivalent: 'acl:Write',
  },
  adminCapability: {
    mechanism: 'Ability to add/remove members from BeeKEM group',
    enforcement: 'Key tree management authority',
    ocapnEquivalent: 'OCapN meta-capability (can mint sub-capabilities)',
    solidWacEquivalent: 'acl:Control',
  },
  accessLevels: {
    public: 'No encryption (or widely-shared read key published in profile)',
    followersOnly: 'Read key issued to followers; only followers can decrypt',
    closeFriends: 'Read+write keys to friend group; friends can read and contribute',
    private: 'Key held only by user devices; only user devices can decrypt',
    moderator: 'Admin key for community group; moderators manage membership',
  },
});

// ---------------------------------------------------------------------------
// Social Group Types for BeeKEM
// ---------------------------------------------------------------------------
const BEEKEM_GROUP_TYPES = Object.freeze({
  followersOnly: {
    description: 'Group of followers with read keys',
    example: 'User followers can decrypt followers-only posts',
    keyType: 'read',
  },
  closeFriends: {
    description: 'Small group with read+write keys',
    example: 'Shared private feed between close friends',
    keyType: 'read+write',
  },
  community: {
    description: 'Large group with role-based keys',
    example: 'Community moderators have different keys than members',
    keyType: 'role-based (read for members, admin for mods)',
  },
  deviceSync: {
    description: 'Group of user own devices',
    example: 'User phone, laptop, tablet share keys for profile sync',
    keyType: 'read+write (all devices are equal)',
  },
});

// ---------------------------------------------------------------------------
// Deployment Mode Matrix
// ---------------------------------------------------------------------------
const DEPLOYMENT_MODES = Object.freeze({
  mode1_vps: {
    capability: 'Full',
    details: 'Local Beelay sync node, full BeeKEM group management, E2E encrypted storage, direct peer sync',
  },
  mode2_platform: {
    capability: 'Full',
    details: 'Platform provides Beelay relay infrastructure. Users documents are encrypted; platform cannot read content',
  },
  mode3_edge: {
    capability: 'Degraded',
    details: 'Beelay docs in Cloudflare R2/D1. BeeKEM keys in Workers Secrets. Client-side WASM Automerge decryption. Polling or Durable Objects for near-real-time.',
  },
  mode4_byop: {
    capability: 'Partial',
    details: 'Encrypted documents in external Pod. Full sync if user runs local Beelay agent, otherwise sync via platform relay when available',
  },
});

// ---------------------------------------------------------------------------
// Adapter Class
// ---------------------------------------------------------------------------
export class KeyhiveAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'keyhive-beelay',
      version: '0.0.1',
      status: 'stub', // StubProtocolAdapter enforces 'stub'; logical status is 'design-only'
      description:
        'Keyhive + Beelay adapter for local-first E2E encrypted document sync. ' +
        'Pre-production: Ink & Switch BeeKEM/Beelay are experimental. This adapter ' +
        'documents how BeeKEM maps to the GroupEncryptionProvider interface (WO-011) ' +
        'and how Beelay layers E2E encryption onto the existing Automerge CRDT ' +
        'architecture. Keyhive capabilities complement Solid WAC, OCapN, and Meadowcap.',
      requires: [
        'Keyhive library (Ink & Switch, TypeScript bindings)',
        'Beelay sync engine (E2E encrypted Automerge wrapper)',
        'BeeKEM group key agreement implementation',
        'Automerge 3 WASM build (for Edge/browser contexts)',
      ],
      stubNote:
        'Keyhive + Beelay stack is in pre-production (design-only phase). ' +
        'BeeKEM and Beelay are experimental projects from Ink & Switch. ' +
        'This adapter documents the integration architecture and how BeeKEM ' +
        'maps to the GroupEncryptionProvider interface. No runtime operations ' +
        'are available. See F-022 blueprint for full details.',
    });

    // Expose design documents
    this.designPhase = 'design-only';
    this.beekemProviderMapping = BEEKEM_PROVIDER_MAPPING;
    this.beekemVsMls = BEEKEM_VS_MLS;
    this.beelaySync = BEELAY_SYNC_ARCHITECTURE;
    this.keyhiveCapabilities = KEYHIVE_CAPABILITY_MODEL;
    this.beekemGroupTypes = BEEKEM_GROUP_TYPES;
    this.deploymentModes = DEPLOYMENT_MODES;
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        designOnly: true,
        note:
          'Keyhive identity would be established by creating a BeeKEM device group ' +
          'for the user. The group key tree provides cryptographic identity: ' +
          'possession of the key IS the authorization. WebID remains the canonical ' +
          'identity; Keyhive keys are linked via the Omni-Account.',
        deviceGroupConcept: 'BeeKEM device group with one initial member (this device)',
        keyType: 'BeeKEM group key tree (TreeKEM-inspired, CRDT-aware)',
        podStorage: 'encrypted-sync/keys/{group-id}.keyhive',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Keyhive + Beelay is in design-only phase (pre-production)',
      details: {
        designPhase: 'design-only',
        requires: this.requires,
        groupEncryptionProviderMapping: {
          providerId: BEEKEM_PROVIDER_MAPPING.providerId,
          allMethodsMapped: true,
          offlineKeyAgreement: true,
          crdtAware: true,
        },
        beelayIntegration: {
          automergeWrapped: true,
          e2eEncryption: true,
          selectiveSync: true,
          podStorageDefined: true,
        },
        deploymentModes: Object.fromEntries(
          Object.entries(DEPLOYMENT_MODES).map(([k, v]) => [k, v.capability])
        ),
      },
    };
  }

  // ----- Design inspection methods -----

  /**
   * Returns how BeeKEM methods map to the GroupEncryptionProvider interface.
   * This is the key design document: when BeeKEM is ready, a concrete
   * GroupEncryptionProvider subclass would implement each mapped method.
   * @returns {Object}
   */
  getProviderMapping() {
    return this.beekemProviderMapping;
  }

  /**
   * Returns the BeeKEM vs MLS comparison (F-022 vs F-019).
   * @returns {Object}
   */
  getBeekemVsMls() {
    return this.beekemVsMls;
  }

  /**
   * Returns the Beelay document sync architecture.
   * @returns {Object}
   */
  getBeelaySync() {
    return this.beelaySync;
  }

  /**
   * Returns the Keyhive capability model and access level mapping.
   * @returns {Object}
   */
  getKeyhiveCapabilities() {
    return this.keyhiveCapabilities;
  }

  /**
   * Returns the BeeKEM group types for Social.
   * @returns {Object}
   */
  getGroupTypes() {
    return this.beekemGroupTypes;
  }

  /**
   * Returns the deployment mode matrix.
   * @returns {Object}
   */
  getDeploymentModes() {
    return this.deploymentModes;
  }

  /**
   * Serialize adapter including design documentation.
   * @returns {Object}
   */
  toJSON() {
    return {
      ...super.toJSON(),
      designPhase: this.designPhase,
      groupEncryptionProviderMapped: true,
      beelayArchitectureDefined: true,
      keyhiveCapabilitiesDefined: true,
      beekemGroupTypesDefined: true,
      deploymentModesDefined: true,
    };
  }
}

// =============================================================================
// OCapN (Object Capability Network) Adapter — Design Only
// =============================================================================
// Status: 'design-only' (pre-production; Spritely Goblins not stable)
//
// Blueprint: .dev/blueprints/features/F-021-spritely-ocapn-integration.md
// Work Order: WO-019 (Emerging Standards Adapters)
//
// OCapN is a capability-based security model from the Spritely project,
// designed by Christine Lemmer-Webber (co-author of ActivityPub). Instead of
// identity-based ACLs ("who you are"), OCapN uses capability references
// ("what you hold"). Social interactions ARE capability operations.
//
// This adapter documents the capability model concepts and how they would map
// to Social's access control layer. No runtime implementation exists yet;
// the Spritely stack (Goblins, CapTP, Sturdyrefs) is pre-production.
//
// Implementation phases (from F-021):
//   Phase 0 (Now):  Blueprint design. This adapter documents the model.
//   Phase 1 (When OCapN spec finalized): TS-native capability objects
//                   following OCapN semantics (not dependent on Spritely runtime).
//   Phase 2 (When TS-native OCapN exists): OCapN-conformant library, CapTP.
//   Phase 3 (When Goblins ports to TS or polyglot bridge exists): Full actors.
//
// Go/no-go criteria for Phase 1:
//   - OCapN specification reaches Candidate Recommendation or equivalent
//   - At least one non-Guile OCapN implementation exists
//   - Brassica Chat demonstrates production-grade stability
//
// PROHIBITED:
//   - Replacing Solid WAC with OCapN as sole access control (OCapN complements)
//   - Chat or messaging via Goblins/CapTP (CEO Directive Section 4)
//   - Depending on Guile Scheme runtime for production
//   - Making OCapN a hard dependency (Social must work without it)
// =============================================================================

import { StubProtocolAdapter } from '../protocol-adapter.js';

// ---------------------------------------------------------------------------
// Capability Model: Social Resource-to-Capability Mapping
// ---------------------------------------------------------------------------
// This constant documents how Social resources map to OCapN capabilities.
// Each entry describes the resource, the capability type, and the invocable
// operations that the capability grants. This mapping is used to inform the
// design of Phase 1 TS-native capability objects.
//
// In OCapN, a capability is an unforgeable reference to an object.
// Possessing the reference IS the authorization to invoke it.
// No separate auth check is needed.
// ---------------------------------------------------------------------------
const CAPABILITY_MODEL = Object.freeze({
  // --- Profile capabilities ---
  publicProfile: {
    resource: 'Public profile',
    capabilityType: 'read-only (widely shared)',
    operations: ['getProfile()', 'getAvatar()'],
    attenuatedFrom: 'fullProfileWrite',
    solidWacEquivalent: 'acl:Read',
  },
  privateProfileFields: {
    resource: 'Private profile fields',
    capabilityType: 'restricted-read (friends only)',
    operations: ['getEmail()', 'getLocation()'],
    attenuatedFrom: 'fullProfileWrite',
    solidWacEquivalent: 'acl:Read (restricted audience)',
  },
  fullProfileWrite: {
    resource: 'Profile (full control)',
    capabilityType: 'write (held by owner only)',
    operations: ['updateProfile()', 'deleteProfile()'],
    solidWacEquivalent: 'acl:Write + acl:Control',
    meadowcapEquivalent: 'Willow-scoped write capability',
  },

  // --- Content capabilities ---
  publicPost: {
    resource: 'Post (public)',
    capabilityType: 'read (attenuated from author write cap)',
    operations: ['readPost()', 'getComments()'],
    attenuatedFrom: 'postWrite',
    solidWacEquivalent: 'acl:Read',
  },
  followersOnlyPost: {
    resource: 'Post (followers-only)',
    capabilityType: 'read (issued to followers only)',
    operations: ['readPost()'],
    attenuatedFrom: 'postWrite',
    solidWacEquivalent: 'acl:Read (audience-restricted)',
  },
  postWrite: {
    resource: 'Post (author control)',
    capabilityType: 'write (held by author)',
    operations: ['createPost()', 'editPost()', 'deletePost()'],
    solidWacEquivalent: 'acl:Write',
  },

  // --- Social graph capabilities ---
  followStream: {
    resource: 'Follow/subscription stream',
    capabilityType: 'subscription',
    operations: ['subscribe()', 'unsubscribe()'],
    solidWacEquivalent: 'acl:Read (feed container)',
  },

  // --- Moderation capabilities ---
  moderation: {
    resource: 'Moderation action',
    capabilityType: 'moderation (issued to moderators)',
    operations: ['flagContent()', 'removeContent()', 'review()'],
    solidWacEquivalent: 'acl:Write (moderation container)',
  },
});

// ---------------------------------------------------------------------------
// Social Interaction-to-Capability Mapping
// ---------------------------------------------------------------------------
// Every social interaction maps to an OCapN capability operation.
// This is the core philosophical bridge between social networking and
// capability-based security.
// ---------------------------------------------------------------------------
const INTERACTION_CAPABILITY_MAP = Object.freeze({
  sharePost: {
    interaction: 'Sharing a post',
    ocapnOperation: 'Passing a read capability for the post to the recipient',
  },
  follow: {
    interaction: 'Following a user',
    ocapnOperation: 'Receiving a subscription capability for the user feed',
  },
  unfollow: {
    interaction: 'Unfollowing',
    ocapnOperation: 'Dropping (not invoking) the subscription capability',
  },
  block: {
    interaction: 'Blocking a user',
    ocapnOperation: 'Revoking ALL capabilities held by the blocked user',
  },
  mute: {
    interaction: 'Muting a user',
    ocapnOperation: 'Local decision to not invoke the subscription capability (cap still held)',
  },
  inviteToGroup: {
    interaction: 'Inviting to a group',
    ocapnOperation: 'Passing a group-membership capability',
  },
  leaveGroup: {
    interaction: 'Leaving a group',
    ocapnOperation: 'Dropping the group-membership capability',
  },
  moderate: {
    interaction: 'Moderating content',
    ocapnOperation: 'Invoking a moderation capability on the content object',
  },
  like: {
    interaction: 'Liking a post',
    ocapnOperation: 'Invoking a react() method on the post capability',
  },
  followRequest: {
    interaction: 'Requesting follow',
    ocapnOperation: 'Sending a follow-request capability that, when accepted, returns a feed subscription capability',
  },
});

// ---------------------------------------------------------------------------
// Sturdyref URI Design
// ---------------------------------------------------------------------------
// Sturdyrefs are persistent, serializable capability URIs that survive process
// restarts and network reconnections. They consist of:
//   - A locator (which node hosts the object)
//   - A Swiss number (cryptographic secret proving authorization)
//   - Optional metadata (expiry, attenuation hints)
//
// URI format: ocapn://{node-id}/{swiss-number}
// Example:    ocapn://social-node-abc123/sn-7f8a9b2c
//
// Storage: user's Solid Pod under security/ocapn-sturdyrefs/
// Swiss numbers: encrypted at rest
// ---------------------------------------------------------------------------
const STURDYREF_SPEC = Object.freeze({
  uriScheme: 'ocapn',
  uriFormat: 'ocapn://{node-id}/{swiss-number}',
  storage: 'security/ocapn-sturdyrefs/',
  swissNumberEncryption: 'encrypted-at-rest (keystore-managed)',
  useCases: [
    'Shareable post link (read capability as URI)',
    'Invite link (follow-request capability)',
    'API access token (replaces OAuth with capability)',
    'Moderation delegation (moderator capability as URI)',
  ],
  revocationLog: 'security/ocapn-revocations/',
});

// ---------------------------------------------------------------------------
// Goblins Actor Architecture (Design)
// ---------------------------------------------------------------------------
// Social components modeled as Goblins actors for eventual distributed
// deployment. Each actor has internal state, a set of methods (invocable via
// capabilities), and a mailbox (sequential message processing).
// ---------------------------------------------------------------------------
const ACTOR_ARCHITECTURE = Object.freeze({
  profileActor: {
    responsibility: 'Manages user profile data',
    methods: ['getProfile()', 'updateField()', 'getAvatar()'],
  },
  feedActor: {
    responsibility: 'Manages user post feed',
    methods: ['publish()', 'getPost()', 'listPosts()'],
  },
  socialGraphActor: {
    responsibility: 'Manages follows, blocks',
    methods: ['follow()', 'unfollow()', 'block()', 'getFollowers()'],
  },
  notificationActor: {
    responsibility: 'Routes notifications',
    methods: ['notify()', 'subscribe()', 'getUnread()'],
  },
  moderationActor: {
    responsibility: 'Handles content moderation',
    methods: ['flag()', 'review()', 'takeAction()'],
  },
});

// ---------------------------------------------------------------------------
// Revocation Model
// ---------------------------------------------------------------------------
// OCapN uses the "caretaker" pattern: every delegated capability is wrapped
// in a proxy. The issuer holds a revocation handle. Invoking it invalidates
// the caretaker, failing all future invocations through it.
// Transitive revocation: revoking B's cap also revokes C's (derived from B).
// ---------------------------------------------------------------------------
const REVOCATION_MODEL = Object.freeze({
  mechanism: 'Caretaker pattern (proxy wrapper with revocation handle)',
  scenarios: {
    unfollow: 'Peer drops their subscription capability',
    block: 'User revokes ALL caretakers issued to the blocked user',
    unsharePost: 'User revokes the read caretaker for the post',
    removeFromGroup: 'Admin revokes the group-member caretaker',
    demoteModerator: 'Admin revokes the moderation caretaker',
    accountDeletion: 'User revokes ALL caretakers ever issued',
  },
  propagation: 'Immediate for connected peers (CapTP); next-connection for offline peers',
  transitiveRevocation: true,
  revocationLog: 'security/ocapn-revocations/ (timestamped, with capability IDs)',
});

// ---------------------------------------------------------------------------
// Cross-System Capability Mapping
// ---------------------------------------------------------------------------
// Maps between OCapN, Solid WAC, and Meadowcap (F-020) so that capability
// semantics are consistent regardless of which layer enforces them.
// ---------------------------------------------------------------------------
const CROSS_SYSTEM_MAP = Object.freeze({
  solidWac: {
    'acl:Read': 'OCapN read capability on resource',
    'acl:Write': 'OCapN write capability on resource',
    'acl:Control': 'OCapN meta-capability (can mint sub-capabilities)',
  },
  meadowcap: {
    meadowcapCapability: 'Willow-scoped capability maps to OCapN capability for Willow resources',
  },
  activityPub: {
    audienceTargeting: 'Set of capabilities issued to audience members',
    note: 'Capability-based interaction generates corresponding AP activity',
  },
  keyhive: {
    readKey: 'OCapN read capability (cryptographic: possession of decryption key)',
    writeKey: 'OCapN write capability (cryptographic: possession of signing key)',
    adminKey: 'OCapN meta-capability (manage group membership)',
  },
});

// ---------------------------------------------------------------------------
// Adapter Class
// ---------------------------------------------------------------------------
export class OcapnAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'ocapn',
      version: '0.0.1',
      status: 'stub', // StubProtocolAdapter enforces 'stub'; logical status is 'design-only'
      description:
        'OCapN (Object Capability Network) adapter for capability-based access control. ' +
        'Pre-production: Spritely Goblins/CapTP are not stable. This adapter documents ' +
        'the capability model design and how it maps to Social access control ' +
        '(Solid WAC, Meadowcap, Keyhive). Implementation begins when the OCapN spec ' +
        'reaches Candidate Recommendation and a non-Guile implementation exists.',
      requires: [
        'OCapN specification (Candidate Recommendation or equivalent)',
        'TypeScript-native OCapN library (or polyglot bridge to Guile)',
        'CapTP implementation for cross-node capability transport',
        'Goblins actor runtime (TS port or Guile interop)',
      ],
      stubNote:
        'OCapN is in pre-production (design-only phase). The Spritely stack ' +
        '(Goblins, CapTP, Sturdyrefs) is experimental. This adapter documents ' +
        'the capability model for Social. No runtime operations are available. ' +
        'See F-021 blueprint for implementation phases and go/no-go criteria.',
    });

    // Expose the design documents as adapter properties
    // so consumers and the protocol registry can inspect the capability model.
    this.designPhase = 'phase-0';
    this.capabilityModel = CAPABILITY_MODEL;
    this.interactionMap = INTERACTION_CAPABILITY_MAP;
    this.sturdyrefSpec = STURDYREF_SPEC;
    this.actorArchitecture = ACTOR_ARCHITECTURE;
    this.revocationModel = REVOCATION_MODEL;
    this.crossSystemMap = CROSS_SYSTEM_MAP;
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        designOnly: true,
        note:
          'OCapN identity would be a Goblins actor with a Sturdyref URI. ' +
          'Capability references (unforgeable, cryptographically secured) replace ' +
          'identity-based authorization. The actor URI format would be: ' +
          'ocapn://{node-id}/{swiss-number}. Phase 0: design only.',
        phase: 'phase-0',
        capabilityModel: 'Object capability (POLA: Principle of Least Authority)',
        solidWacComplement: 'OCapN complements Solid WAC; does not replace it',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'OCapN is in design-only phase (pre-production)',
      details: {
        designPhase: 'phase-0',
        requires: this.requires,
        goNoGoCriteria: [
          'OCapN specification reaches Candidate Recommendation',
          'At least one non-Guile OCapN implementation exists',
          'Brassica Chat demonstrates production-grade stability',
        ],
        implementationPhases: {
          'phase-0': 'Blueprint design (current)',
          'phase-1': 'TS-native capability objects following OCapN semantics',
          'phase-2': 'OCapN-conformant library with CapTP sessions',
          'phase-3': 'Full Goblins actor model for Social components',
        },
        capabilityModelDefined: true,
        interactionMappingDefined: true,
        revocationModelDefined: true,
        crossSystemMappingDefined: true,
      },
    };
  }

  // ----- Design inspection methods (not part of ProtocolAdapter interface) -----

  /**
   * Returns the full capability model mapping Social resources to OCapN caps.
   * @returns {Object}
   */
  getCapabilityModel() {
    return this.capabilityModel;
  }

  /**
   * Returns the social interaction-to-capability mapping.
   * @returns {Object}
   */
  getInteractionMap() {
    return this.interactionMap;
  }

  /**
   * Returns the Sturdyref URI specification for Social.
   * @returns {Object}
   */
  getSturdyrefSpec() {
    return this.sturdyrefSpec;
  }

  /**
   * Returns the Goblins actor architecture design.
   * @returns {Object}
   */
  getActorArchitecture() {
    return this.actorArchitecture;
  }

  /**
   * Returns the revocation model (caretaker pattern + scenarios).
   * @returns {Object}
   */
  getRevocationModel() {
    return this.revocationModel;
  }

  /**
   * Returns the cross-system capability mapping (OCapN <-> WAC, Meadowcap, Keyhive, AP).
   * @returns {Object}
   */
  getCrossSystemMap() {
    return this.crossSystemMap;
  }

  /**
   * Serialize adapter including design documentation.
   * @returns {Object}
   */
  toJSON() {
    return {
      ...super.toJSON(),
      designPhase: this.designPhase,
      capabilityModelDefined: true,
      interactionMappingDefined: true,
      actorArchitectureDefined: true,
      revocationModelDefined: true,
      sturdyrefSpecDefined: true,
      crossSystemMappingDefined: true,
    };
  }
}

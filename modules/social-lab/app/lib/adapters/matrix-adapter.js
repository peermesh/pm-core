// =============================================================================
// Matrix Protocol Adapter (Stub) — Identity Bridge Only
// =============================================================================
// Stub adapter for Matrix identity bridge per F-015 blueprint.
// Returns status: 'stub' and documents what the Matrix SDK needs for identity
// provisioning, profile sync, and WebID-to-Matrix-ID bridging.
//
// *** CRITICAL BOUNDARY ***
// Social Lab does NOT implement chat or messaging. This adapter handles ONLY:
//   - Matrix ID provisioning (@user:domain) as part of Omni-Account
//   - Profile synchronization (display name, avatar) from Social Lab -> Matrix
//   - Identity bridging (WebID <-> Matrix ID resolution)
// Actual messaging is handled by Matrix clients (Element, FluffyChat, etc.)
// or a separate chat module. CEO-MANDATORY-VISION Section 4.
//
// Blueprint: .dev/blueprints/features/F-015-matrix-messaging-surface.md
//
// What is needed for full implementation:
//   1. Matrix Client-Server API (v3) — For user provisioning, profile sync,
//      and room directory queries. Social Lab acts as an Application Service.
//      npm: matrix-js-sdk@^34.0.0 | License: Apache-2.0
//      OR direct HTTP calls to the homeserver API (no SDK dependency needed
//      for the limited identity bridge scope).
//   2. Matrix homeserver — External service, NOT inside Social Lab. Runs as a
//      separate Docker Compose service in Docker Lab.
//      Options: Synapse (Python, reference, feature-complete)
//               Dendrite (Go, lighter footprint)
//               Conduit (Rust, lightweight for small deployments)
//   3. Application Service (AS) registration — Social Lab registers as a Matrix
//      AS on the homeserver to reserve user namespaces and provision users
//      without individual passwords.
//   4. Admin API access — For user provisioning:
//      Synapse: PUT /_synapse/admin/v2/users/@user:domain
//      Other homeservers: equivalent admin endpoints.
//   5. Content repository access — For avatar upload to get mxc:// URIs:
//      POST /_matrix/media/v3/upload
//
// Version requirements:
//   - matrix-js-sdk >= 34.0.0 (Client-Server API v3) [Apache-2.0]
//     OR no SDK — direct HTTP to homeserver API is sufficient for identity bridge
//   - Matrix homeserver: Synapse >= 1.100, Dendrite >= 0.13, or Conduit >= 0.8
//   - Matrix spec: Client-Server API v1.11+, Application Service API v1.11+
//
// Deployment modes:
//   Mode 1 (VPS): Full — Self-hosted homeserver in Docker Lab, full provisioning + sync.
//   Mode 2 (Platform): Full — Platform-operated shared homeserver.
//   Mode 3 (Edge): Limited — Matrix ID provisioned on platform homeserver, profile page
//     shows Matrix ID, no local homeserver. Static snapshot for room directory.
//   Mode 4 (BYOP): Link existing Matrix ID (verification flow) or provision on platform homeserver.
//
// Key constraints (F-015):
//   - NO messaging, chat, or real-time communication in Social Lab.
//   - NO Matrix E2EE (Olm/Megolm) key management in Social Lab.
//   - NO room creation, management, or participation logic.
//   - Homeserver is an EXTERNAL service in Docker Lab, not inside Social Lab.
//   - Profile sync is ONE-DIRECTIONAL: Social Lab -> Matrix only.
//   - Access tokens are server-side only, never exposed to client.
//   - Matrix provisioning failure must NOT block other Omni-Account provisioning.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class MatrixAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'matrix',
      version: '0.0.1',
      status: 'stub',
      description: 'Matrix protocol identity bridge (NOT chat). Provisions Matrix ID (@user:domain) as part of Omni-Account, syncs profile data (display name, avatar) from Social Lab to Matrix homeserver, and bridges WebID <-> Matrix ID for cross-protocol identity discovery. Chat/messaging is handled by external Matrix clients or a separate module.',
      requires: [
        'Matrix homeserver (Synapse >= 1.100, Dendrite >= 0.13, or Conduit >= 0.8) — external Docker Compose service',
        'matrix-js-sdk@^34.0.0 (optional, direct HTTP is sufficient) [Apache-2.0]',
        'Application Service registration on homeserver (user namespace reservation)',
        'Admin API access (MATRIX_ADMIN_TOKEN env var)',
        'Content repository access for avatar upload (mxc:// URIs)',
        'Environment: MATRIX_HOMESERVER_URL, MATRIX_ADMIN_TOKEN, MATRIX_AS_TOKEN',
      ],
      stubNote: 'Matrix homeserver is not configured. Matrix ID provisioning, profile sync, and identity bridging require a running Matrix homeserver with admin API access. Social Lab registers as an Application Service. See F-015 blueprint. Note: This adapter is IDENTITY BRIDGE ONLY — no chat/messaging functionality.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Matrix ID (@username:domain) would be provisioned here via homeserver Admin API. ID stored in WebID as pmsl:matrixId, homeserver as pmsl:matrixHomeserver. Profile sync (display name + avatar) triggered after provisioning. Failure does NOT block other protocol provisioning.',
        webidPredicates: ['pmsl:matrixId', 'pmsl:matrixHomeserver'],
        pipelineStep: 'New step in LOGIC-001 (parallel with other protocol provisioning)',
        nonBlocking: true,
        pipelineStates: ['MATRIX_PROVISIONED', 'PENDING_RETRY'],
        profileSync: {
          direction: 'Social Lab -> Matrix (one-directional)',
          fields: {
            'foaf:name': 'displayname (PUT /_matrix/client/v3/profile/{userId}/displayname)',
            'foaf:depiction': 'avatar_url (upload via /_matrix/media/v3/upload, then set mxc:// URI)',
            'schema:description': 'Stored in account data or personal room topic (not natively supported)',
          },
        },
        identityBridge: {
          webidToMatrix: 'Read pmsl:matrixId from WebID card or DATA-002 local index',
          matrixToWebid: '.well-known/matrix-webid endpoint on Social Lab domain',
        },
        existingAccountLinking: 'Users with existing Matrix IDs can link via verification flow (one-time code sent to Matrix account)',
        boundaryEnforcement: 'NO chat, NO messaging, NO room management, NO E2EE key management',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Matrix homeserver is not configured (MATRIX_HOMESERVER_URL not set)',
      details: {
        requires: this.requires,
        homeserverUrl: process.env.MATRIX_HOMESERVER_URL || null,
        adminTokenSet: !!process.env.MATRIX_ADMIN_TOKEN,
        asTokenSet: !!process.env.MATRIX_AS_TOKEN,
        deploymentModes: {
          vps: 'Full (self-hosted homeserver in Docker Lab, full provisioning + sync)',
          platform: 'Full (platform-operated shared homeserver)',
          edge: 'Limited (Matrix ID on platform homeserver, static room directory snapshot)',
          byop: 'Link existing Matrix ID or provision on platform homeserver',
        },
        scope: 'IDENTITY BRIDGE ONLY — provisioning, profile sync, identity resolution. NO chat/messaging.',
        homeserverOptions: [
          'Synapse (Python, reference implementation, feature-complete)',
          'Dendrite (Go, lighter resource footprint)',
          'Conduit (Rust, lightweight for small deployments)',
        ],
        wellKnownEndpoints: [
          '/.well-known/matrix/server (federation delegation)',
          '/.well-known/matrix/client (client discovery)',
          '/.well-known/matrix-webid (Matrix ID -> WebID resolution)',
        ],
        webComponents: [
          '<pms-matrix-id-badge> (display Matrix ID with copy + matrix: URI link)',
          '<pms-matrix-link-account> (link existing external Matrix account)',
          '<pms-matrix-room-directory> (display user\'s public rooms on profile)',
          '<pms-matrix-room-card> (individual room entry with name, topic, member count)',
        ],
      },
    };
  }
}

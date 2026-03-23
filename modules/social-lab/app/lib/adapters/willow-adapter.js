// =============================================================================
// Willow + Iroh Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Willow + Iroh integration per F-020 blueprint.
// Returns status: 'stub' and documents what the iroh-willow stack needs for
// local-first data synchronization with range-based set reconciliation.
//
// Blueprint: .dev/blueprints/features/F-020-willow-iroh-integration.md
//
// *** PRE-PRODUCTION NOTICE ***
// iroh-willow is under active construction by the Iroh team. This adapter
// is designed for implementation when the upstream API stabilizes. The
// integration architecture is defined now; implementation is deferred.
//
// What is needed for full implementation:
//   1. iroh — Rust-native networking library providing QUIC transport, BLAKE3
//      content addressing, NAT traversal (DERP relays), and gossip pub-sub.
//      Crate: iroh (Rust) | npm: @number0/iroh (Node.js bindings, when stable)
//      License: MIT/Apache-2.0
//      Version: API is not yet stable — track github.com/n0-computer/iroh
//   2. iroh-willow — Willow protocol implementation over Iroh transport.
//      Provides range-based set reconciliation for efficient delta sync.
//      Crate: iroh-willow (Rust) | Status: Under active development
//      License: MIT/Apache-2.0
//   3. Meadowcap — Willow's capability-based access control system.
//      Provides read/write capabilities with delegation and zero-knowledge
//      proof support. Part of the Willow specification.
//   4. BLAKE3 — Hash function for content addressing, NamespaceId, SubspaceId.
//      Crate: blake3 (Rust) | npm: blake3 (WASM bindings)
//      License: CC0-1.0 / Apache-2.0
//   5. QUIC transport — Provided by Iroh. TLS 1.3 mandatory.
//   6. Iroh relay (DERP) servers — For NAT traversal. Social Lab can run its
//      own relay as part of Docker Lab infrastructure.
//
// Version requirements:
//   - iroh: track upstream (API not yet stable)
//   - iroh-willow: track upstream (under active construction)
//   - blake3@^1.0.0 (WASM bindings for Node.js) [CC0-1.0 / Apache-2.0]
//   - Node.js >= 18.0.0 (for N-API bindings to Rust)
//   - Rust toolchain (for building native iroh bindings if no npm package)
//
// Willow namespace parameterization for Social Lab:
//   - NamespaceId: 32-byte BLAKE3 hash of deployment instance domain
//   - SubspaceId: 32-byte BLAKE3 hash of user's WebID
//   - PayloadDigest: BLAKE3
//   - AuthorisationToken: Meadowcap capability
//   - Path structure mirrors DATA-001 Pod layout:
//     /{subspace}/profile/card, /profile/extended, /posts/{id},
//     /social/following, /social/followers, /media/avatar, etc.
//
// Deployment modes:
//   Mode 1 (VPS): Full — Local Iroh node, full Willow namespace, Meadowcap, gossip.
//   Mode 2 (Platform): Full — Platform relay infrastructure, per-user subspaces.
//   Mode 3 (Edge): Degraded — No persistent Iroh node (Workers can't hold QUIC).
//     Willow data serialized to R2/D1; on-demand sync via Iroh tickets.
//   Mode 4 (BYOP): Partial — Willow data alongside Pod. Relay mode if no local Iroh node.
//
// Key constraints (F-020):
//   - Willow is a COMPLEMENT/ALTERNATIVE to Solid for local-first sync, NOT a
//     replacement for Solid Pod identity. WebID stays in Pod.
//   - True deletion support (advantage over append-only protocols like SSB/Hypercore).
//   - Chat over Willow is NOT in scope (CEO Directive Section 4).
//   - Social Lab must function fully without Willow enabled.
//   - QUIC TLS mandatory for all Iroh connections.
//   - Meadowcap for all access control (no custom auth layer).

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class WillowAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'willow',
      version: '0.0.1',
      status: 'stub',
      description: 'Willow + Iroh local-first data sync protocol. Willow provides parameterizable data model with range-based set reconciliation and Meadowcap capability-based access control. Iroh provides QUIC transport, BLAKE3 content addressing, gossip pub-sub, and NAT traversal. Supports true deletion (advantage over append-only protocols). PRE-PRODUCTION: iroh-willow API is not yet stable.',
      requires: [
        'iroh (Rust crate or Node.js bindings, QUIC transport + BLAKE3 + gossip) [MIT/Apache-2.0] — API not yet stable',
        'iroh-willow (Willow protocol over Iroh, range-based set reconciliation) [MIT/Apache-2.0] — under active development',
        'Meadowcap (capability-based access control, part of Willow spec)',
        'blake3@^1.0.0 (WASM bindings for content addressing) [CC0-1.0 / Apache-2.0]',
        'QUIC TLS 1.3 transport (provided by Iroh)',
        'Optional: Iroh DERP relay server for NAT traversal',
        'Optional: Rust toolchain for building native iroh bindings',
      ],
      stubNote: 'Iroh + Willow SDK is not available (pre-production). Willow namespace design and Meadowcap capability model are defined but cannot be instantiated until iroh-willow stabilizes. See F-020 blueprint. Track progress at github.com/n0-computer/iroh.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Willow subspace would be allocated here. SubspaceId = BLAKE3(WebID). Iroh node ID (ed25519) published in WebID as pmsl:irohNodeId. Meadowcap root write capability generated for the user\'s subspace. This is an optional adapter, not a mandatory pipeline step.',
        webidPredicates: ['pmsl:irohNodeId'],
        keyType: 'ed25519 (Iroh node identity)',
        pipelineStep: 'Optional (not part of core Omni-Account pipeline)',
        nonBlocking: true,
        namespaceDesign: {
          namespaceId: 'BLAKE3(deployment domain)',
          subspaceId: 'BLAKE3(WebID)',
          payloadDigest: 'BLAKE3',
          authorisationToken: 'Meadowcap capability',
        },
        pathStructure: [
          '/{subspace}/profile/card',
          '/{subspace}/profile/extended',
          '/{subspace}/posts/{id}',
          '/{subspace}/social/following',
          '/{subspace}/social/followers',
          '/{subspace}/social/blocked',
          '/{subspace}/media/avatar',
          '/{subspace}/media/banner',
          '/{subspace}/media/{hash}',
          '/{subspace}/activity-log/{sequence}',
        ],
        preProductionNotice: 'iroh-willow is under active construction. Design now, implement when stable.',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Iroh + Willow SDK is not available (pre-production, API not stable)',
      details: {
        requires: this.requires,
        preProduction: true,
        upstreamStatus: 'iroh-willow under active development at github.com/n0-computer/iroh',
        deploymentModes: {
          vps: 'Full (local Iroh node, full Willow namespace, Meadowcap, gossip, P2P sync)',
          platform: 'Full (platform relay infrastructure, per-user subspaces)',
          edge: 'Degraded (no persistent Iroh node; Willow data serialized to R2/D1, on-demand sync via tickets)',
          byop: 'Partial (Willow data alongside Pod, relay mode if no local Iroh node)',
        },
        syncStrategies: {
          solidPrimary: 'Pod is source of truth; Willow mirrors for P2P sync',
          willowPrimary: 'Willow is source of truth; Pod mirrors for HTTP access and AP federation',
          hybrid: 'Both active; last-write-wins conflict resolution by Willow timestamp',
        },
        keyDifferentiators: {
          trueDeletion: 'Entries removed from all synced stores (not tombstoned)',
          rangeSyncEfficiency: 'Data transfer proportional to DIFFERENCE, not total dataset',
          meadowcapZkProofs: 'Prove capability possession without revealing the capability',
        },
        meadowcapMapping: {
          'acl:Read': 'Read capability on path prefix',
          'acl:Write': 'Write capability on path prefix',
          'acl:Control': 'Root capability (can delegate sub-capabilities)',
          'acl:Append': 'Write capability restricted to new paths only (app-enforced)',
        },
      },
    };
  }
}

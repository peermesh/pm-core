// =============================================================================
// Hypercore Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Hypercore / Pear Runtime integration per F-013 blueprint.
// Returns status: 'stub' and documents what the Hypercore ecosystem needs for
// full P2P data synchronization and feed replication.
//
// Blueprint: .dev/blueprints/features/F-013-hypercore-pear-integration.md
//
// What is needed for full implementation:
//   1. Hypercore (v10+) — Append-only signed log. Each user gets a Hypercore
//      feed initialized with a signed genesis entry (WebID, profile snapshot).
//      npm: hypercore@^10.0.0 | License: MIT
//   2. Hyperswarm (v4+) — DHT-based peer discovery and connection. Uses the
//      Noise protocol for encrypted connections. Joins DHT with the user's
//      discovery key.
//      npm: hyperswarm@^4.0.0 | License: MIT
//   3. Hyperbee — B-tree key/value store built on Hypercore. Used for indexed
//      lookups over feed entries.
//      npm: hyperbee@^2.0.0 | License: MIT
//   4. Hyperdrive (v11+) — P2P filesystem built on Hypercore. Mirrors select
//      Solid Pod content (profile/, media/, posts/) for offline/P2P access.
//      npm: hyperdrive@^11.0.0 | License: MIT
//   5. Corestore — Manages multiple Hypercore feeds under one storage backend.
//      npm: corestore@^6.0.0 | License: MIT
//   6. Pear Runtime (optional) — Desktop/mobile runtime for Pear applications.
//      Enables native P2P experience without web server infrastructure.
//      Install: npm i -g pear | Runtime: pear:// protocol
//      License: Apache-2.0
//   7. ed25519 Keypair — Feed identity. Generated during Omni-Account creation
//      (LOGIC-001 Step 5, parallel with AT Protocol DID and Nostr keypair).
//      Public key stored in WebID as pmsl:hypercoreKey, discovery key as
//      pmsl:hypercoreDiscoveryKey.
//
// Version requirements:
//   - hypercore >= 10.0.0 (v10 protocol, Merkle tree verification)
//   - hyperswarm >= 4.0.0 (Noise protocol encryption mandatory)
//   - hyperdrive >= 11.0.0 (v11 compatible with Hypercore v10)
//   - corestore >= 6.0.0 (multi-feed management)
//   - Node.js >= 18.0.0 (native crypto, ESM)
//   - Pear Runtime: latest stable (optional, for desktop/mobile deployment)
//
// Deployment modes:
//   Mode 1 (VPS): Full — Local Hypercore storage, Hyperswarm DHT, Hyperdrive.
//   Mode 2 (Platform): Full — Platform KMS for keypair, Hyperswarm relay.
//   Mode 3 (Edge): Degraded — No persistent state, no Hyperswarm (no persistent
//     connections in Cloudflare Workers). Falls back to HTTP-based sync.
//   Mode 4 (BYOP): Full if local agent, otherwise relay mode.
//   Pear Runtime: Full native — primary runtime, Hypercore-first.
//
// Key constraints (F-013):
//   - Hypercore is a COMPLEMENT to Solid Pod, NOT a replacement.
//   - Pod-wins conflict resolution for bidirectional sync.
//   - Chat over Hypercore is NOT in scope (CEO Directive Section 4).
//   - Social Lab must function fully without Hypercore enabled.
//   - All Hyperswarm connections use Noise protocol (no unencrypted peers).
//   - JSON-LD is the interchange format for data mapping.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class HypercoreAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'hypercore',
      version: '0.0.1',
      status: 'stub',
      description: 'Hypercore P2P append-only log protocol with Hyperswarm DHT discovery and Hyperdrive P2P filesystem. Requires Hypercore SDK ecosystem for feed replication, peer discovery, and offline-first data sync. Ed25519 keypair provisioned as part of Omni-Account; Hyperdrive mirrors select Solid Pod content for P2P access. Optional Pear Runtime for native desktop/mobile deployment.',
      requires: [
        'hypercore@^10.0.0 (append-only signed log, Merkle tree) [MIT]',
        'hyperswarm@^4.0.0 (DHT peer discovery, Noise protocol encryption) [MIT]',
        'hyperbee@^2.0.0 (B-tree key/value store on Hypercore) [MIT]',
        'hyperdrive@^11.0.0 (P2P filesystem, Pod content mirror) [MIT]',
        'corestore@^6.0.0 (multi-feed storage management) [MIT]',
        'ed25519 keypair generation (Omni-Account pipeline Step 5)',
        'Optional: Pear Runtime (pear:// protocol, native P2P app) [Apache-2.0]',
      ],
      stubNote: 'Hypercore SDK is not installed. Ed25519 keypair can be provisioned and cross-linked to WebID, but feed replication, Hyperswarm DHT participation, Hyperdrive filesystem, and P2P sync require the Hypercore ecosystem packages. See F-013 blueprint.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Ed25519 keypair would be generated here. Public key stored in WebID as pmsl:hypercoreKey, discovery key as pmsl:hypercoreDiscoveryKey. Genesis entry (WebID URI + profile snapshot + timestamp) would be appended to the primary Hypercore feed. Hyperdrive initialized with standard directory mapping (profile/, media/, posts/, meta/).',
        webidPredicates: ['pmsl:hypercoreKey', 'pmsl:hypercoreDiscoveryKey'],
        keyType: 'ed25519',
        pipelineStep: '5 (LOGIC-001, parallel with AT Protocol DID and Nostr keypair)',
        nonBlocking: true,
        feedGenesisEntry: {
          type: 'genesis',
          fields: ['webIdUri', 'profileSnapshot', 'timestamp'],
          signed: true,
        },
        hyperdriveDirs: ['profile/', 'media/', 'posts/', 'meta/'],
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Hypercore SDK is not installed or configured',
      details: {
        requires: this.requires,
        deploymentModes: {
          vps: 'Full (local Hypercore storage, Hyperswarm DHT, Hyperdrive)',
          platform: 'Full (platform KMS keypair, Hyperswarm relay)',
          edge: 'Degraded (no persistent state, no Hyperswarm, HTTP sync fallback)',
          byop: 'Full if local agent present, otherwise relay mode',
          pear: 'Full native (primary runtime, Hypercore-first)',
        },
        syncModel: {
          podToHyperdrive: 'Profile update -> Solid Notifications -> JSON-LD serialize -> Hyperdrive write -> peer replication',
          hyperdriveToPod: 'Offline edit -> Hypercore append -> Pod write on reconnect (Pod-wins conflict resolution)',
        },
        replication: {
          live: 'Sub-second latency over Hyperswarm (when peers connected)',
          sparse: 'Supported — peers can request specific feed ranges',
          multiWriter: 'Future — Autobase for multi-device append (restricted, requires approval)',
        },
      },
    };
  }
}

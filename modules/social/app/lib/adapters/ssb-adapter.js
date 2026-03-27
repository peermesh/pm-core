// =============================================================================
// Scuttlebutt (SSB) Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Scuttlebutt integration per F-010 blueprint.
// Returns status: 'stub' and documents what ssb-server needs for full
// gossip-based replication.
//
// Blueprint: .dev/blueprints/features/F-010-scuttlebutt-integration.md
//
// What is needed for full implementation:
//   1. SSB Daemon — ssb-server, go-ssb, or compatible implementation.
//      Runs as a persistent process for gossip protocol participation.
//      Communicates via MUXRPC protocol.
//   2. ed25519 Keypair — Feed identity. Public key in sigil format:
//      @{base64(pubkey)}.ed25519. Private key in server-side keystore.
//   3. Feed Storage — Append-only signed log in Solid Pod at activity-log/.
//      Each entry: { previous, sequence, author, timestamp, hash, content, signature }
//   4. EBT (Epidemic Broadcast Trees) — Gossip replication protocol.
//   5. Optional: Pub server and/or Room server for relay and discovery.
//
// Deployment modes:
//   Mode 1 (VPS): Full — SSB daemon in Docker, gossip active, pub/room optional.
//   Mode 2 (Platform): Full — Platform-hosted SSB infrastructure.
//   Mode 3 (Edge): Minimal — Feed generated and stored, no gossip, static JSON export.
//   Mode 4 (BYOP): Partial — Feed in Pod, gossip via platform pub or native SSB client.
//
// The SSB feed model (append-only signed log) is architecturally significant:
// it may become the canonical data structure in Phase 2+ (feed-as-source-of-truth).
// Phase 1 uses the complementary-layer model (feed alongside mutable Pod documents).

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class SsbAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'ssb',
      version: '0.0.1',
      status: 'stub',
      description: 'Scuttlebutt (SSB) offline-first peer-to-peer protocol. Requires ssb-server daemon for gossip replication. Feed identity (ed25519 keypair) is provisioned as part of Omni-Account; append-only feed is stored in Solid Pod at activity-log/. Gossip activates when a daemon is available.',
      requires: [
        'ssb-server or go-ssb daemon (persistent process)',
        'ed25519 keypair generation (feed identity)',
        'MUXRPC client for daemon communication',
        'EBT (Epidemic Broadcast Trees) for gossip replication',
        'Optional: pub server (ssb-pub) for relay',
        'Optional: room server (ssb-room v2) for tunnel connections',
      ],
      stubNote: 'SSB daemon (ssb-server) is not running. Feed identity can be provisioned (ed25519 keypair, @pubkey.ed25519 format) but gossip replication, peer discovery, and LAN sync require a running daemon. Feed entries can still be generated and stored in the Solid Pod. See F-010 blueprint.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'SSB Feed ID (@base64pubkey=.ed25519) would be generated here and linked to WebID via pmsl:ssbFeedId. Genesis "about" entry created in activity-log/feed.',
        webidPredicate: 'pmsl:ssbFeedId',
        keyType: 'ed25519',
        feedFormat: 'SSB message format v1 (JSON)',
        pipelineStep: '5b (LOGIC-001)',
        nonBlocking: true,
        feedStorage: 'activity-log/feed (Solid Pod, append-only)',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'SSB daemon (ssb-server) is not configured or running',
      details: {
        requires: this.requires,
        daemonEndpoint: process.env.SSB_HOST || null,
        daemonPort: process.env.SSB_PORT || null,
        deploymentModes: {
          vps: 'Full gossip (daemon in Docker, pub/room optional)',
          platform: 'Platform-hosted SSB infrastructure',
          edge: 'Feed-only (no gossip, static JSON export)',
          byop: 'Feed in Pod, gossip via platform pub or native client',
        },
        architecturalNote: 'SSB feed model may become canonical data structure in Phase 2+ (feed-as-source-of-truth). Phase 1 uses complementary-layer model.',
      },
    };
  }
}

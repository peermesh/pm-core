// =============================================================================
// Holochain Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Holochain integration per F-009 blueprint.
// Returns status: 'stub' and documents what the Holochain Conductor runtime
// needs for full participation.
//
// Blueprint: .dev/blueprints/features/F-009-holochain-integration.md
//
// What is needed for full implementation:
//   1. Holochain Conductor — The runtime that hosts hApps. Required for DHT
//      participation, agent-to-agent communication, and zome execution.
//      Image: holochain/holochain:latest (Docker).
//      Admin API: WebSocket, internal Docker network only (not public).
//   2. Social Lab hApp DNA — Rust/WASM compiled DNA with zomes:
//      profiles, connections, content, bridge.
//      Source: src/holochain/dna/social-lab-profiles/
//   3. ed25519 Keypair — Agent identity. Generated and stored in server-side
//      keystore. Public key becomes Agent ID (uhCAk... format).
//   4. HDK (Holochain Development Kit) — For DNA development (Rust).
//
// Deployment modes:
//   Mode 1 (VPS): Full — Conductor in Docker, DHT active.
//   Mode 2 (Platform): Full — Platform-hosted Conductor, multi-agent.
//   Mode 3 (Edge): Dormant — Agent ID generated, no DHT (no persistent process).
//   Mode 4 (BYOP): Dormant — Activates if user has Conductor access.
//
// The system MUST function without Holochain. Agent ID is generated as part
// of Omni-Account but DHT participation is optional.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class HolochainAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'holochain',
      version: '0.0.1',
      status: 'stub',
      description: 'Holochain agent-centric distributed protocol. Requires Holochain Conductor runtime for DHT participation, agent-to-agent communication, and zome execution. Agent identity (ed25519 keypair) is provisioned as part of Omni-Account; DHT participation activates when a Conductor is available.',
      requires: [
        'holochain-conductor (Docker: holochain/holochain:latest)',
        'social-lab-profiles DNA (Rust/WASM, compiled with hc dna pack)',
        'ed25519 keypair generation (server-side keystore)',
        'HDK (Holochain Development Kit) for DNA builds',
      ],
      stubNote: 'Holochain Conductor is not running. Agent identity can be provisioned (ed25519 keypair) but DHT participation, profile discovery, and agent-to-agent communication require a running Conductor. See F-009 blueprint.',
    });
  }

  // Override provisionIdentity to provide stub agent ID generation info
  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Holochain Agent ID (ed25519 keypair) would be generated here and linked to WebID via pmsl:holochainAgentId. Requires Conductor for DHT registration.',
        webidPredicate: 'pmsl:holochainAgentId',
        keyType: 'ed25519',
        pipelineStep: '5a (LOGIC-001)',
        nonBlocking: true,
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Holochain Conductor is not configured or running',
      details: {
        requires: this.requires,
        conductorEndpoint: process.env.HOLOCHAIN_CONDUCTOR_URL || null,
        deploymentModes: {
          vps: 'Full participation (Conductor in Docker compose)',
          platform: 'Platform-hosted Conductor',
          edge: 'Dormant (no persistent process)',
          byop: 'Dormant unless user has Conductor access',
        },
      },
    };
  }
}

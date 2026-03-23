// =============================================================================
// Braid Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Braid-HTTP integration per F-014 blueprint.
// Returns status: 'stub' and documents what the Braid-HTTP middleware needs
// for real-time, version-aware synchronization of Solid Pod resources.
//
// Blueprint: .dev/blueprints/features/F-014-braid-protocol-integration.md
//
// What is needed for full implementation:
//   1. braid-http — Reference implementation of the IETF Braid-HTTP draft.
//      Adds Version, Parents, Subscribe, and Patches headers to HTTP responses.
//      npm: braid-http@^0.2.0 | License: MIT
//      Spec: https://datatracker.ietf.org/doc/draft-toomim-httpbis-braid-http/
//   2. braid-text (optional) — CRDT-based merge for text documents.
//      npm: braid-text@^0.1.0 | License: MIT
//   3. Merge type implementations:
//      - JSON Merge Patch (RFC 7396) — Default for JSON-LD Pod documents.
//      - SPARQL Update — Alternative for Turtle Pod documents.
//      - Yjs passthrough — For collaborative documents already using Yjs CRDTs.
//   4. Version store — Database for version DAG (content-addressed SHA-256 hashes).
//      Mode 1 (VPS): Local database alongside DATA-002 index.
//      Mode 2 (Platform): Platform database.
//      Mode 3 (Edge): Cloudflare KV (limited history).
//      Mode 4 (BYOP): .braid/ container within the Pod.
//   5. HTTP middleware framework — Express/Hono/similar for intercepting
//      Pod HTTP responses and adding Braid headers.
//
// Version requirements:
//   - braid-http >= 0.2.0 (IETF draft compliance)
//   - Node.js >= 18.0.0 (native crypto for SHA-256, ESM)
//   - Yjs >= 13.0.0 (for collaborative document merge, already in architecture)
//
// Deployment modes:
//   Mode 1 (VPS): Full — Long-lived HTTP subscriptions via Traefik, full version history.
//   Mode 2 (Platform): Full — Long-lived subscriptions, platform DB for versions.
//   Mode 3 (Edge): Degraded — SSE fallback via Durable Objects, LWW merge only.
//   Mode 4 (BYOP): Depends on external Pod Braid support; falls back to polling.
//
// Key constraints (F-014):
//   - Braid EXTENDS HTTP, does NOT replace it. Non-Braid clients work unchanged.
//   - Braid is a complement to Solid Notifications, not a replacement.
//   - Chat over Braid is NOT in scope (CEO Directive Section 4).
//   - Social Lab must function fully with Braid disabled (polling fallback).
//   - SHA-256 content hashes for version identification.
//   - JSON Merge Patch (RFC 7396) as default patch format.
//   - Sync hierarchy: Braid > Solid Notifications > AP Update > Polling.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class BraidAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'braid',
      version: '0.0.1',
      status: 'stub',
      description: 'Braid-HTTP protocol for real-time, version-aware synchronization of Solid Pod resources. Extends HTTP with Version, Parents, Subscribe, and Patches headers per IETF draft. Provides subscription-based push updates and merge semantics (LWW, Add-Wins Set, Yjs passthrough) for conflict-free concurrent writes. Replaces polling with real-time patch delivery.',
      requires: [
        'braid-http@^0.2.0 (IETF Braid-HTTP reference implementation) [MIT]',
        'braid-text@^0.1.0 (optional: CRDT text merge) [MIT]',
        'Version store (SHA-256 content-addressed DAG)',
        'HTTP middleware framework (Express/Hono) for header injection',
        'Yjs@^13.0.0 (collaborative doc merge, already in architecture) [MIT]',
        'JSON Merge Patch (RFC 7396) implementation',
      ],
      stubNote: 'Braid-HTTP middleware is not installed. Version tracking, subscription-based sync, and merge semantics require the braid-http package and a version store. Solid Pod resources will use standard HTTP without Version/Subscribe headers. Falls back to polling for cache invalidation. See F-014 blueprint.',
    });
  }

  async provisionIdentity(profile) {
    // Braid is a sync/transport protocol, not an identity protocol.
    // No identity provisioning in the Omni-Account pipeline.
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Braid is a sync/transport protocol and does not provision a protocol-specific identity. Instead, it enhances HTTP access to existing Solid Pod resources with version tracking, subscriptions, and merge semantics. No WebID predicate is added for Braid.',
        identityModel: 'none (uses existing Solid Pod HTTP identity)',
        pipelineStep: 'N/A (not part of Omni-Account identity pipeline)',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Braid-HTTP middleware is not installed or configured',
      details: {
        requires: this.requires,
        deploymentModes: {
          vps: 'Full (long-lived HTTP subscriptions via Traefik, full version history)',
          platform: 'Full (long-lived subscriptions, platform DB for version DAG)',
          edge: 'Degraded (SSE fallback via Durable Objects, LWW merge only, limited history in KV)',
          byop: 'Depends on external Pod Braid support; falls back to polling if unsupported',
        },
        syncHierarchy: [
          '1. Braid subscription (real-time, HTTP-native, preferred)',
          '2. Solid Notifications (real-time, Pod-native, fallback)',
          '3. ActivityPub Update activities (event-driven, cross-server, fallback)',
          '4. Conditional HTTP polling (periodic, last resort)',
        ],
        mergeTypes: {
          'profile/card': 'Last-Writer-Wins (LWW) per field',
          'profile/extended': 'Last-Writer-Wins (LWW) per field',
          'social/following': 'Add-Wins Set (CRDT)',
          'posts/{id}': 'Yjs CRDT (if collaborative) or LWW (if single-author)',
          'settings': 'Last-Writer-Wins (LWW) per key',
        },
        versionScheme: 'SHA-256 content hash (deterministic, collision-resistant)',
        patchFormat: 'JSON Merge Patch (RFC 7396) for JSON-LD; SPARQL Update for Turtle (optional)',
        subscriptionConfig: {
          heartbeatInterval: '30 seconds',
          maxSubscriptionsPerClient: 100,
          subscriptionTimeout: '24 hours',
          reconnectStrategy: 'Client sends last known Version header; server sends catch-up patches',
        },
      },
    };
  }
}

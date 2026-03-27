// =============================================================================
// Bonfire Networks Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Bonfire integration per F-025 blueprint.
// Bonfire is a modular ActivityPub toolkit (Elixir/Phoenix). Social
// federates with Bonfire instances via standard ActivityPub (F-003), so basic
// interop is already covered by the activitypub-adapter. This adapter tracks
// the deeper integration: MLS-over-AP encrypted messaging, shared extension
// metadata, and Bonfire-specific AP extension handling.
//
// Blueprint: .dev/blueprints/features/F-025-bonfire-integration.md
//
// What is needed for full implementation:
//   1. MLS (Message Layer Security, RFC 9420) Library — OpenMLS (Rust/WASM)
//      or a TypeScript MLS implementation for end-to-end encrypted group
//      messaging over ActivityPub.
//   2. MLS KeyPackage Endpoint — Each AP Actor exposes an MLS KeyPackage
//      so other MLS-capable servers can initiate encrypted groups.
//   3. Bonfire Extension Handling — Graceful handling of Bonfire-specific
//      AP extensions: Circles (audience targeting), Boundaries (permissions),
//      custom feed types.
//   4. Shared Extension Metadata Format — JSON-LD vocabulary for describing
//      extension capabilities, shared activity type registry.
//   5. Bonfire Test Instance — bonfire.cafe or self-hosted for interop testing.
//
// Integration phases:
//   Phase A (monitor): Track SWF/Bonfire MLS-over-AP spec development.
//   Phase B (compatibility): MLS KeyPackage endpoint, join Bonfire-initiated groups.
//   Phase C (full): Create and manage MLS groups with cross-server participants.
//
// Note: Bonfire runs Elixir/Phoenix — Social does NOT embed Bonfire.
// Federation is via standard ActivityPub. All Bonfire-specific code is behind
// feature flags.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class BonfireAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'bonfire',
      version: '0.0.1',
      status: 'stub',
      description: 'Bonfire Networks integration for MLS-over-ActivityPub encrypted messaging and shared extension ecosystem. Basic AP federation with Bonfire instances is handled by the activitypub adapter. This adapter covers deeper integration: MLS encrypted groups, Bonfire extension handling (Circles, Boundaries), and shared extension metadata.',
      requires: [
        'MLS library (OpenMLS via WASM, or TypeScript MLS implementation)',
        'MLS-over-AP specification (SWF, emerging standard)',
        'MLS KeyPackage endpoint on AP Actors',
        'Bonfire test instance for interop validation',
        'JSON-LD extension metadata format',
        'Feature flags for Bonfire-specific code',
      ],
      stubNote: 'Bonfire deeper integration (MLS-over-AP, extension ecosystem) is not yet implemented. Basic ActivityPub federation with Bonfire instances works via the standard activitypub adapter. See F-025 blueprint.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'Bonfire identity is the ActivityPub Actor. No separate identity provisioning needed. MLS KeyPackage endpoint would be added to the existing AP Actor document.',
        apDependency: 'activitypub adapter provides the base identity',
        mlsKeyPackage: null,
        phases: {
          A: 'Monitor SWF/Bonfire MLS-over-AP spec',
          B: 'MLS KeyPackage endpoint, join Bonfire-initiated groups',
          C: 'Create and manage MLS groups with cross-server participants',
        },
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Bonfire deeper integration (MLS-over-AP) not yet implemented. Basic AP federation works via activitypub adapter.',
      details: {
        requires: this.requires,
        basicFederation: 'Handled by activitypub adapter (Follow, Post, Like, Boost)',
        mlsStatus: 'Phase A (monitoring SWF specification development)',
        bonfireExtensions: {
          circles: 'Not yet handled (audience targeting)',
          boundaries: 'Not yet handled (permission metadata)',
          customFeeds: 'Not yet handled (feed algorithm exchange)',
        },
        stfAlignment: 'Documented in blueprint. Social aligns with Sovereign Tech Fund goals.',
      },
    };
  }
}

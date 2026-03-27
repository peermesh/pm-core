// =============================================================================
// Farcaster Protocol Adapter (Stub) — Lightweight Bridge, Opt-In Only
// =============================================================================
// Stub adapter for Farcaster protocol integration per F-018 blueprint.
// Returns status: 'stub' and documents what the Hub SDK needs for FID
// registration, cast cross-posting, minimal social graph bridge, and the
// clean deactivation/removal path.
//
// *** PROTOCOL STATUS WARNING ***
// As of 2026-03-20, the Farcaster protocol's long-term viability is UNCERTAIN.
// This adapter is designed as a THIN, LOW-INVESTMENT bridge that can be
// activated or deactivated without affecting the rest of the Omni-Account
// system. Do NOT begin implementation without first verifying current
// protocol status. All code paths are behind feature flags.
//
// Blueprint: .dev/blueprints/features/F-018-farcaster-integration.md
//
// What is needed for full implementation:
//   1. Farcaster Hub SDK — For interacting with Farcaster Hubs (submit casts,
//      read feeds, manage signers). Hubs store social data (casts, reactions,
//      links) off-chain with on-chain anchoring for identity.
//      npm: @farcaster/hub-nodejs@^0.12.0 | License: MIT
//      OR direct HTTP/gRPC calls to Hub API.
//   2. Optimism Network Access — FIDs (Farcaster IDs) are registered on
//      Optimism (L2). Requires wallet for on-chain FID registration and
//      signer key management.
//      Reuses wallet infrastructure from F-017 Lens integration.
//      Testnet: Optimism Sepolia for development.
//   3. Signer Key — Registered on the Farcaster Key Registry (on-chain).
//      Authorizes Social to submit casts on behalf of the user.
//      Ed25519 keypair. Key revocable by user at any time.
//   4. Hub Connection — WebSocket or HTTP connection to a Farcaster Hub
//      for submitting casts and reading feeds. Can use public hub
//      (hub.farcaster.xyz) or self-hosted.
//      Environment: FARCASTER_HUB_URL
//
// Design philosophy (F-018 mandate):
//   - LIGHTWEIGHT bridge, NOT a deep protocol investment.
//   - User-initiated opt-in ONLY (never auto-provisioned during Omni-Account).
//   - Minimal social graph bridge (no automatic cross-protocol follows).
//   - All code paths behind feature flags (adapter-level + user-level).
//   - Clean deactivation and full removal path with zero side effects.
//   - Easily removable: no other module depends on Farcaster-specific interfaces.
//
// FID provisioning (USER-INITIATED):
//   - User opts in via Social settings ("Connect to Farcaster").
//   - FID registered on Optimism (reuses embedded wallet from F-017).
//   - Signer key registered on Farcaster Key Registry.
//   - OR: link existing FID via signer key ownership verification.
//
// Cross-posting:
//   - Social posts optionally cross-posted as Farcaster casts.
//   - 320 character limit; long posts truncated with link back to Social.
//   - Cast types: text casts, casts with embeds (images, links).
//   - Frames are NOT supported (too much investment for uncertain protocol).
//   - Incoming: poll Hub API for casts from followed FIDs (default every 5 min).
//
// Social graph bridge (MINIMAL by design):
//   - Farcaster follows are NOT automatically bridged to Social.
//   - Displayed in dedicated Farcaster section of profile only.
//   - Manual cross-follow available via UI.
//   - Rationale: reduces dependency on Farcaster infrastructure.
//
// Channel awareness (read-only):
//   - Browse Farcaster channels (topic-based communities).
//   - Cross-post to selected channel.
//   - Channel content NOT ingested into timeline (volume concern).
//
// Deactivation path:
//   - User-level: revoke signer key, remove WebID predicates, stop cross-posting.
//   - System-level: operator disables adapter via config flag.
//   - Full removal: delete adapter module, no other modules affected.
//
// Deployment modes:
//   Mode 1 (VPS): Full — Hub connection, FID registration, cross-posting.
//   Mode 2 (Platform): Full — Platform-managed Hub connection.
//   Mode 3 (Edge): Limited — Deferred FID, Hub API calls proxied.
//   Mode 4 (BYOP): Link existing FID only.
//
// Key constraints (F-018):
//   - NEVER auto-provision FIDs during Omni-Account creation.
//   - NEVER implement Farcaster Frames (out of scope).
//   - NEVER ingest full channel feeds into timeline.
//   - NEVER create dependencies from other modules on Farcaster interfaces.
//   - NEVER invest significant dev time without verifying protocol health.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class FarcasterAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'farcaster',
      version: '0.0.1',
      status: 'stub',
      description: 'Farcaster protocol lightweight bridge (opt-in only). Provides user-initiated FID registration on Optimism, cast cross-posting (320 char limit), minimal social graph display, and channel-aware posting. Designed as a thin adapter with clean deactivation path. All code paths behind feature flags. WARNING: Protocol status uncertain as of 2026-03-20 — verify viability before implementation.',
      requires: [
        '@farcaster/hub-nodejs@^0.12.0 (Hub SDK for cast submission and feed reading) [MIT]',
        'Optimism network access (FID registration on L2, Sepolia testnet for dev)',
        'Wallet infrastructure from F-017 Lens integration (reuse embedded wallet)',
        'Ed25519 signer keypair (registered on Farcaster Key Registry)',
        'Farcaster Hub connection (hub.farcaster.xyz or self-hosted)',
        'Feature flag system (adapter-level and user-level toggle)',
        'Environment: FARCASTER_HUB_URL, FARCASTER_ENABLED=true/false',
      ],
      stubNote: 'Farcaster Hub SDK is not installed and FID registration is not available. This is a LIGHTWEIGHT bridge — opt-in only, behind feature flags, protocol status uncertain. FID provisioning, cast cross-posting, and social graph display require Hub SDK and Optimism network access. See F-018 blueprint. VERIFY PROTOCOL STATUS BEFORE IMPLEMENTATION.',
    });

    // Additional metadata for feature flag enforcement
    this._featureFlags = {
      adapterLevel: 'FARCASTER_ENABLED (environment variable, default: false)',
      userLevel: 'User opts in via settings; per-post cross-post toggle',
      systemDeactivation: 'Operator can disable entirely via config flag',
    };

    this._protocolStatusWarning = 'As of 2026-03-20, Farcaster protocol long-term viability is uncertain. This adapter is designed for easy activation/deactivation/removal. Do NOT invest significant resources without verifying current protocol health.';
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'FID (Farcaster ID) would be provisioned here — USER-INITIATED ONLY (not auto-provisioned). Flow: (1) User opts in via settings, (2) FID registered on Optimism via embedded wallet, (3) Ed25519 signer key registered on Key Registry, (4) WebID updated. Alternatively, user links existing FID via signer key challenge.',
        protocolStatusWarning: this._protocolStatusWarning,
        webidPredicates: ['pmsl:farcasterFid', 'pmsl:farcasterUsername'],
        pipelineStep: 'NOT in automatic LOGIC-001 pipeline — user-initiated only',
        nonBlocking: true,
        optInOnly: true,
        pipelineStates: ['FARCASTER_PROVISIONED', 'DEACTIVATED'],
        featureFlags: this._featureFlags,
        fidRegistration: {
          chain: 'Optimism (L2)',
          wallet: 'Reuses embedded wallet from F-017 Lens integration',
          signerKey: 'Ed25519 keypair registered on Farcaster Key Registry',
          revocation: 'Signer key revocable by user at any time via on-chain tx',
        },
        identityBridge: {
          webidToFarcaster: 'Read pmsl:farcasterFid from WebID card or DATA-002 local index',
          farcasterToWebid: 'Farcaster profile bio contains WebID URL (convention, not enforced)',
        },
        crossPosting: {
          charLimit: 320,
          longPostHandling: 'Truncated with link back to full Social post',
          castTypes: ['Text casts', 'Casts with embeds (images, links)'],
          framesSupport: 'NOT supported (out of scope per F-018)',
          toggle: 'Per-post opt-in or global setting',
        },
        socialGraphBridge: {
          design: 'MINIMAL — no automatic cross-protocol follows',
          farcasterFollows: 'Displayed in dedicated Farcaster section only',
          manualCrossFollow: 'Available via UI',
        },
        channelAwareness: {
          mode: 'Read-only channel listing + cross-post to selected channel',
          ingestion: 'Channel content NOT ingested into timeline',
          cacheTtl: '1 hour for channel metadata',
        },
        deactivationPath: {
          userLevel: 'Revoke signer key, remove WebID predicates, stop cross-posting, archive timeline entries',
          systemLevel: 'Disable adapter via FARCASTER_ENABLED=false',
          fullRemoval: 'Delete adapter module — no other modules affected, all fields nullable/optional',
        },
        boundaryEnforcement: 'OPT-IN ONLY. Behind feature flags. No Frames. No channel feed ingestion. No auto-follows. No deep protocol investment.',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Farcaster Hub SDK is not configured (FARCASTER_ENABLED is not set or false)',
      details: {
        requires: this.requires,
        protocolStatusWarning: this._protocolStatusWarning,
        farcasterEnabled: process.env.FARCASTER_ENABLED === 'true',
        hubUrl: process.env.FARCASTER_HUB_URL || null,
        featureFlags: this._featureFlags,
        deploymentModes: {
          vps: 'Full (Hub connection, FID registration, cross-posting)',
          platform: 'Full (platform-managed Hub connection)',
          edge: 'Limited (deferred FID, Hub API calls proxied)',
          byop: 'Link existing FID only',
        },
        scope: 'LIGHTWEIGHT bridge: FID provisioning (opt-in), cast cross-posting, minimal social graph, channel awareness. All behind feature flags.',
        riskAssessment: {
          protocolSunset: 'Medium-High likelihood — adapter is thin, easy to remove',
          hubInstability: 'Medium — polling (not streaming), graceful degradation',
          fidCostIncrease: 'Low — deferred/optional provisioning',
          centralization: 'Medium — monitor ecosystem diversity',
        },
        snapchainNote: 'Farcaster transitioned to Snapchain consensus. Hub architecture may evolve. Monitor for breaking changes.',
      },
    };
  }
}

// =============================================================================
// DeSo Protocol Adapter (Stub — DEFERRED)
// =============================================================================
// Stub adapter for DeSo (Decentralized Social) integration per F-024 blueprint.
// Status: DEFERRED — this is a long-term integration target, NOT an immediate
// implementation priority. This adapter exists to reserve the adapter slot in
// the Omni-Account pipeline and document the integration surface.
//
// Implementation will be scheduled only after core protocols (Solid, ActivityPub,
// AT Protocol) are stable and operational.
//
// Blueprint: .dev/blueprints/features/F-024-deso-integration.md
//
// What is needed for full implementation:
//   1. DeSo SDK / DeSo API — For blockchain interaction with the DeSo layer-1
//      chain. DeSo has built-in social transaction types (SubmitPost, CreateLike,
//      CreateFollow, UpdateProfile) and native creator economy features.
//      npm: deso-protocol@^2.0.0 | License: MIT
//      OR direct REST API calls to a DeSo node (node.deso.org).
//   2. DeSo Identity Service — Hosted identity/login service (identity.deso.org)
//      that handles key management and transaction signing. Social integrates
//      as a third-party app requesting identity verification.
//      NO private key custody by Social.
//   3. secp256k1 Key Verification — DeSo identity is a secp256k1 public key
//      (same curve as Bitcoin). Ownership verified via signed challenge message.
//   4. Derived Key (optional) — User-generated derived key with limited permissions
//      for background cross-posting without per-transaction approval popups.
//      Requires security review before implementation.
//   5. DESO Token Balance — DeSo transactions require DESO coin for fees.
//      Social does NOT subsidize fees; user must have sufficient balance.
//
// Identity bridge scope (F-024 mandate):
//   - This is an IDENTITY BRIDGE, not a full DeSo app.
//   - Users link existing DeSo public key to Omni-Account WebID.
//   - NO auto-provisioning during Omni-Account creation (opt-in only).
//   - Cross-posting is per-post opt-in (not global).
//   - Social graph is read-only (no write-back from AP/AT follows).
//   - Creator economy features are display-only (no trading interface).
//
// DeSo social transaction mapping:
//   | Social     | DeSo Transaction  |
//   |----------------|-------------------|
//   | Post (text)    | SubmitPost (Body) |
//   | Like           | CreateLike        |
//   | Follow         | CreateFollow      |
//   | Profile update | UpdateProfile     |
//
// Creator economy (READ-ONLY display):
//   - Creator coin price and holder count (displayed on profile)
//   - Diamond (tip) count (social proof metric)
//   - NFT gallery link (external, redirects to DeSo-native app)
//   - NO trading, diamond sending, or NFT minting in Social.
//
// Deployment modes:
//   Mode 1 (VPS): Full identity bridge (when implemented).
//   Mode 2 (Platform): Full identity bridge (when implemented).
//   Mode 3 (Edge): Limited — display-only DeSo identity badge.
//   Mode 4 (BYOP): Link existing DeSo key only.
//
// Key constraints (F-024):
//   - NEVER auto-generate DeSo keys during Omni-Account creation.
//   - NEVER custody DeSo private keys (use DeSo Identity service or derived keys).
//   - NEVER implement creator coin trading, diamond sending, or NFT minting.
//   - NEVER use DeSo as canonical data store (Solid Pod is canonical).
//   - NEVER subsidize DeSo transaction fees.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class DesoAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'deso',
      version: '0.0.1',
      status: 'stub',
      description: 'DeSo (Decentralized Social) identity bridge — DEFERRED, long-term support target. Links DeSo public key (secp256k1) to Omni-Account WebID, enables opt-in cross-posting to DeSo blockchain, displays social graph and creator economy metadata (read-only). Identity bridge scope only — Social is not a DeSo app. Implementation deferred until core protocols are stable.',
      requires: [
        'deso-protocol@^2.0.0 or direct DeSo node API (node.deso.org) [MIT]',
        'DeSo Identity service (identity.deso.org) for key verification and tx signing',
        'secp256k1 signature verification (challenge-response for key linking)',
        'DESO token balance (user-funded, Social does NOT subsidize fees)',
        'Optional: Derived key infrastructure (security review required)',
        'Environment: DESO_NODE_URL, DESO_IDENTITY_URL',
      ],
      stubNote: 'DeSo integration is DEFERRED — long-term support target, not an immediate implementation priority. DeSo identity linking, cross-posting, and social graph reading require the DeSo SDK and DeSo Identity service. Implementation will begin after core protocols (Solid, ActivityPub, AT Protocol) are stable. See F-024 blueprint.',
    });

    this._deferralNote = 'Status: DEFERRED. This adapter reserves the slot in the protocol registry and documents the integration surface. Implementation timeline depends on core protocol stability and team capacity.';
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        deferred: true,
        note: 'DeSo public key would be linked here — OPT-IN ONLY (not auto-provisioned). Flow: (1) User provides DeSo public key or logs in via DeSo Identity, (2) ownership verified via secp256k1 signed challenge, (3) pmsl:desoPublicKey added to WebID card, (4) local index updated. No automatic key generation.',
        deferralNote: this._deferralNote,
        webidPredicates: ['pmsl:desoPublicKey', 'pmsl:desoUsername'],
        pipelineStep: 'NOT in automatic LOGIC-001 pipeline — opt-in identity linking only',
        nonBlocking: true,
        optInOnly: true,
        pipelineStates: ['DESO_LINKED', 'UNLINKED'],
        identityModel: {
          keyType: 'secp256k1 (same curve as Bitcoin)',
          verification: 'DeSo Identity service (identity.deso.org) — signed challenge message',
          noCustody: 'Social NEVER holds DeSo private keys',
          derivedKey: 'Optional: limited-permission derived key for background cross-posting (requires security review)',
        },
        identityBridge: {
          webidToDeso: 'Read pmsl:desoPublicKey from WebID card or DATA-002 local index',
          desoToWebid: 'DeSo profile description may contain WebID URL (convention)',
        },
        crossPosting: {
          model: 'Per-post opt-in (not global setting)',
          flow: 'Pod (canonical) -> signed DeSo transaction -> DeSo blockchain',
          signing: 'DeSo Identity iframe/popup (user approves) or derived key (background)',
          fees: 'User pays DESO transaction fees — Social does NOT subsidize',
          transactionTypes: {
            post: 'SubmitPost (Body field)',
            like: 'CreateLike',
            follow: 'CreateFollow',
            profileUpdate: 'UpdateProfile',
          },
        },
        socialGraph: {
          mode: 'READ-ONLY display alongside other protocol graphs',
          sync: 'On-demand query via DeSo API, cached with 1-hour TTL',
          writeBack: 'NO write-back — each protocol graph is independent unless user explicitly cross-follows',
        },
        creatorEconomy: {
          mode: 'DISPLAY-ONLY (read via DeSo API, cached with TTL)',
          features: {
            creatorCoin: 'Coin price and holder count on profile',
            diamonds: 'Total diamond (tip) count as social proof',
            nftGallery: 'Link to external DeSo NFT gallery',
          },
          prohibited: 'NO trading, NO diamond sending, NO NFT minting — redirects to DeSo-native apps',
        },
        boundaryEnforcement: 'DEFERRED implementation. Identity bridge ONLY. OPT-IN only. NO key custody. NO fee subsidization. NO creator economy trading. Solid Pod is canonical.',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'DeSo integration is DEFERRED — not yet implemented (long-term support target)',
      details: {
        requires: this.requires,
        deferralNote: this._deferralNote,
        desoNodeUrl: process.env.DESO_NODE_URL || null,
        desoIdentityUrl: process.env.DESO_IDENTITY_URL || 'https://identity.deso.org',
        deploymentModes: {
          vps: 'Full identity bridge (when implemented)',
          platform: 'Full identity bridge (when implemented)',
          edge: 'Limited — display-only DeSo identity badge',
          byop: 'Link existing DeSo key only',
        },
        scope: 'IDENTITY BRIDGE ONLY — key linking, opt-in cross-posting, read-only social graph and creator economy display. NOT a full DeSo app.',
        implementationTimeline: 'Deferred until core protocols (Solid, ActivityPub, AT Protocol) are stable and operational.',
        desoBlockchain: {
          type: 'Layer-1 blockchain designed for social applications',
          builtInTransactions: ['SubmitPost', 'CreateLike', 'CreateFollow', 'UpdateProfile', 'CreatorCoin', 'NFT'],
          identity: 'secp256k1 public key (Bitcoin-compatible curve)',
          feeModel: 'DESO coin required for transaction fees',
        },
        securityModel: {
          noCustody: 'Social NEVER holds DeSo private keys',
          signing: 'DeSo Identity service handles all signing (iframe/popup approval)',
          derivedKey: 'Optional limited-permission key for background ops (security review required before impl)',
        },
      },
    };
  }
}

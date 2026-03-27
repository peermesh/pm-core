// =============================================================================
// DSNP Protocol Adapter (Stub) — Frequency Blockchain Integration
// =============================================================================
// Stub adapter for DSNP (Decentralized Social Networking Protocol) integration
// per F-011 blueprint. Returns status: 'stub' and documents what the Frequency
// blockchain SDK needs for MSA (Message Source Account) provisioning, delegation,
// content announcements, and social graph portability.
//
// Blueprint: .dev/blueprints/features/F-011-dsnp-integration.md
//
// What is needed for full implementation:
//   1. Frequency SDK / Polkadot.js API — For blockchain interaction with the
//      Frequency parachain. Submits extrinsics (createMsa, grantDelegation,
//      publishBatch), queries state, and monitors finalization.
//      npm: @frequency-chain/api-augment | @polkadot/api
//      License: Apache-2.0
//   2. DSNP SDK — For constructing DSNP-compliant announcements (Broadcast,
//      Reply, Reaction, Tombstone, Profile) in Activity Content format.
//      npm: @dsnp/sdk (or manual construction per DSNP spec)
//      Spec: https://spec.dsnp.org/
//   3. Provider MSA Registration — Social must register as a DSNP Provider
//      on the Frequency blockchain (one-time setup per deployment). Requires:
//      - Provider MSA ID (Message Source Account)
//      - Capacity staking (Frequency requires providers to stake FRQCY tokens)
//      - Allowed schemas (profile, post, reaction, graph change)
//   4. Provider Signing Key — For signing extrinsics on behalf of delegating
//      users. Stored in: Solid Pod (self-sovereign), KMS (managed), or Workers
//      secrets (Edge). sr25519 keypair.
//   5. IPFS or Frequency Storage — For hosting announcement batch files.
//      Announcements are batched for efficiency and published as batch file URLs.
//
// Architecture:
//   - DSNP stores ONLY pointers (announcements) on-chain. Social hosts
//     the actual content in Solid Pods. This is a natural fit: Social is
//     the content authority, DSNP is the announcement fabric.
//   - Social operates as a DSNP Provider: users delegate to Social
//     during account creation. Delegation is revocable at any time.
//   - Content flow: Post written to Pod -> public URL generated -> DSNP
//     Announcement created -> submitted to Frequency via batch or extrinsic.
//
// Delegation model:
//   - During Omni-Account creation, user grants delegation to Social Provider.
//   - Delegation scope: publish announcements, update profile, manage graph.
//   - Delegation is revocable by the user via on-chain transaction.
//   - Social NEVER holds user private keys — only provider signing authority.
//
// Announcement types:
//   - Broadcast (public posts): content URL + hash
//   - Reply (threaded): content URL + hash + inReplyTo DSNP content URI
//   - Reaction (likes/emoji): target DSNP content URI + emoji code point
//   - Profile (updates): profile data URL + hash
//   - Tombstone (deletions): target DSNP content URI
//   - GraphChange (follow/unfollow): graph update payload
//
// Social graph portability:
//   - DSNP graph stored on-chain (public follows) or in encrypted bundles
//     (private follows). Synced bidirectionally with ActivityPub followers
//     and Solid Pod contact graphs.
//   - Cross-protocol identity mapping: DSNP User ID <-> WebID <-> AP Actor URI
//     via the WebID profile document as canonical cross-reference hub.
//
// Deployment modes:
//   Mode 1 (VPS): Full — Direct Frequency RPC, self-managed Provider MSA + stake.
//   Mode 2 (Platform): Full — Platform-operated Provider, transparent delegation.
//   Mode 3 (Edge): Degraded — No direct blockchain interaction (RPC too heavy for
//     Edge Workers). Proxies DSNP operations to backend gateway service.
//   Mode 4 (BYOP): Proxy — Social provisions DSNP identity on behalf of BYOP
//     user (similar to Proxy Actor pattern). Delegation to Social Provider.
//
// Capacity management:
//   - Frequency requires providers to stake tokens for transaction capacity.
//   - Monitor staked capacity vs. usage; alert below configurable threshold.
//   - VPS mode: operator manages own Provider stake.
//   - Platform mode: capacity handled transparently by platform operator.
//
// Key constraints (F-011):
//   - NEVER store user content on Frequency (pointers only; content in Pods).
//   - NEVER create DSNP identities without linking back to canonical WebID.
//   - NEVER hard-code to mainnet; testnet must be configurable.
//   - NEVER operate as Provider without user delegation consent.
//   - DSNP is ADDITIVE — not a replacement for ActivityPub or any other protocol.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class DsnpAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'dsnp',
      version: '0.0.1',
      status: 'stub',
      description: 'DSNP (Decentralized Social Networking Protocol) integration via the Frequency blockchain. Provisions DSNP User ID (MSA) as part of Omni-Account, operates as a DSNP Provider with user delegation, publishes content announcements (Broadcast, Reply, Reaction, Tombstone, Profile) pointing to Pod-hosted content, and syncs social graph bidirectionally with ActivityPub and Solid. Content is NEVER stored on-chain — DSNP announces pointers only.',
      requires: [
        '@frequency-chain/api-augment (Frequency parachain type definitions) [Apache-2.0]',
        '@polkadot/api (Substrate/Polkadot blockchain interaction) [Apache-2.0]',
        '@dsnp/sdk or manual DSNP spec implementation (announcement construction) [Apache-2.0]',
        'Provider MSA registration on Frequency (one-time setup per deployment)',
        'FRQCY token stake for provider capacity (Frequency economic model)',
        'sr25519 provider signing keypair (stored in Pod / KMS / Workers secrets)',
        'IPFS node or Frequency storage for announcement batch files',
        'Environment: FREQUENCY_RPC_URL, FREQUENCY_PROVIDER_MSA_ID, FREQUENCY_PROVIDER_SEED',
      ],
      stubNote: 'Frequency blockchain SDK is not installed and Provider MSA is not registered. DSNP User ID provisioning, content announcements, delegation management, and social graph sync require a running Frequency node connection and registered Provider. See F-011 blueprint. DSNP stores pointers only — content lives in Solid Pods.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'DSNP User ID (MSA — Message Source Account) would be provisioned here via Frequency blockchain. Steps: (1) createMsa() on Frequency, (2) grantDelegation() to Social Provider, (3) publish initial Profile announcement. User ID stored in WebID as pmsl:dsnpUserId. Delegation is revocable.',
        webidPredicates: ['pmsl:dsnpUserId', 'pmsl:dsnpProvider'],
        pipelineStep: 'New step in LOGIC-001 (parallel with other protocol provisioning)',
        nonBlocking: true,
        pipelineStates: ['DSNP_PROVISIONED', 'PENDING_RETRY'],
        providerModel: {
          description: 'Social operates as a registered DSNP Provider on Frequency',
          delegation: 'User grants delegation during account creation; revocable at any time',
          scope: ['publish announcements', 'update profile', 'manage graph'],
          capacityStaking: 'Provider must stake FRQCY tokens for transaction capacity',
        },
        identityBridge: {
          webidToDsnp: 'Read pmsl:dsnpUserId from WebID card or DATA-002 local index',
          dsnpToWebid: 'Fetch DSNP Profile announcement URL field -> resolve to WebID',
          apActorToDsnp: 'Cross-reference via WebID hub (AP Actor URI <-> WebID <-> DSNP User ID)',
        },
        announcementTypes: {
          broadcast: 'Public posts — content URL + hash',
          reply: 'Threaded replies — content URL + hash + inReplyTo',
          reaction: 'Likes/emoji — target URI + emoji code point',
          profile: 'Profile updates — profile data URL + hash',
          tombstone: 'Deletions — target DSNP content URI',
          graphChange: 'Follow/unfollow — graph update payload',
        },
        contentModel: 'Content stored in Solid Pod (canonical). DSNP announces pointers to Pod-hosted URLs. Activity Content format (constrained ActivityStreams subset).',
        socialGraph: {
          publicFollows: 'Stored on-chain, visible to anyone',
          privateFollows: 'Encrypted graph bundles, visible to user and delegated provider',
          crossProtocolSync: 'Follow in Social -> update Pod + AP Follow + DSNP graph change',
        },
        boundaryEnforcement: 'NO content storage on Frequency (pointers only). NO key custody (delegation model only). DSNP is ADDITIVE — does not replace other protocols.',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'Frequency blockchain SDK is not configured and Provider MSA is not registered',
      details: {
        requires: this.requires,
        frequencyRpcUrl: process.env.FREQUENCY_RPC_URL || null,
        providerMsaId: process.env.FREQUENCY_PROVIDER_MSA_ID || null,
        providerSeedSet: !!process.env.FREQUENCY_PROVIDER_SEED,
        deploymentModes: {
          vps: 'Full (direct Frequency RPC, self-managed Provider MSA + capacity stake)',
          platform: 'Full (platform-operated Provider, transparent delegation)',
          edge: 'Degraded (no direct blockchain; proxies to backend DSNP gateway)',
          byop: 'Proxy (Social provisions DSNP identity on behalf of BYOP user)',
        },
        scope: 'Omni-Account DSNP identity provisioning, content announcement publishing, social graph sync, cross-protocol identity mapping.',
        frequencyChain: {
          type: 'Polkadot parachain (Substrate-based)',
          consensus: 'Nominated Proof of Stake (via Polkadot relay chain)',
          capacityModel: 'Providers stake FRQCY tokens for transaction throughput',
          transactionRetry: 'Exponential backoff, max 3 retries per extrinsic',
        },
        dsnpSpec: 'https://spec.dsnp.org/',
        ecosystem: ['Project Liberty', 'MeWe', 'Frank'],
      },
    };
  }
}

// =============================================================================
// XMTP Protocol Adapter (Stub) — Identity Bridge Only
// =============================================================================
// Stub adapter for XMTP identity bridge per F-016 blueprint.
// Returns status: 'stub' and documents what the XMTP SDK needs for identity
// registration, wallet integration, and WebID-to-XMTP-address bridging.
//
// *** CRITICAL BOUNDARY ***
// Social does NOT implement chat or messaging. This adapter handles ONLY:
//   - XMTP identity registration (Ethereum address on XMTP network)
//   - Wallet connection (EIP-1193, WalletConnect v2) for identity purposes
//   - Managed keypair generation (for users without external wallets)
//   - Identity bridging (WebID <-> Ethereum address / ENS name)
// Actual messaging is handled by XMTP clients (Converse, Coinbase Wallet, etc.)
// or a separate chat module. CEO-MANDATORY-VISION Section 4.
//
// Blueprint: .dev/blueprints/features/F-016-xmtp-messaging-surface.md
//
// What is needed for full implementation:
//   1. @xmtp/xmtp-js — Official XMTP JavaScript SDK. Used for identity
//      registration ONLY (not messaging). Creates and signs the XMTP identity
//      key bundle on the XMTP network.
//      npm: @xmtp/xmtp-js@^12.0.0 | License: MIT
//      Usage: Client.create(signer) for registration, Client.canMessage(addr) for verification.
//   2. ethers.js or viem — Ethereum library for:
//      - Managed keypair generation (secp256k1)
//      - Ethereum address derivation from public key
//      - ENS name resolution
//      npm: ethers@^6.0.0 [MIT] or viem@^2.0.0 [MIT]
//   3. Wallet connection libraries:
//      - EIP-1193 provider (window.ethereum for MetaMask, Coinbase Wallet extension)
//      - WalletConnect v2 for mobile/hardware wallets
//      npm: @walletconnect/ethereum-provider@^2.0.0 [Apache-2.0]
//      npm: @coinbase/wallet-sdk@^4.0.0 [Apache-2.0] (optional, direct Coinbase integration)
//   4. ENS resolver — For resolving Ethereum addresses to ENS names and setting
//      text records (name, avatar, description, url).
//      Built into ethers.js/viem or via ENS subgraph API.
//
// Version requirements:
//   - @xmtp/xmtp-js >= 12.0.0 (identity registration, canMessage check) [MIT]
//   - ethers >= 6.0.0 [MIT] or viem >= 2.0.0 [MIT]
//   - @walletconnect/ethereum-provider >= 2.0.0 [Apache-2.0]
//   - Node.js >= 18.0.0 (native crypto, ESM)
//   - Client-side execution required (wallet signing is browser-only)
//
// Deployment modes:
//   Mode 1 (VPS): Full — Client-side SDK, wallet signing, ENS resolution server-side or client.
//   Mode 2 (Platform): Full — Client-side SDK, platform provides managed key option.
//   Mode 3 (Edge): Client-side SDK only (no server-side XMTP SDK).
//   Mode 4 (BYOP): Link existing XMTP-registered address or register via client-side SDK.
//
// Key constraints (F-016):
//   - NO messaging, chat, or conversation management in Social.
//   - NO XMTP message sending, receiving, rendering, or storage.
//   - NO financial transactions, smart contract interaction, token transfers.
//   - External wallet private keys NEVER stored or processed server-side.
//   - Managed keypairs are CLIENT-SIDE ONLY (SubtleCrypto / IndexedDB).
//   - XMTP SDK used for registration ONLY, not messaging.
//   - Profile sync is ONE-DIRECTIONAL: Social -> external discovery mechanisms.
//   - DID PKH (did:pkh:eip155:1:{address}) stored alongside raw Ethereum address.

import { StubProtocolAdapter } from '../protocol-adapter.js';

export class XmtpAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'xmtp',
      version: '0.0.1',
      status: 'stub',
      description: 'XMTP protocol identity bridge (NOT chat). Registers Ethereum address on the XMTP network as part of Omni-Account, connects wallets (EIP-1193 / WalletConnect v2) for identity, resolves ENS names, and bridges WebID <-> Ethereum address for cross-protocol discovery. Bridges web standards (Solid/AP) with web3 (Ethereum/XMTP). Chat/messaging is handled by external XMTP clients or a separate module.',
      requires: [
        '@xmtp/xmtp-js@^12.0.0 (identity registration only, NOT messaging) [MIT]',
        'ethers@^6.0.0 or viem@^2.0.0 (secp256k1 keypair, address derivation, ENS) [MIT]',
        '@walletconnect/ethereum-provider@^2.0.0 (mobile/hardware wallet connection) [Apache-2.0]',
        'EIP-1193 provider (browser-injected: MetaMask, Coinbase Wallet extension)',
        'Optional: @coinbase/wallet-sdk@^4.0.0 (direct Coinbase integration) [Apache-2.0]',
        'Client-side execution environment (wallet signing is browser-only)',
        'Optional: Ethereum RPC endpoint for ENS resolution',
      ],
      stubNote: 'XMTP SDK is not installed. Ethereum address derivation, XMTP network registration, wallet connection, and ENS resolution require the XMTP JS SDK and an Ethereum library. Identity registration requires client-side wallet signing. See F-016 blueprint. Note: This adapter is IDENTITY BRIDGE ONLY — no chat/messaging functionality.',
    });
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: {
        stub: true,
        note: 'XMTP identity would be registered here. If user has external wallet: use wallet Ethereum address. If not: generate managed secp256k1 keypair (client-side only). Address stored in WebID as pmsl:xmtpAddress. XMTP identity key bundle signed and published to XMTP network. Failure does NOT block other protocol provisioning.',
        webidPredicates: ['pmsl:xmtpAddress', 'pmsl:xmtpWalletType', 'pmsl:ensName', 'pmsl:xmtpDID'],
        keyType: 'secp256k1 (Ethereum-compatible)',
        pipelineStep: 'New step in LOGIC-001 (parallel with other protocol provisioning)',
        nonBlocking: true,
        pipelineStates: ['XMTP_PROVISIONED', 'PENDING_RETRY', 'DEFERRED'],
        walletTypes: {
          external: 'User connects existing wallet (MetaMask, Coinbase Wallet, WalletConnect). Private key NEVER touches Social.',
          managed: 'Social generates secp256k1 keypair CLIENT-SIDE ONLY. Stored in SubtleCrypto / IndexedDB. Server never has access.',
        },
        identityBridge: {
          webidToXmtp: 'Read pmsl:xmtpAddress from WebID card or DATA-002 local index',
          xmtpToWebid: '.well-known/xmtp-profiles endpoint on Social domain',
          ensReverse: 'ENS reverse resolution -> url text record -> WebID',
        },
        didInterop: {
          didPkh: 'did:pkh:eip155:1:{address} (stored as pmsl:xmtpDID)',
          usage: 'Verifiable Credentials interoperability alongside WebID and AT Protocol DID',
        },
        profileSync: {
          direction: 'Social -> external discovery (one-directional)',
          mechanisms: [
            'ENS text records (name, avatar, description, url) — requires on-chain tx, opt-in',
            'WebID as profile URL (authoritative source)',
            'XMTP custom content type for profile (provided by chat module, not Social)',
          ],
        },
        boundaryEnforcement: 'NO chat, NO messaging, NO conversation management, NO financial transactions, NO smart contracts',
      },
    };
  }

  async healthCheck() {
    return {
      available: false,
      error: 'XMTP SDK is not installed and no wallet connection is configured',
      details: {
        requires: this.requires,
        deploymentModes: {
          vps: 'Full (client-side SDK, wallet signing, ENS resolution server-side or client)',
          platform: 'Full (client-side SDK, platform provides managed key option)',
          edge: 'Client-side SDK only (no server-side XMTP SDK available)',
          byop: 'Link existing XMTP-registered address or register via client-side SDK',
        },
        scope: 'IDENTITY BRIDGE ONLY — registration, wallet connection, ENS, identity resolution. NO chat/messaging.',
        walletConnectionProtocols: [
          'EIP-1193 (browser-injected provider: MetaMask, Coinbase Wallet extension)',
          'WalletConnect v2 (QR code / deep link for mobile and hardware wallets)',
          'Coinbase Wallet SDK (direct integration, optional)',
        ],
        securityModel: {
          externalWallet: 'Private key NEVER touches Social. Only eth_accounts and personal_sign/eth_signTypedData_v4 requested.',
          managedKey: 'Generated and stored CLIENT-SIDE ONLY (SubtleCrypto / IndexedDB with encryption at rest). Server never has access.',
          noFinancialOps: 'No eth_sendTransaction, no contract interaction, no token transfers.',
        },
        web3Bridge: {
          description: 'WebID card serves as universal identity hub linking web standards (Solid, AP, AT Protocol) with web3 (Ethereum, XMTP, ENS)',
          example: '<#me> pmsl:xmtpAddress "0x..." ; pmsl:ensName "alice.eth" ; pmsl:xmtpDID "did:pkh:eip155:1:0x..."',
        },
        webComponents: [
          '<pms-wallet-connect> (wallet connection flow: EIP-1193, WalletConnect)',
          '<pms-wallet-badge> (display connected address / ENS name)',
          '<pms-xmtp-id-badge> (display XMTP address with copy + contact link)',
          '<pms-identity-hub> (full cross-protocol identity map on profile)',
        ],
      },
    };
  }
}

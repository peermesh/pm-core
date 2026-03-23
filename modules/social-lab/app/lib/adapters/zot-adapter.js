// =============================================================================
// Zot Protocol Adapter (Stub)
// =============================================================================
// Stub adapter for Zot protocol integration per F-012 blueprint.
// The existing routes/zot.js provides basic channel info and xchan documents
// (deterministic stub hashes). This adapter documents what the full Hubzilla
// API needs for nomadic identity, Magic Auth, and clone sync.
//
// Blueprint: .dev/blueprints/features/F-012-zot-protocol-integration.md
//
// What is needed for full implementation:
//   1. Zot Protocol Stack — Full Zot6 implementation:
//      - Channel provisioning with RSA keypair (min 2048-bit)
//      - .well-known/zot-info discovery endpoint
//      - Nomadic identity (multi-server clone sync)
//      - Magic Auth (OpenWebAuth cross-server SSO)
//      - Signed JSON payload delivery for content sync
//   2. Hubzilla/Streams Interop — Federation with existing Zot network:
//      - Channel cloning (inbound and outbound)
//      - Permission system mapping (Zot permissions <-> Solid WAC)
//      - Content sync between clones
//   3. RSA Keypair — Channel identity. Minimum 2048-bit for signing/encryption.
//
// Current state: routes/zot.js provides stub channel info documents with
// deterministic channel hashes. Real RSA keys, Magic Auth, and clone sync
// are not yet implemented.
//
// Deployment modes:
//   Mode 1 (VPS): Full Zot stack — channel creation, cloning, Magic Auth, sync.
//   Mode 2 (Platform): Platform-hosted Zot infrastructure.
//   Mode 3 (Edge): Degraded — Zot identity displayed, operations proxied to gateway.
//   Mode 4 (BYOP): Proxy channel on Social Lab, linked to external WebID.

import { StubProtocolAdapter } from '../protocol-adapter.js';
import { pool } from '../../db.js';
import { lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../helpers.js';

export class ZotAdapter extends StubProtocolAdapter {
  constructor() {
    super({
      name: 'zot',
      version: '0.1.0',
      status: 'stub',
      description: 'Zot6 protocol (Hubzilla/Streams) with nomadic identity. Stub channel info documents are available via /api/zot/channel/:handle. Full Zot stack (RSA keys, Magic Auth, clone sync, nomadic identity) requires dedicated Zot protocol implementation.',
      requires: [
        'Zot6 protocol stack implementation',
        'RSA keypair generation (min 2048-bit) for channel identity',
        '.well-known/zot-info discovery endpoint',
        'Magic Auth / OpenWebAuth for cross-server SSO',
        'Clone sync engine (signed JSON payloads)',
        'Hubzilla/Streams test instance for interop validation',
      ],
      stubNote: 'Zot protocol stack is not fully implemented. Stub channel documents are available at /api/zot/channel/:handle and /api/zot/xchan/:handle, but nomadic identity, Magic Auth, and clone sync require the full Zot6 implementation. See F-012 blueprint.',
    });
  }

  async provisionIdentity(profile) {
    const handle = profile.username;
    const ourDomain = INSTANCE_DOMAIN;
    const channelAddress = `${handle}@${ourDomain}`;

    return {
      protocol: this.name,
      identifier: channelAddress,
      metadata: {
        stub: true,
        channelAddress,
        channelHash: profile.zot_channel_hash || null,
        channelInfoEndpoint: `${BASE_URL}/api/zot/channel/${handle}`,
        xchanEndpoint: `${BASE_URL}/api/zot/xchan/${handle}`,
        webidPredicate: 'pmsl:zotChannel',
        keyType: 'rsa2048',
        note: 'Stub channel with deterministic hash. Full provisioning requires RSA keypair and Zot discovery endpoint.',
      },
    };
  }

  async healthCheck() {
    const start = Date.now();
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM social_profiles.profile_index WHERE zot_channel_hash IS NOT NULL`
      );
      return {
        available: false,
        latency: Date.now() - start,
        error: 'Zot protocol stack not fully implemented (stub channel documents only)',
        details: {
          stubChannels: result.rows[0]?.cnt || 0,
          requires: this.requires,
          existingEndpoints: [
            '/api/zot/channel/:handle (stub)',
            '/api/zot/xchan/:handle (stub)',
          ],
          deploymentModes: {
            vps: 'Full Zot stack (channel, cloning, Magic Auth, sync)',
            platform: 'Platform-hosted Zot infrastructure',
            edge: 'Degraded (identity display, operations proxied)',
            byop: 'Proxy channel linked to external WebID',
          },
          nomadicIdentityNote: 'Zot nomadic identity pattern (multi-server clone sync with seamless migration) is architecturally significant and informs Social Lab portability design.',
        },
      };
    } catch (err) {
      return {
        available: false,
        latency: Date.now() - start,
        error: err.message,
      };
    }
  }
}

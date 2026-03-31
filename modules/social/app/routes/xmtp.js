// =============================================================================
// XMTP Protocol Identity Bridge Routes
// =============================================================================
// GET /api/xmtp/identity/:handle — XMTP address mapping (identity bridge)
//
// CRITICAL: These are IDENTITY BRIDGES ONLY -- NOT chat implementations.
// Per CEO-MANDATORY-VISION Section 4: chat is NOT part of Social.
// XMTP messaging is handled by XMTP clients (Converse, Coinbase Wallet, etc.)
// or a separate chat module -- never by Social.
//
// Source blueprint: F-016 (XMTP Protocol Surface)

import { pool } from '../db.js';
import { json, jsonStubSurface, lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // GET /api/xmtp/identity/:handle — XMTP address mapping (identity bridge)
  // Returns the XMTP-capable Ethereum address for a given handle,
  // enabling WebID-to-XMTP-address resolution.
  routes.push({
    method: 'GET',
    pattern: /^\/api\/xmtp\/identity\/([a-zA-Z0-9_.-]+)$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);

      if (!profile) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No profile found for handle: ${handle}`,
        });
      }

      if (!profile.xmtp_address) {
        return jsonStubSurface(res, 200, {
          handle,
          xmtp_address: null,
          bridge_status: 'not_provisioned',
          note: 'XMTP identity not yet provisioned. Connect a wallet or generate a managed keypair to enable XMTP.',
        });
      }

      jsonStubSurface(res, 200, {
        handle,
        xmtp_address: profile.xmtp_address,
        bridge_status: 'provisioned',
        note: 'Identity bridge only. Chat is handled by external XMTP clients.',
      });
    },
  });
}

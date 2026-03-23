// =============================================================================
// Protocol Registry
// =============================================================================
// Central registry for all protocol adapters. Replaces the ad-hoc protocol
// handling scattered across route files with a single lookup mechanism.
//
// Usage:
//   import { registry } from './protocol-registry.js';
//   const ap = registry.getAdapter('activitypub');
//   const all = registry.listAdapters();
//   const active = registry.getActiveAdapters();

/**
 * Protocol Registry — singleton that holds all registered protocol adapters.
 */
class ProtocolRegistry {
  constructor() {
    /** @type {Map<string, import('./protocol-adapter.js').ProtocolAdapter>} */
    this._adapters = new Map();
  }

  /**
   * Register a protocol adapter.
   * @param {import('./protocol-adapter.js').ProtocolAdapter} adapter
   * @throws {Error} if an adapter with the same name is already registered
   */
  register(adapter) {
    if (!adapter || !adapter.name) {
      throw new Error('Cannot register adapter: missing name');
    }
    const key = adapter.name.toLowerCase();
    if (this._adapters.has(key)) {
      throw new Error(`Protocol adapter '${key}' is already registered`);
    }
    this._adapters.set(key, adapter);
  }

  /**
   * Get a specific adapter by protocol name.
   * @param {string} protocolName — Case-insensitive protocol name
   * @returns {import('./protocol-adapter.js').ProtocolAdapter|null}
   */
  getAdapter(protocolName) {
    return this._adapters.get(protocolName.toLowerCase()) || null;
  }

  /**
   * List all registered adapters with summary info.
   * @returns {Array<{name: string, status: string, version: string, description: string}>}
   */
  listAdapters() {
    const result = [];
    for (const adapter of this._adapters.values()) {
      result.push(adapter.toJSON());
    }
    return result;
  }

  /**
   * Get all adapters whose status is 'active'.
   * @returns {import('./protocol-adapter.js').ProtocolAdapter[]}
   */
  getActiveAdapters() {
    const result = [];
    for (const adapter of this._adapters.values()) {
      if (adapter.status === 'active') {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Get all adapters whose status is 'stub'.
   * @returns {import('./protocol-adapter.js').ProtocolAdapter[]}
   */
  getStubAdapters() {
    const result = [];
    for (const adapter of this._adapters.values()) {
      if (adapter.status === 'stub') {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Get the count of adapters by status.
   * @returns {{active: number, partial: number, stub: number, unavailable: number, total: number}}
   */
  getStatusCounts() {
    const counts = { active: 0, partial: 0, stub: 0, unavailable: 0, total: 0 };
    for (const adapter of this._adapters.values()) {
      counts.total++;
      if (counts[adapter.status] !== undefined) {
        counts[adapter.status]++;
      }
    }
    return counts;
  }

  /**
   * Run health checks on all registered adapters.
   * @returns {Promise<Object<string, import('./protocol-adapter.js').HealthCheckResult>>}
   */
  async healthCheckAll() {
    const results = {};
    const entries = [...this._adapters.entries()];
    const checks = entries.map(async ([name, adapter]) => {
      try {
        results[name] = await adapter.healthCheck();
      } catch (err) {
        results[name] = { available: false, error: err.message };
      }
    });
    await Promise.all(checks);
    return results;
  }
}

// Singleton instance
export const registry = new ProtocolRegistry();

// =============================================================================
// Auto-registration of all adapters
// =============================================================================
// Import and register every adapter. This runs once when the module is loaded.

import { ActivityPubAdapter } from './adapters/activitypub-adapter.js';
import { NostrAdapter } from './adapters/nostr-adapter.js';
import { RssAdapter } from './adapters/rss-adapter.js';
import { IndieWebAdapter } from './adapters/indieweb-adapter.js';
import { AtProtocolAdapter } from './adapters/atprotocol-adapter.js';
import { HolochainAdapter } from './adapters/holochain-adapter.js';
import { SsbAdapter } from './adapters/ssb-adapter.js';
import { ZotAdapter } from './adapters/zot-adapter.js';
import { BonfireAdapter } from './adapters/bonfire-adapter.js';
import { HypercoreAdapter } from './adapters/hypercore-adapter.js';
import { BraidAdapter } from './adapters/braid-adapter.js';
import { WillowAdapter } from './adapters/willow-adapter.js';
import { MatrixAdapter } from './adapters/matrix-adapter.js';
import { XmtpAdapter } from './adapters/xmtp-adapter.js';
import { OcapnAdapter } from './adapters/ocapn-adapter.js';
import { KeyhiveAdapter } from './adapters/keyhive-adapter.js';
import { VcAdapter } from './adapters/vc-adapter.js';
import { DsnpAdapter } from './adapters/dsnp-adapter.js';
import { LensAdapter } from './adapters/lens-adapter.js';
import { FarcasterAdapter } from './adapters/farcaster-adapter.js';
import { DesoAdapter } from './adapters/deso-adapter.js';

registry.register(new ActivityPubAdapter());
registry.register(new NostrAdapter());
registry.register(new RssAdapter());
registry.register(new IndieWebAdapter());
registry.register(new AtProtocolAdapter());
registry.register(new HolochainAdapter());
registry.register(new SsbAdapter());
registry.register(new ZotAdapter());
registry.register(new BonfireAdapter());
registry.register(new HypercoreAdapter());
registry.register(new BraidAdapter());
registry.register(new WillowAdapter());
registry.register(new MatrixAdapter());
registry.register(new XmtpAdapter());
registry.register(new OcapnAdapter());
registry.register(new KeyhiveAdapter());
registry.register(new VcAdapter());
registry.register(new DsnpAdapter());
registry.register(new LensAdapter());
registry.register(new FarcasterAdapter());
registry.register(new DesoAdapter());

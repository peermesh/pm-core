// adapter registry with primary/active lifecycle selection

import { assertAdapterContract } from './adapter-contract.js';

export class AdapterRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._adapters = new Map();
    /** @type {string|null} */
    this._primary = null;
  }

  register(adapter) {
    assertAdapterContract(adapter);
    const key = adapter.backendId.toLowerCase();
    if (this._adapters.has(key)) {
      throw new Error(`Adapter '${key}' is already registered`);
    }
    this._adapters.set(key, adapter);
    if (!this._primary) {
      this._primary = key;
    }
  }

  unregister(backendId) {
    const key = String(backendId || '').toLowerCase();
    const removed = this._adapters.delete(key);
    if (!removed) return;
    if (this._primary === key) {
      this._primary = this._adapters.size > 0 ? this._adapters.keys().next().value : null;
    }
  }

  get(backendId) {
    return this._adapters.get(String(backendId || '').toLowerCase()) || null;
  }

  list() {
    return [...this._adapters.values()];
  }

  async getActive() {
    const active = [];
    for (const adapter of this._adapters.values()) {
      try {
        const health = await adapter.healthCheck();
        if (health?.available) {
          active.push(adapter);
        }
      } catch {
        // do nothing; unhealthy adapters are omitted
      }
    }
    return active;
  }

  getPrimary() {
    if (!this._primary) {
      throw new Error('No primary adapter configured');
    }
    const adapter = this._adapters.get(this._primary);
    if (!adapter) {
      throw new Error(`Primary adapter '${this._primary}' is not registered`);
    }
    return adapter;
  }

  setPrimary(backendId) {
    const key = String(backendId || '').toLowerCase();
    if (!this._adapters.has(key)) {
      throw new Error(`Cannot set primary: adapter '${key}' is not registered`);
    }
    this._primary = key;
  }
}

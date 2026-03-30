// data-layer adapter: in-memory sql-like store (postgres-shaped rows)

import { randomUUID } from 'node:crypto';

import { defineAdapterCapabilities } from '../data-layer/adapter-contract.js';

import { PROFILE_INTERCHANGE } from './solid-data-layer-adapter.js';

export class SqlDataLayerAdapter {
  constructor() {
    this.backendId = 'postgresql';
    /** @type {Map<string, { resource: object, data: object }>} */
    this._store = new Map();
    this.capabilities = defineAdapterCapabilities({
      addressingModes: ['key'],
      supportsMutableData: true,
      supportsAppendOnly: false,
      supportsTrueDeletion: true,
      supportsDHT: false,
      supportsP2PSync: false,
      supportsACL: false,
      supportsRDF: false,
      supportsOfflineFirst: false,
      maxPayloadSize: null,
      supportsTransactions: true,
      nativeQueryLanguage: 'sql',
    });
  }

  async initialize() {}

  async shutdown() {
    this._store.clear();
  }

  async healthCheck() {
    return { available: true, backendId: this.backendId, mode: 'memory' };
  }

  async create(resource, data) {
    const id = randomUUID();
    const ref = { backendId: this.backendId, id };
    this._store.set(id, { resource: { ...resource }, data: { ...data } });
    return { ref };
  }

  async read(ref) {
    const row = this._store.get(ref.id);
    if (!row) return null;
    return { ref, resource: row.resource, data: { ...row.data } };
  }

  async update(ref, data) {
    const row = this._store.get(ref.id);
    if (!row) throw new Error('update: not found');
    row.data = { ...row.data, ...data };
    return { ref };
  }

  async delete(ref) {
    this._store.delete(ref.id);
  }

  async query(q) {
    const want = q?.resourceType;
    const items = [];
    for (const [id, row] of this._store) {
      if (want && row.resource?.type !== want) continue;
      items.push({ ref: { backendId: this.backendId, id }, ...row });
    }
    return { items };
  }

  subscribe() {
    return () => {};
  }

  async *exportData(_opts) {
    for (const [id, row] of this._store) {
      yield {
        interchange: 'pmsl/sql-row/v1',
        ref: { backendId: this.backendId, id },
        resource: row.resource,
        data: row.data,
      };
    }
  }

  async importData(source) {
    let imported = 0;
    for await (const chunk of source) {
      if (chunk?.interchange === PROFILE_INTERCHANGE && chunk.dbFields) {
        const id = chunk.ref?.id || randomUUID();
        this._store.set(id, {
          resource: { type: 'social/profile' },
          data: { ...chunk.dbFields, source_pod_uri: chunk.podUrl },
        });
        imported += 1;
        continue;
      }
      if (chunk?.interchange === 'pmsl/sql-row/v1' && chunk.ref?.id) {
        this._store.set(chunk.ref.id, {
          resource: chunk.resource || {},
          data: chunk.data || {},
        });
        imported += 1;
      }
    }
    return { imported };
  }

  /** @returns {number} */
  countProfiles() {
    let n = 0;
    for (const row of this._store.values()) {
      if (row.resource?.type === 'social/profile') n += 1;
    }
    return n;
  }
}

export function createSqlDataLayerAdapter() {
  return new SqlDataLayerAdapter();
}

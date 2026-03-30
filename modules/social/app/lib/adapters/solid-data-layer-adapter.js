// data-layer adapter: solid pathway (mock pod by default — no live CSS required).
// profile dbFields mirror solid-adapter.js syncProfileFromPod() column mapping for sql interchange.

import { randomUUID } from 'node:crypto';

import { defineAdapterCapabilities } from '../data-layer/adapter-contract.js';

/** interchange version for solid -> sql logical export */
export const PROFILE_INTERCHANGE = 'pmsl/profile/v1';

/**
 * Mock Solid DataLayer adapter. Aligns profile payloads with solid-adapter
 * syncProfileFromPod dbFields naming for export/import checks.
 */
export class SolidDataLayerAdapter {
  /**
   * @param {{ mock?: boolean }} [options] mock defaults true (no network)
   */
  constructor(options = {}) {
    this.backendId = 'solid';
    this._mock = options.mock !== false;
    /** @type {Map<string, { resource: object, data: object }>} */
    this._store = new Map();
    this.capabilities = defineAdapterCapabilities({
      addressingModes: ['path'],
      supportsMutableData: true,
      supportsAppendOnly: false,
      supportsTrueDeletion: true,
      supportsDHT: false,
      supportsP2PSync: false,
      supportsACL: true,
      supportsRDF: true,
      supportsOfflineFirst: true,
      maxPayloadSize: null,
      supportsTransactions: false,
      nativeQueryLanguage: null,
    });
  }

  async initialize() {}

  async shutdown() {
    this._store.clear();
  }

  async healthCheck() {
    return {
      available: true,
      backendId: this.backendId,
      mode: this._mock ? 'mock-pod' : 'live',
    };
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
      if (row.resource?.type === 'social/profile') {
        const d = row.data;
        yield {
          interchange: PROFILE_INTERCHANGE,
          ref: { backendId: this.backendId, id },
          podUrl: d.podUrl || `https://mock.pod.example/${id}/`,
          dbFields: {
            display_name: d.display_name ?? d.displayName ?? null,
            username: d.username ?? null,
            bio: d.bio ?? null,
            avatar_url: d.avatar_url ?? d.avatarUrl ?? null,
            homepage_url: d.homepage_url ?? d.homepageUrl ?? null,
            profile_version: d.profile_version ?? d.profileVersion ?? '0.1.0',
            deployment_mode: d.deployment_mode ?? d.deploymentMode ?? 'vps',
          },
        };
      } else {
        yield {
          interchange: 'pmsl/raw-doc/v1',
          ref: { backendId: this.backendId, id },
          resource: row.resource,
          data: row.data,
        };
      }
    }
  }

  async importData(source) {
    let imported = 0;
    for await (const chunk of source) {
      if (chunk?.interchange === PROFILE_INTERCHANGE && chunk.dbFields) {
        const id = chunk.ref?.id || randomUUID();
        this._store.set(id, {
          resource: { type: 'social/profile' },
          data: {
            podUrl: chunk.podUrl,
            ...chunk.dbFields,
          },
        });
        imported += 1;
        continue;
      }
      if (chunk?.interchange === 'pmsl/raw-doc/v1' && chunk.ref?.id) {
        this._store.set(chunk.ref.id, {
          resource: chunk.resource || {},
          data: chunk.data || {},
        });
        imported += 1;
      }
    }
    return { imported };
  }
}

export function createSolidDataLayerAdapter(opts) {
  return new SolidDataLayerAdapter(opts);
}

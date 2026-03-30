// data-layer adapter: append-only feed slice (ssb-style semantics, in-memory)

import { defineAdapterCapabilities } from '../data-layer/adapter-contract.js';

/**
 * Minimal append-only log: create appends; update appends a new revision chained
 * by logicalKey; read returns latest revision. No true deletion (tombstone optional).
 */
export class P2pAppendFeedAdapter {
  constructor() {
    this.backendId = 'ssb-feed';
    /** seq -> { resource, data, logicalKey, prevSeq } */
    this._entries = new Map();
    this._seq = 0;
    /** logicalKey -> latest seq */
    this._head = new Map();
    this.capabilities = defineAdapterCapabilities({
      addressingModes: ['key'],
      supportsMutableData: false,
      supportsAppendOnly: true,
      supportsTrueDeletion: false,
      supportsDHT: false,
      supportsP2PSync: true,
      supportsACL: false,
      supportsRDF: false,
      supportsOfflineFirst: true,
      maxPayloadSize: null,
      supportsTransactions: false,
      nativeQueryLanguage: null,
    });
  }

  async initialize() {}

  async shutdown() {
    this._entries.clear();
    this._head.clear();
    this._seq = 0;
  }

  async healthCheck() {
    return { available: true, backendId: this.backendId, mode: 'memory-append-only' };
  }

  _nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  async create(resource, data) {
    const seq = this._nextSeq();
    const logicalKey = data.logicalKey || `lk-${seq}`;
    const id = String(seq);
    const ref = { backendId: this.backendId, id, logicalKey, seq };
    this._entries.set(seq, {
      resource: { ...resource },
      data: { ...data, logicalKey },
      logicalKey,
      prevSeq: null,
    });
    this._head.set(logicalKey, seq);
    return { ref };
  }

  async read(ref) {
    const seq = Number(ref.seq ?? ref.id);
    const entry = this._entries.get(seq);
    if (!entry) return null;
    return {
      ref: { backendId: this.backendId, id: String(seq), logicalKey: entry.logicalKey, seq },
      resource: entry.resource,
      data: { ...entry.data },
    };
  }

  async update(ref, data) {
    const logicalKey = ref.logicalKey || data.logicalKey;
    if (!logicalKey) throw new Error('append update requires logicalKey');
    const prevSeq = this._head.get(logicalKey);
    if (!prevSeq) throw new Error('unknown logicalKey');
    const seq = this._nextSeq();
    const id = String(seq);
    const newRef = { backendId: this.backendId, id, logicalKey, seq };
    const prevEntry = this._entries.get(prevSeq);
    this._entries.set(seq, {
      resource: prevEntry ? { ...prevEntry.resource } : { type: 'conformance/doc' },
      data: { ...data, logicalKey },
      logicalKey,
      prevSeq,
    });
    this._head.set(logicalKey, seq);
    return { ref: newRef };
  }

  async delete(_ref) {
    // append-only: no true delete
  }

  async query(q) {
    const want = q?.resourceType;
    const items = [];
    for (const [seq, entry] of this._entries) {
      if (want && entry.resource?.type !== want) continue;
      if (q?.latestOnly && this._head.get(entry.logicalKey) !== seq) continue;
      items.push({
        ref: {
          backendId: this.backendId,
          id: String(seq),
          logicalKey: entry.logicalKey,
          seq,
        },
        resource: entry.resource,
        data: { ...entry.data },
      });
    }
    return { items };
  }

  subscribe() {
    return () => {};
  }

  async *exportData(_opts) {
    const sorted = [...this._entries.keys()].sort((a, b) => a - b);
    for (const seq of sorted) {
      const e = this._entries.get(seq);
      yield {
        interchange: 'pmsl/ssb-feed-chunk/v1',
        seq,
        logicalKey: e.logicalKey,
        resource: e.resource,
        data: e.data,
      };
    }
  }

  async importData(source) {
    let imported = 0;
    for await (const chunk of source) {
      if (chunk?.interchange !== 'pmsl/ssb-feed-chunk/v1') continue;
      const seq = chunk.seq;
      this._entries.set(seq, {
        resource: chunk.resource || {},
        data: chunk.data || {},
        logicalKey: chunk.logicalKey,
        prevSeq: chunk.prevSeq ?? null,
      });
      if (chunk.logicalKey) {
        const cur = this._head.get(chunk.logicalKey) || 0;
        if (seq >= cur) this._head.set(chunk.logicalKey, seq);
      }
      if (seq > this._seq) this._seq = seq;
      imported += 1;
    }
    return { imported };
  }
}

export function createP2pAppendFeedAdapter() {
  return new P2pAppendFeedAdapter();
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_LAYER_REQUIRED_METHODS,
  assertAdapterContract,
  defineAdapterCapabilities,
} from '../lib/data-layer/adapter-contract.js';

function buildAdapter(overrides = {}) {
  const base = {
    backendId: 'dummy',
    capabilities: defineAdapterCapabilities({ supportsMutableData: true }),
    async initialize() {},
    async shutdown() {},
    async healthCheck() { return { available: true }; },
    async create() { return { ref: { backendId: 'dummy', id: '1' } }; },
    async read() { return null; },
    async update() { return { ref: { backendId: 'dummy', id: '1' } }; },
    async delete() {},
    async query() { return { items: [] }; },
    subscribe() { return () => {}; },
    async *exportData() {},
    async importData() { return { imported: 0 }; },
  };
  return { ...base, ...overrides };
}

test('runtime contract accepts complete adapter shape', () => {
  assert.doesNotThrow(() => assertAdapterContract(buildAdapter()));
});

test('runtime contract rejects missing required methods', () => {
  for (const method of DATA_LAYER_REQUIRED_METHODS) {
    const bad = buildAdapter();
    delete bad[method];
    assert.throws(() => assertAdapterContract(bad), new RegExp(method));
  }
});

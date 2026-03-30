import test from 'node:test';
import assert from 'node:assert/strict';

import { AdapterRegistry } from '../lib/data-layer/adapter-registry.js';
import { DataOrchestrator } from '../lib/data-layer/data-orchestrator.js';
import { DataEventBus } from '../lib/data-layer/event-bus.js';
import { defineAdapterCapabilities } from '../lib/data-layer/adapter-contract.js';

function baseAdapter(backendId, hooks = {}) {
  const {
    available = true,
    readFn,
    createFn,
    updateFn,
    deleteFn,
    queryFn,
  } = hooks;

  return {
    backendId,
    capabilities: defineAdapterCapabilities({ supportsMutableData: true }),
    async initialize() {},
    async shutdown() {},
    async healthCheck() {
      return available ? { available: true } : { available: false, error: 'down' };
    },
    async create(resource, data) {
      if (createFn) return createFn(resource, data);
      return { ref: { backendId, id: '1' }, payload: data };
    },
    async read(ref) {
      if (readFn) return readFn(ref);
      return null;
    },
    async update(ref, data) {
      if (updateFn) return updateFn(ref, data);
      return { ref, payload: data };
    },
    async delete(ref) {
      if (deleteFn) return deleteFn(ref);
    },
    async query(q) {
      if (queryFn) return queryFn(q);
      return { items: [], from: backendId };
    },
    subscribe() {
      return () => {};
    },
    async *exportData() {},
    async importData() {
      return { imported: 0 };
    },
  };
}

test('write replicates primary first then secondaries', async () => {
  const order = [];

  const primary = baseAdapter('primary', {
    createFn: async () => {
      order.push('primary');
      return { ref: { backendId: 'primary', id: 'x' } };
    },
  });
  const secondary = baseAdapter('secondary', {
    createFn: async () => {
      order.push('secondary');
      return { ref: { backendId: 'secondary', id: 'x' } };
    },
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.register(secondary);
  reg.setPrimary('primary');

  const orch = new DataOrchestrator({ registry: reg });
  await orch.create({ type: 'post' }, { text: 'hi' });

  assert.deepEqual(order, ['primary', 'secondary']);
});

test('write collects deterministic replicationErrors when secondary fails', async () => {
  const primary = baseAdapter('primary', {
    createFn: async () => ({ ref: { backendId: 'primary', id: '1' } }),
  });
  const bad = baseAdapter('bad', {
    createFn: async () => {
      throw new Error('sync failed');
    },
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.register(bad);
  reg.setPrimary('primary');

  const orch = new DataOrchestrator({ registry: reg });
  const out = await orch.create({ type: 'x' }, { v: 1 });

  assert.equal(out.ref.backendId, 'primary');
  assert.equal(out.replicationErrors.length, 1);
  assert.equal(out.replicationErrors[0].backendId, 'bad');
  assert.equal(out.replicationErrors[0].error, 'sync failed');
});

test('read falls back to healthy secondary when primary unhealthy', async () => {
  const ref = { backendId: 'primary', id: '1' };
  const primary = baseAdapter('primary', {
    available: false,
    readFn: async () => ({ from: 'primary' }),
  });
  const secondary = baseAdapter('secondary', {
    readFn: async () => ({ from: 'secondary', ok: true }),
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.register(secondary);
  reg.setPrimary('primary');

  const orch = new DataOrchestrator({ registry: reg });
  const row = await orch.read(ref);

  assert.deepEqual(row, { from: 'secondary', ok: true });
});

test('read tries primary then secondary when primary returns null', async () => {
  const ref = { backendId: 'primary', id: '1' };
  const primary = baseAdapter('primary', {
    readFn: async () => null,
  });
  const secondary = baseAdapter('secondary', {
    readFn: async () => ({ hit: 'secondary' }),
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.register(secondary);
  reg.setPrimary('primary');

  const orch = new DataOrchestrator({ registry: reg });
  const row = await orch.read(ref);

  assert.deepEqual(row, { hit: 'secondary' });
});

test('mutation publishes event on bus', async () => {
  const events = [];
  const bus = new DataEventBus();
  bus.subscribe((e) => {
    events.push(e);
  });

  const primary = baseAdapter('primary', {
    createFn: async () => ({ ref: { backendId: 'primary', id: 'z' } }),
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  const orch = new DataOrchestrator({ registry: reg, eventBus: bus });

  await orch.create({ type: 't' }, { body: 1 });

  assert.equal(events.length, 1);
  assert.equal(events[0].backendId, 'primary');
  assert.equal(events[0].changeType, 'create');
  assert.equal(events[0].canonicalObject.body, 1);
  assert.ok(typeof events[0].timestamp === 'string');
});

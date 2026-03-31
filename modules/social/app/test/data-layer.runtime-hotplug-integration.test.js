// ARCH-008 wave 10: runtime hot-plug, safe unregister, event-bus fanout (integration)

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

test('hot-plug: register secondary adapter while orchestrator is active', async () => {
  const order = [];

  const primary = baseAdapter('primary', {
    createFn: async () => {
      order.push('p');
      return { ref: { backendId: 'primary', id: '1' } };
    },
  });
  const late = baseAdapter('late', {
    createFn: async () => {
      order.push('l');
      return { ref: { backendId: 'late', id: '1' } };
    },
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.setPrimary('primary');
  const orch = new DataOrchestrator({ registry: reg });

  await orch.create({ type: 'post' }, { n: 1 });
  assert.deepEqual(order, ['p']);

  reg.register(late);
  await orch.create({ type: 'post' }, { n: 2 });

  assert.deepEqual(order, ['p', 'p', 'l']);
});

test('hot-remove: unregister adapter does not break primary or remaining secondaries', async () => {
  const order = [];

  const primary = baseAdapter('primary', {
    createFn: async () => {
      order.push('p');
      return { ref: { backendId: 'primary', id: 'x' } };
    },
  });
  const removable = baseAdapter('gone', {
    createFn: async () => {
      order.push('gone');
      return { ref: { backendId: 'gone', id: 'x' } };
    },
  });
  const keeper = baseAdapter('keeper', {
    createFn: async () => {
      order.push('k');
      return { ref: { backendId: 'keeper', id: 'x' } };
    },
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  reg.register(removable);
  reg.register(keeper);
  reg.setPrimary('primary');
  const orch = new DataOrchestrator({ registry: reg });

  await orch.create({ type: 't' }, { phase: 'before' });
  assert.deepEqual(order, ['p', 'gone', 'k']);

  order.length = 0;
  reg.unregister('gone');

  const out = await orch.create({ type: 't' }, { phase: 'after' });
  assert.equal(out.ref.backendId, 'primary');
  assert.deepEqual(order, ['p', 'k']);
  assert.equal(out.replicationErrors?.length ?? 0, 0);
});

test('event fanout: mutation delivers to all bus subscribers', async () => {
  const received = { a: [], b: [], c: [] };
  const bus = new DataEventBus();
  bus.subscribe((e) => received.a.push(e));
  bus.subscribe((e) => received.b.push(e));
  bus.subscribe((e) => received.c.push(e));

  const primary = baseAdapter('primary', {
    createFn: async () => ({ ref: { backendId: 'primary', id: 'fan' } }),
  });

  const reg = new AdapterRegistry();
  reg.register(primary);
  const orch = new DataOrchestrator({ registry: reg, eventBus: bus });

  await orch.update({ backendId: 'primary', id: 'fan' }, { x: 42 });

  assert.equal(received.a.length, 1);
  assert.equal(received.b.length, 1);
  assert.equal(received.c.length, 1);
  assert.equal(received.a[0].changeType, 'update');
  assert.equal(received.b[0].changeType, 'update');
  assert.equal(received.c[0].changeType, 'update');
  assert.equal(received.a[0].canonicalObject.x, 42);
});

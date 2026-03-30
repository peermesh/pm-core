import test from 'node:test';
import assert from 'node:assert/strict';

import { AdapterRegistry } from '../lib/data-layer/adapter-registry.js';
import { defineAdapterCapabilities } from '../lib/data-layer/adapter-contract.js';

function makeAdapter(backendId, { available = true } = {}) {
  return {
    backendId,
    capabilities: defineAdapterCapabilities({ supportsMutableData: true }),
    async initialize() {},
    async shutdown() {},
    async healthCheck() {
      return available ? { available: true } : { available: false, error: 'unavailable' };
    },
    async create() {
      return { ref: { backendId, id: '1' } };
    },
    async read() {
      return null;
    },
    async update() {
      return { ref: { backendId, id: '1' } };
    },
    async delete() {},
    async query() {
      return { items: [] };
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

test('register get list unregister lifecycle', () => {
  const reg = new AdapterRegistry();
  const a = makeAdapter('alpha');
  const b = makeAdapter('beta');

  reg.register(a);
  reg.register(b);

  assert.equal(reg.get('alpha'), a);
  assert.equal(reg.get('ALPHA'), a);
  assert.deepEqual(new Set(reg.list()), new Set([a, b]));

  reg.unregister('alpha');
  assert.equal(reg.get('alpha'), null);
  assert.equal(reg.list().length, 1);
});

test('register rejects duplicate backendId', () => {
  const reg = new AdapterRegistry();
  reg.register(makeAdapter('same'));
  assert.throws(() => reg.register(makeAdapter('SAME')), /already registered/);
});

test('setPrimary and getPrimary', () => {
  const reg = new AdapterRegistry();
  reg.register(makeAdapter('first'));
  reg.register(makeAdapter('second'));

  assert.equal(reg.getPrimary().backendId, 'first');

  reg.setPrimary('second');
  assert.equal(reg.getPrimary().backendId, 'second');

  assert.throws(() => reg.setPrimary('missing'), /not registered/);
});

test('getPrimary throws when registry empty', () => {
  const reg = new AdapterRegistry();
  assert.throws(() => reg.getPrimary(), /No primary adapter/);
});

test('unregister reassigns primary when primary removed', () => {
  const reg = new AdapterRegistry();
  reg.register(makeAdapter('p'));
  reg.register(makeAdapter('q'));
  reg.setPrimary('p');
  reg.unregister('p');
  assert.equal(reg.getPrimary().backendId, 'q');
  assert.equal(reg.get('p'), null);
});

test('getActive returns only healthy adapters', async () => {
  const reg = new AdapterRegistry();
  reg.register(makeAdapter('up', { available: true }));
  reg.register(makeAdapter('down', { available: false }));

  const active = await reg.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].backendId, 'up');
});

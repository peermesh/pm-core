import test from 'node:test';
import assert from 'node:assert/strict';

import { registry } from '../lib/protocol-registry.js';

test('Protocol registry has unique adapter names', () => {
  const adapters = registry.listAdapters();
  const names = adapters.map((adapter) => adapter.name);
  const unique = new Set(names);

  assert.equal(adapters.length > 0, true);
  assert.equal(unique.size, names.length);
});

test('Protocol registry includes required baseline adapters', () => {
  const adapters = registry.listAdapters();
  const names = new Set(adapters.map((adapter) => adapter.name));

  const required = ['activitypub', 'nostr', 'atprotocol', 'holochain', 'ssb', 'hypercore', 'willow'];
  for (const name of required) {
    assert.equal(names.has(name), true, `missing required adapter: ${name}`);
  }
});

test('Protocol registry status counts are internally consistent', () => {
  const counts = registry.getStatusCounts();
  const computedTotal = counts.active + counts.partial + counts.stub + counts.unavailable;

  assert.equal(counts.total, computedTotal);
  assert.equal(counts.total, registry.listAdapters().length);
});

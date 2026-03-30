import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { runAdapterConformance } from '../lib/data-layer/conformance-harness.js';
import { createSolidDataLayerAdapter } from '../lib/adapters/solid-data-layer-adapter.js';
import { createSqlDataLayerAdapter } from '../lib/adapters/sql-data-layer-adapter.js';
import { createP2pAppendFeedAdapter } from '../lib/adapters/p2p-append-feed-adapter.js';

test('WO-171 harness: solid data-layer (mock pod)', async (t) => {
  await runAdapterConformance(t, createSolidDataLayerAdapter({ mock: true }));
});

test('WO-171 harness: sql data-layer (memory)', async (t) => {
  await runAdapterConformance(t, createSqlDataLayerAdapter());
});

test('WO-171 harness: p2p append-only feed', async (t) => {
  await runAdapterConformance(t, createP2pAppendFeedAdapter());
});

test('WO-171 solid PROFILE interchange -> sql (counts + username fingerprint)', async () => {
  const solid = createSolidDataLayerAdapter({ mock: true });
  const sql = createSqlDataLayerAdapter();
  await solid.initialize();
  const profiles = [
    { podUrl: 'https://mock.pod.example/u/alice/', display_name: 'Alice', username: 'alice', bio: 'a' },
    { podUrl: 'https://mock.pod.example/u/bob/', display_name: 'Bob', username: 'bob', bio: 'b' },
    { podUrl: 'https://mock.pod.example/u/carol/', display_name: 'Carol', username: 'carol', bio: 'c' },
  ];
  for (const p of profiles) {
    await solid.create({ type: 'social/profile' }, p);
  }

  async function* solidChunks() {
    for await (const chunk of solid.exportData({})) {
      yield chunk;
    }
  }

  const imp = await sql.importData(solidChunks());
  assert.equal(imp.imported, 3);
  assert.equal(sql.countProfiles(), 3);

  const q = await sql.query({ resourceType: 'social/profile' });
  const usernames = q.items.map((i) => i.data?.username).filter(Boolean).sort();
  const fp = createHash('sha256').update(JSON.stringify(usernames)).digest('hex');
  const expected = createHash('sha256').update(JSON.stringify(['alice', 'bob', 'carol'])).digest('hex');
  assert.equal(fp, expected);

  await solid.shutdown();
  await sql.shutdown();
});

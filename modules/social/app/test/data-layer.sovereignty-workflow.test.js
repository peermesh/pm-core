import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runDataSovereigntyWorkflow,
  runSolidToSqlMigrationProbe,
  probeDeleteBehavior,
} from '../lib/data-layer/sovereignty-workflow.js';
import { createSolidDataLayerAdapter } from '../lib/adapters/solid-data-layer-adapter.js';
import { createSqlDataLayerAdapter } from '../lib/adapters/sql-data-layer-adapter.js';
import { createP2pAppendFeedAdapter } from '../lib/adapters/p2p-append-feed-adapter.js';

test('sovereignty: solid->sql migration probe passes', async () => {
  const m = await runSolidToSqlMigrationProbe();
  assert.equal(m.pass, true, JSON.stringify(m));
  assert.equal(m.targetImported, 3);
  assert.equal(m.checksumMatch, true);
});

test('sovereignty: solid and sql declare true delete and remove rows', async () => {
  const s = await probeDeleteBehavior(createSolidDataLayerAdapter({ mock: true }));
  assert.equal(s.declaresTrueDeletion, true);
  assert.equal(s.classification, 'true_delete');
  assert.equal(s.readableAfterDelete, false);
  assert.equal(s.pass, true);

  const q = await probeDeleteBehavior(createSqlDataLayerAdapter());
  assert.equal(q.declaresTrueDeletion, true);
  assert.equal(q.pass, true);
});

test('sovereignty: p2p append-only is tombstone_or_noop (data still readable)', async () => {
  const p = await probeDeleteBehavior(createP2pAppendFeedAdapter());
  assert.equal(p.declaresTrueDeletion, false);
  assert.equal(p.classification, 'tombstone_or_noop');
  assert.equal(p.readableAfterDelete, true);
  assert.equal(p.pass, true);
});

test('sovereignty: full workflow report passes', async () => {
  const r = await runDataSovereigntyWorkflow();
  assert.equal(r.overallPass, true, JSON.stringify(r, null, 2));
  assert.ok(r.migration.usernameChecksumSha256);
  assert.equal(r.deleteBehavior.length, 3);
});

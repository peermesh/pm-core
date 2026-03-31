// arch-008 wave 9: export/migrate/delete baseline for data sovereignty reporting
// reuses solid/sql/p2p adapter factories; no live network

import { createHash } from 'node:crypto';

import { createSolidDataLayerAdapter } from '../adapters/solid-data-layer-adapter.js';
import { createSqlDataLayerAdapter } from '../adapters/sql-data-layer-adapter.js';
import { createP2pAppendFeedAdapter } from '../adapters/p2p-append-feed-adapter.js';

const HARNESS_VERSION = 'arch008-wave9-sovereignty-v1';

/**
 * @typedef {object} MigrationReport
 * @property {string} pathway
 * @property {number} sourceExportedProfileCount
 * @property {number} targetImported
 * @property {number} targetProfileCount
 * @property {string} usernameChecksumSha256
 * @property {boolean} checksumMatch
 * @property {boolean} pass
 */

/**
 * @typedef {object} DeleteBehaviorRow
 * @property {string} backendId
 * @property {boolean} declaresTrueDeletion
 * @property {boolean} readableAfterDelete
 * @property {'true_delete'|'tombstone_or_noop'} classification
 * @property {boolean} pass
 * @property {string|null} detail
 */

/**
 * @typedef {object} SovereigntyReport
 * @property {string} harnessVersion
 * @property {string} timestamp
 * @property {MigrationReport} migration
 * @property {DeleteBehaviorRow[]} deleteBehavior
 * @property {boolean} overallPass
 */

/**
 * solid -> sql profile export/import with deterministic username checksum.
 * @returns {Promise<MigrationReport>}
 */
export async function runSolidToSqlMigrationProbe() {
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

  let exported = 0;
  async function* solidChunks() {
    for await (const chunk of solid.exportData({})) {
      exported += 1;
      yield chunk;
    }
  }

  const imp = await sql.importData(solidChunks());
  const q = await sql.query({ resourceType: 'social/profile' });
  const usernames = q.items.map((i) => i.data?.username).filter(Boolean).sort();
  const fp = createHash('sha256').update(JSON.stringify(usernames)).digest('hex');
  const expected = createHash('sha256').update(JSON.stringify(['alice', 'bob', 'carol'])).digest('hex');

  const profileChunks = exported;
  const targetImported = imp.imported;
  const targetProfileCount = sql.countProfiles();

  await solid.shutdown();
  await sql.shutdown();

  const checksumMatch = fp === expected;
  const pass = targetImported === 3 && targetProfileCount === 3 && checksumMatch;

  return {
    pathway: 'solid->sql',
    sourceExportedProfileCount: profileChunks,
    targetImported,
    targetProfileCount,
    usernameChecksumSha256: fp,
    checksumMatch,
    pass,
  };
}

/**
 * After delete(ref), classify observable behavior vs capability declaration.
 * @param {{ backendId: string, capabilities: object, initialize: Function, shutdown: Function, create: Function, read: Function, delete: Function }} adapter
 * @returns {Promise<DeleteBehaviorRow>}
 */
export async function probeDeleteBehavior(adapter) {
  await adapter.initialize();
  const resource = { type: 'sovereignty/delete-probe' };
  const payload = { token: `del-${adapter.backendId}-${Date.now()}` };
  const { ref } = await adapter.create(resource, payload);
  const before = await adapter.read(ref);
  if (!before) {
    await adapter.shutdown();
    return {
      backendId: adapter.backendId,
      declaresTrueDeletion: Boolean(adapter.capabilities?.supportsTrueDeletion),
      readableAfterDelete: false,
      classification: 'true_delete',
      pass: false,
      detail: 'read after create returned null',
    };
  }
  await adapter.delete(ref);
  const after = await adapter.read(ref);
  const readableAfterDelete = after != null && after !== undefined;
  const declares = Boolean(adapter.capabilities?.supportsTrueDeletion);
  let classification;
  if (declares) {
    classification = 'true_delete';
  } else {
    classification = 'tombstone_or_noop';
  }
  const expectGone = declares;
  const pass = expectGone ? !readableAfterDelete : readableAfterDelete;
  await adapter.shutdown();
  return {
    backendId: adapter.backendId,
    declaresTrueDeletion: declares,
    readableAfterDelete,
    classification,
    pass,
    detail: null,
  };
}

/**
 * Full sovereignty baseline: migration integrity + per-backend delete semantics.
 * @returns {Promise<SovereigntyReport>}
 */
export async function runDataSovereigntyWorkflow() {
  const migration = await runSolidToSqlMigrationProbe();
  const adapters = [
    createSolidDataLayerAdapter({ mock: true }),
    createSqlDataLayerAdapter(),
    createP2pAppendFeedAdapter(),
  ];
  const deleteBehavior = [];
  for (const a of adapters) {
    deleteBehavior.push(await probeDeleteBehavior(a));
  }
  const overallPass = migration.pass && deleteBehavior.every((d) => d.pass);
  return {
    harnessVersion: HARNESS_VERSION,
    timestamp: new Date().toISOString(),
    migration,
    deleteBehavior,
    overallPass,
  };
}

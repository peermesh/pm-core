// parameterized data-layer conformance helpers (capability-gated)

import { assertAdapterContract } from './adapter-contract.js';

/**
 * @param {import('./adapter-contract.js').AdapterCapabilities} cap
 * @param {'mutableUpdate'|'trueDelete'|'transactions'} feature
 * @returns {string|null} skip reason or null if not skipped
 */
export function conformanceSkipReason(cap, feature) {
  if (!cap) return 'missing capabilities';
  switch (feature) {
    case 'mutableUpdate':
      return cap.supportsMutableData ? null : 'supportsMutableData is false';
    case 'trueDelete':
      return cap.supportsTrueDeletion ? null : 'supportsTrueDeletion is false';
    case 'transactions':
      return cap.supportsTransactions ? null : 'supportsTransactions is false';
    default:
      return null;
  }
}

/**
 * Run capability-aware conformance checks using node:test subtests.
 * @param {import('node:test').TestContext} t
 * @param {object} adapter
 * @returns {Promise<void>}
 */
export async function runAdapterConformance(t, adapter) {
  await t.test('assertAdapterContract', () => {
    assertAdapterContract(adapter);
  });

  await adapter.initialize();
  try {
    await runAdapterConformanceBody(t, adapter);
  } finally {
    await adapter.shutdown();
  }
}

async function runAdapterConformanceBody(t, adapter) {
  await t.test('healthCheck shape', async () => {
    const h = await adapter.healthCheck();
    if (typeof h?.available !== 'boolean') {
      throw new Error('healthCheck must return { available: boolean }');
    }
  });

  let createdRef;
  const resource = { type: 'conformance/doc' };
  const payload = { conformanceToken: `tok-${adapter.backendId}-1` };

  await t.test('create + read roundtrip', async () => {
    const out = await adapter.create(resource, payload);
    if (!out?.ref?.id) throw new Error('create must return { ref: { id, ... } }');
    createdRef = out.ref;
    const row = await adapter.read(createdRef);
    if (!row || row.data?.conformanceToken !== payload.conformanceToken) {
      throw new Error('read after create must return same payload');
    }
  });

  const skipMut = conformanceSkipReason(adapter.capabilities, 'mutableUpdate');
  await t.test(
    'update mutates readable document',
    { ...(skipMut ? { skip: skipMut } : {}) },
    async () => {
      const next = { conformanceToken: `tok-${adapter.backendId}-2` };
      await adapter.update(createdRef, next);
      const row = await adapter.read(createdRef);
      if (row.data?.conformanceToken !== next.conformanceToken) {
        throw new Error('update did not change readable payload');
      }
    }
  );

  const skipDel = conformanceSkipReason(adapter.capabilities, 'trueDelete');
  await t.test(
    'delete removes document',
    { ...(skipDel ? { skip: skipDel } : {}) },
    async () => {
      await adapter.delete(createdRef);
      const row = await adapter.read(createdRef);
      if (row !== null && row !== undefined) {
        throw new Error('read after true delete must be null/undefined');
      }
    }
  );

  await t.test('query returns items array', async () => {
    const q = await adapter.query({ resourceType: resource.type });
    if (!q || !Array.isArray(q.items)) {
      throw new Error('query must return { items: [] }');
    }
  });

  await t.test('subscribe returns unsubscribe', async () => {
    const unsub = adapter.subscribe(() => {});
    if (typeof unsub !== 'function') {
      throw new Error('subscribe must return a function');
    }
    unsub();
  });

  await t.test('exportData is async-iterable', async () => {
    let count = 0;
    for await (const _chunk of adapter.exportData({})) {
      count += 1;
    }
    if (count < 0) throw new Error('export iteration failed');
  });

  await t.test('importData returns summary', async () => {
    const res = await adapter.importData((async function* empty() {})());
    if (!res || typeof res.imported !== 'number') {
      throw new Error('importData must return { imported: number }');
    }
  });
}

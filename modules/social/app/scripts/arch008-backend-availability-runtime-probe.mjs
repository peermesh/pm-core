#!/usr/bin/env node
// arch-008 wave 14: deterministic local probe of baseline data-layer adapters (mock/in-memory only).
// must be executed with cwd = this package root (social/app).

import { createSolidDataLayerAdapter } from '../lib/adapters/solid-data-layer-adapter.js';
import { createSqlDataLayerAdapter } from '../lib/adapters/sql-data-layer-adapter.js';
import { createP2pAppendFeedAdapter } from '../lib/adapters/p2p-append-feed-adapter.js';

const factories = {
  solid: () => createSolidDataLayerAdapter({ mock: true }),
  sql: () => createSqlDataLayerAdapter(),
  p2p: () => createP2pAppendFeedAdapter(),
};

async function probeAdapter(contractKey, factory) {
  const adapter = factory();
  await adapter.initialize();
  try {
    const h = await adapter.healthCheck();
    return {
      contractKey,
      backendId: adapter.backendId,
      healthAvailable: Boolean(h?.available),
      healthCheck: h,
      capabilities: { ...adapter.capabilities },
    };
  } finally {
    await adapter.shutdown();
  }
}

const adapters = {};
for (const [key, factory] of Object.entries(factories)) {
  adapters[key] = await probeAdapter(key, factory);
}

const payload = {
  schema_version: '1',
  probe_kind: 'arch008_backend_availability_runtime',
  adapters,
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecoveryDatabaseState } from '../routes/recovery.js';

test('getRecoveryDatabaseState: all three tables present', async () => {
  const pool = {
    async query() {
      return { rows: [{ n: 3 }] };
    },
  };
  const s = await getRecoveryDatabaseState(pool);
  assert.equal(s.available, true);
  assert.equal(s.tables_ready, true);
});

test('getRecoveryDatabaseState: incomplete migration', async () => {
  const pool = {
    async query() {
      return { rows: [{ n: 1 }] };
    },
  };
  const s = await getRecoveryDatabaseState(pool);
  assert.equal(s.available, false);
  assert.equal(s.not_configured, true);
  assert.equal(s.unavailable, true);
  assert.equal(s.tables_found, 1);
});

test('getRecoveryDatabaseState: connection errors are non-throwing', async () => {
  const pool = {
    async query() {
      const err = new Error('connection refused');
      err.code = 'ECONNREFUSED';
      throw err;
    },
  };
  const s = await getRecoveryDatabaseState(pool);
  assert.equal(s.available, false);
  assert.equal(s.reason, 'database_error');
  assert.equal(s.error_code, 'ECONNREFUSED');
});

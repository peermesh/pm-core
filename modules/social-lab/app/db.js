// =============================================================================
// Social Lab Module - Database Connection
// =============================================================================
// PostgreSQL connection pool using pg.Pool.
// Reads connection params from environment variables.
// Reads password from file-based Docker secret (/run/secrets/social_lab_db_password).

import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

/**
 * Read the database password from a Docker secret file.
 * Falls back to SOCIAL_LAB_DB_PASSWORD env var for local development.
 * @returns {string} The database password
 */
function readPassword() {
  const secretPath = '/run/secrets/social_lab_db_password';
  try {
    return readFileSync(secretPath, 'utf8').trim();
  } catch {
    // Fall back to environment variable (local dev / testing)
    const envPassword = process.env.SOCIAL_LAB_DB_PASSWORD;
    if (envPassword) {
      return envPassword;
    }
    console.warn('[db] WARNING: No secret file at', secretPath, 'and no SOCIAL_LAB_DB_PASSWORD env var set');
    return '';
  }
}

/**
 * Create and configure the PostgreSQL connection pool.
 */
const pool = new Pool({
  host: process.env.SOCIAL_LAB_DB_HOST || 'postgres',
  port: parseInt(process.env.SOCIAL_LAB_DB_PORT || '5432', 10),
  database: process.env.SOCIAL_LAB_DB_NAME || 'social_lab',
  user: process.env.SOCIAL_LAB_DB_USER || 'social_lab',
  password: readPassword(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log pool errors (do not crash on idle connection errors)
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

/**
 * Check database connectivity and measure latency.
 * @returns {{ connected: boolean, latencyMs: number, error?: string }}
 */
async function healthCheck() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

export { pool, healthCheck };

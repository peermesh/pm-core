// =============================================================================
// Health Check Route — GET /health
// =============================================================================

import { healthCheck } from '../db.js';
import { json, VERSION, MODULE, startTime } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  routes.push({
    method: 'GET',
    pattern: '/health',
    handler: async (req, res) => {
      const db = await healthCheck();
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      const status = db.connected ? 'healthy' : 'degraded';

      json(res, db.connected ? 200 : 503, {
        status,
        version: VERSION,
        module: MODULE,
        checks: {
          database: {
            status: db.connected ? 'connected' : 'disconnected',
            latencyMs: db.latencyMs,
            ...(db.error && { error: db.error }),
          },
          uptime: uptimeSeconds,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
}

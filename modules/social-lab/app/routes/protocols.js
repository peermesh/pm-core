// =============================================================================
// Protocol Status API Routes
// =============================================================================
// GET /api/protocols              — List all registered protocols with status
// GET /api/protocols/:name        — Detailed status for one protocol
// GET /api/protocols/:name/health — Health check for one protocol
//
// These endpoints read from the protocol registry (lib/protocol-registry.js)
// instead of hardcoded protocol lists. This provides a single source of truth
// for protocol status that the Studio settings page and other consumers can use.

import { registry } from '../lib/protocol-registry.js';
import { json } from '../lib/helpers.js';

export default function registerRoutes(routes) {
  // GET /api/protocols — List all registered protocols
  routes.push({
    method: 'GET',
    pattern: '/api/protocols',
    handler: async (req, res) => {
      const adapters = registry.listAdapters();
      const counts = registry.getStatusCounts();

      json(res, 200, {
        protocols: adapters,
        summary: counts,
      });
    },
  });

  // GET /api/protocols/:name — Detailed status for one protocol
  routes.push({
    method: 'GET',
    pattern: /^\/api\/protocols\/([a-zA-Z0-9_-]+)$/,
    handler: async (req, res, matches) => {
      const name = matches[1].toLowerCase();
      const adapter = registry.getAdapter(name);

      if (!adapter) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No protocol adapter registered for: ${name}`,
          available: registry.listAdapters().map(a => a.name),
        });
      }

      json(res, 200, adapter.toJSON());
    },
  });

  // GET /api/protocols/:name/health — Health check for one protocol
  routes.push({
    method: 'GET',
    pattern: /^\/api\/protocols\/([a-zA-Z0-9_-]+)\/health$/,
    handler: async (req, res, matches) => {
      const name = matches[1].toLowerCase();
      const adapter = registry.getAdapter(name);

      if (!adapter) {
        return json(res, 404, {
          error: 'Not Found',
          message: `No protocol adapter registered for: ${name}`,
        });
      }

      try {
        const health = await adapter.healthCheck();
        const statusCode = health.available ? 200 : 503;
        json(res, statusCode, {
          protocol: adapter.name,
          version: adapter.version,
          status: adapter.status,
          health,
        });
      } catch (err) {
        json(res, 500, {
          protocol: adapter.name,
          health: {
            available: false,
            error: err.message,
          },
        });
      }
    },
  });
}

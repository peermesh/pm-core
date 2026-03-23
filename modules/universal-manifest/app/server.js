// =============================================================================
// Universal Manifest Module - HTTP Server
// =============================================================================
// Minimal Node.js HTTP server using built-in http module.
// No framework dependencies -- keeps the module lightweight.
//
// Route modules register their handlers via registerRoutes(routes).
// The router matches exact string paths, then regex patterns.

import { createServer } from 'node:http';

// Import route registration functions
import registerManifestRoutes from './routes/manifests.js';
import registerFacetRoutes from './routes/facets.js';
import registerKeyRoutes from './routes/keys.js';
import registerResolverRoutes from './routes/resolver.js';

const PORT = parseInt(process.env.UM_PORT || '4200', 10);
const MODULE = 'universal-manifest';
const VERSION = '0.1.0';


// =============================================================================
// Helpers
// =============================================================================

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}


// =============================================================================
// Route Registration
// =============================================================================
// Each route module pushes { method, pattern, handler } objects into this array.
// pattern can be:
//   - a string for exact match (e.g., '/health')
//   - a RegExp for parameterized paths (e.g., /^\/api\/um\/manifest\/([^/]+)$/)
// handler signature: (req, res, matches?) where matches is the regex match array.

const routes = [];

// Register routes in priority order.
// Manifest API routes first (most specific).
// Facet routes next.
// Key provisioning routes next.
// Resolver routes last (includes wildcard UMID resolution).
registerManifestRoutes(routes);
registerFacetRoutes(routes);
registerKeyRoutes(routes);
registerResolverRoutes(routes);


// =============================================================================
// Router
// =============================================================================

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  for (const r of routes) {
    if (r.method !== method) continue;

    if (typeof r.pattern === 'string') {
      if (pathname === r.pattern) {
        return r.handler(req, res, null);
      }
    } else if (r.pattern instanceof RegExp) {
      const match = pathname.match(r.pattern);
      if (match) {
        return r.handler(req, res, match);
      }
    }
  }

  // 404 -- no matching route
  json(res, 404, {
    error: 'Not Found',
    module: MODULE,
    version: VERSION,
  });
}


// =============================================================================
// Server lifecycle
// =============================================================================

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error('[server] Unhandled error:', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal Server Error' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${MODULE}] Server listening on port ${PORT}`);
  console.log(`[${MODULE}] Module: ${MODULE} v${VERSION}`);
  console.log(`[${MODULE}] Health endpoint: http://0.0.0.0:${PORT}/health`);
  console.log(`[${MODULE}] API base: http://0.0.0.0:${PORT}/api/um/`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[${MODULE}] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log(`[${MODULE}] HTTP server closed`);
    process.exit(0);
  });
  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error(`[${MODULE}] Forced shutdown after timeout`);
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

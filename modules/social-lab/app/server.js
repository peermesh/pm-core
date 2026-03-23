// =============================================================================
// Social Lab Module - HTTP Server
// =============================================================================
// Minimal Node.js HTTP server using built-in http module.
// No framework dependencies -- keeps the scaffold lightweight.
//
// Route modules register their handlers via registerRoutes(routes).
// The router matches exact string paths, then regex patterns.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, parseUrl, VERSION, MODULE } from './lib/helpers.js';

// Import route registration functions
import registerHealthRoutes from './routes/health.js';
import registerLandingRoutes from './routes/landing.js';
import registerProfileRoutes from './routes/profile.js';
import registerLinksRoutes from './routes/links.js';
import registerMediaRoutes from './routes/media.js';
import registerFeedsRoutes from './routes/feeds.js';
import registerActivityPubRoutes from './routes/activitypub.js';
import registerNostrRoutes from './routes/nostr.js';
import registerIndieWebRoutes from './routes/indieweb.js';
import registerAtProtocolRoutes from './routes/atprotocol.js';
import registerDsnpRoutes from './routes/dsnp.js';
import registerZotRoutes from './routes/zot.js';
import registerMatrixRoutes from './routes/matrix.js';
import registerXmtpRoutes from './routes/xmtp.js';
import registerBlockchainRoutes from './routes/blockchain.js';
import registerDatasyncRoutes from './routes/datasync.js';
import registerPostsRoutes from './routes/posts.js';
import registerTimelineRoutes from './routes/timeline.js';
import registerAuthRoutes from './routes/auth.js';
import registerGroupsRoutes from './routes/groups.js';
import registerSearchRoutes from './routes/search.js';
import registerStudioRoutes from './routes/studio.js';
import registerPageRoutes from './routes/page.js';
import registerNotificationRoutes from './routes/notifications.js';
import registerManifestRoutes from './routes/manifest.js';
import { initializeWebPush } from './lib/webpush.js';

const PORT = parseInt(process.env.SOCIAL_LAB_PORT || '3000', 10);

// Initialize WebPush VAPID configuration (F-029)
try {
  initializeWebPush();
} catch (err) {
  console.warn('[social-lab] WebPush initialization deferred:', err.message);
}

// =============================================================================
// Static File Serving
// =============================================================================

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Serve a static file from the public directory.
 * Returns true if handled, false otherwise.
 */
async function serveStatic(req, res, pathname) {
  if (!pathname.startsWith('/static/')) return false;

  const relativePath = pathname.slice('/static/'.length);
  // Prevent directory traversal
  if (relativePath.includes('..') || relativePath.includes('\0')) {
    json(res, 403, { error: 'Forbidden' });
    return true;
  }

  const filePath = join(PUBLIC_DIR, relativePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.byteLength,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
    return true;
  } catch {
    json(res, 404, { error: 'Not Found', path: pathname });
    return true;
  }
}

// =============================================================================
// Route Registration
// =============================================================================
// Each route module pushes { method, pattern, handler } objects into this array.
// pattern can be:
//   - a string for exact match (e.g., '/health')
//   - a RegExp for parameterized paths (e.g., /^\/api\/profile\/([^/]+)$/)
// handler signature: (req, res, matches?) where matches is the regex match array.

const routes = [];

// Register all route modules.
// ORDER MATTERS: more specific patterns (feeds, AT Protocol DID) must be
// registered before less specific ones (profile page /@handle, AP actor).
registerHealthRoutes(routes);
registerLandingRoutes(routes);
registerFeedsRoutes(routes);
registerMediaRoutes(routes);
registerLinksRoutes(routes);
registerProfileRoutes(routes);
registerAtProtocolRoutes(routes);
registerDsnpRoutes(routes);
registerZotRoutes(routes);
registerMatrixRoutes(routes);
registerXmtpRoutes(routes);
registerBlockchainRoutes(routes);
registerDatasyncRoutes(routes);
registerPostsRoutes(routes);
registerTimelineRoutes(routes);
registerNostrRoutes(routes);
registerIndieWebRoutes(routes);
registerActivityPubRoutes(routes);
registerNotificationRoutes(routes);
registerManifestRoutes(routes);
registerSearchRoutes(routes);
registerAuthRoutes(routes);
registerGroupsRoutes(routes);
registerStudioRoutes(routes);
registerPageRoutes(routes);

// =============================================================================
// Router
// =============================================================================

async function route(req, res) {
  const { pathname } = parseUrl(req);
  const method = req.method;

  // Service Worker must be served from root for proper scope (F-029)
  if (method === 'GET' && pathname === '/sw.js') {
    try {
      const data = await readFile(join(PUBLIC_DIR, 'sw.js'));
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': data.byteLength,
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return;
    } catch {
      json(res, 404, { error: 'Service Worker not found' });
      return;
    }
  }

  // Static files first (GET only)
  if (method === 'GET' && pathname.startsWith('/static/')) {
    const handled = await serveStatic(req, res, pathname);
    if (handled) return;
  }

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

  // 404 — no matching route
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
  console.log(`[social-lab] Server listening on port ${PORT}`);
  console.log(`[social-lab] Module: ${MODULE} v${VERSION}`);
  console.log(`[social-lab] Landing page: http://0.0.0.0:${PORT}/`);
  console.log(`[social-lab] Health endpoint: http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[social-lab] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('[social-lab] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('[social-lab] Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

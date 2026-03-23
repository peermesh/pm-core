// =============================================================================
// Universal Manifest Module - UMID Resolver Routes
// =============================================================================
// GET /:umid                          — resolve manifest by UMID
// GET /.well-known/myum-resolver.json — service discovery
// GET /health                         — resolver health
//
// Implements the same contract as myum.net (CONTRACT.md):
//   - X-UM-Resolver-Contract: myum-resolver/v0.1
//   - UMID parsing: direct mode and b64u: mode
//   - Status codes: 200, 304, 307, 400, 404, 405, 410, 500
//   - CORS headers, ETag, Cache-Control
//   - X-UM-Resolver-Source: database (PostgreSQL-backed)
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pool } from '../db.js';
import { healthCheck as dbHealthCheck } from '../db.js';
import { emit } from '../lib/events.js';


// =============================================================================
// Constants
// =============================================================================

const CONTRACT_VERSION = 'myum-resolver/v0.1';
const RESOLVER_SOURCE = 'database';
const DOMAIN = process.env.DOMAIN || 'localhost';
const UM_SUBDOMAIN = process.env.UM_SUBDOMAIN || 'um';


// =============================================================================
// Helpers
// =============================================================================

/** CORS headers applied to all resolver responses */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag, Cache-Control, Content-Type, Location, X-UM-Resolver-Contract, X-UM-Resolver-Source',
};

/** MIME types for static file serving */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function json(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'X-UM-Resolver-Contract': CONTRACT_VERSION,
    'X-UM-Resolver-Source': RESOLVER_SOURCE,
    ...CORS_HEADERS,
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(data);
}

function jsonLD(res, status, body, etag) {
  const data = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/ld+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'public, max-age=60',
    'X-UM-Resolver-Contract': CONTRACT_VERSION,
    'X-UM-Resolver-Source': RESOLVER_SOURCE,
    ...CORS_HEADERS,
  };
  if (etag) {
    headers['ETag'] = etag;
  }
  res.writeHead(status, headers);
  res.end(data);
}

function computeEtag(data) {
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * Parse a UMID from the URL path.
 * Supports:
 *   - Direct mode: URL-decoded path segment (e.g., /urn:uuid:abc-123)
 *   - b64u mode: /b64u:<base64url-encoded UMID>
 *
 * @param {string} pathSegment - The raw path segment after /
 * @returns {string|null} The decoded UMID, or null if invalid
 */
function parseUmid(pathSegment) {
  const decoded = decodeURIComponent(pathSegment);

  if (decoded.startsWith('b64u:')) {
    try {
      const b64part = decoded.slice(5);
      return Buffer.from(b64part, 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }

  // Direct mode: must look like a UMID
  if (decoded.startsWith('urn:uuid:') || decoded.startsWith('urn:')) {
    return decoded;
  }

  return null;
}


// =============================================================================
// Route Handlers
// =============================================================================

/**
 * GET /:umid — Resolve manifest by UMID.
 */
async function resolveManifest(req, res, match) {
  const rawUmid = match[1];
  const umid = parseUmid(rawUmid);

  if (!umid) {
    return json(res, 400, { error: 'Invalid UMID format', raw: rawUmid });
  }

  try {
    const result = await pool.query(
      `SELECT signed_manifest, status FROM um.manifests
       WHERE umid = $1 ORDER BY version DESC LIMIT 1`,
      [umid]
    );

    if (result.rowCount === 0) {
      return json(res, 404, { error: 'UMID not found', umid });
    }

    const row = result.rows[0];

    if (row.status === 'revoked') {
      return json(res, 410, { error: 'Manifest has been revoked', umid });
    }

    const manifest = JSON.parse(row.signed_manifest);
    const etag = computeEtag(manifest);

    // Conditional request: 304 Not Modified
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'public, max-age=60',
        'X-UM-Resolver-Contract': CONTRACT_VERSION,
        'X-UM-Resolver-Source': RESOLVER_SOURCE,
      });
      return res.end();
    }

    // Content negotiation (AC-4):
    //   Accept: text/html → redirect to equip screen
    //   Accept: application/ld+json or application/json → JSON-LD
    //   Default (no Accept or */*) → JSON-LD (API-first)
    const accept = req.headers['accept'] || '';
    if (accept.includes('text/html') && !accept.includes('application/ld+json') && !accept.includes('application/json')) {
      const viewUrl = '/view/' + encodeURIComponent(umid);
      res.writeHead(302, {
        'Location': viewUrl,
        'X-UM-Resolver-Contract': CONTRACT_VERSION,
        'X-UM-Resolver-Source': RESOLVER_SOURCE,
        ...CORS_HEADERS,
      });
      return res.end();
    }

    emit('um.manifest.resolved', { umid });

    jsonLD(res, 200, manifest, etag);
  } catch (err) {
    console.error('[um-resolver] Error resolving UMID:', err.message);
    json(res, 500, { error: 'Internal resolver error' });
  }
}


/**
 * GET /.well-known/myum-resolver.json — Service discovery descriptor.
 */
async function serviceDiscovery(_req, res) {
  const descriptor = {
    name: 'PeerMesh Universal Manifest Resolver',
    contract: CONTRACT_VERSION,
    source: RESOLVER_SOURCE,
    baseUrl: `https://${UM_SUBDOMAIN}.${DOMAIN}`,
    paths: {
      resolve: '/{UMID}',
      view: '/view/{UMID}',
      wellKnownManifest: '/.well-known/manifest/{handle}',
      health: '/health',
      discovery: '/.well-known/myum-resolver.json',
    },
    storage: {
      backend: 'PostgreSQL',
      caching: 'Cache-Control: public, max-age=60',
    },
    cors: {
      allowOrigin: '*',
      allowMethods: ['GET', 'HEAD', 'OPTIONS'],
    },
    links: {
      spec: 'https://universalmanifest.net/spec/v02/',
      registry: 'https://universalmanifest.net/registry/',
    },
  };

  json(res, 200, descriptor, { 'Cache-Control': 'no-store' });
}


/**
 * GET /health — Resolver health check.
 */
async function healthEndpoint(_req, res) {
  const dbStatus = await dbHealthCheck();

  const status = dbStatus.connected ? 'ok' : 'degraded';
  const statusCode = dbStatus.connected ? 200 : 503;

  json(res, statusCode, {
    status,
    module: 'universal-manifest',
    contract: CONTRACT_VERSION,
    backend: 'postgres',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
}


/**
 * OPTIONS handler for CORS preflight.
 */
function corsOptions(_req, res) {
  res.writeHead(204, {
    ...CORS_HEADERS,
    'Access-Control-Allow-Headers': 'Accept, If-None-Match, X-UM-Module-ID',
    'Access-Control-Max-Age': '86400',
    'Content-Length': '0',
  });
  res.end();
}


/**
 * GET /view/{UMID} — Serve the equip screen SPA.
 * All /view/* paths serve the same index.html; the JS extracts the UMID from the URL.
 */
function serveEquipScreen(_req, res) {
  const publicDir = new URL('../public', import.meta.url).pathname;
  const indexPath = join(publicDir, 'view', 'index.html');
  try {
    const content = readFileSync(indexPath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(content),
      'Cache-Control': 'public, max-age=300',
    });
    res.end(content);
  } catch (err) {
    console.error('[um-resolver] Failed to serve equip screen:', err.message);
    json(res, 500, { error: 'Equip screen not available' });
  }
}


/**
 * Serve static files from app/public/.
 * Only serves files from /view/ path prefix to avoid conflicts.
 */
function serveStaticFile(req, res, match) {
  const filePath = match[1];

  // Security: prevent directory traversal
  if (filePath.includes('..') || filePath.includes('\0')) {
    json(res, 400, { error: 'Invalid path' });
    return;
  }

  const publicDir = new URL('../public', import.meta.url).pathname;
  const fullPath = join(publicDir, 'view', filePath);

  // Only serve files that exist
  if (!existsSync(fullPath)) {
    json(res, 404, { error: 'Not Found' });
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(fullPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(content);
  } catch (err) {
    console.error('[um-resolver] Static file error:', err.message);
    json(res, 500, { error: 'Internal error' });
  }
}


/**
 * GET /.well-known/manifest/:handle — Resolve handle to manifest.
 * Looks up the subject by handle in manifests table.
 * Returns the active signed manifest for the subject.
 */
async function wellKnownManifestByHandle(req, res, match) {
  const handle = decodeURIComponent(match[1]);

  if (!handle) {
    return json(res, 400, { error: 'Missing handle parameter' });
  }

  try {
    const result = await pool.query(
      `SELECT signed_manifest, status FROM um.manifests
       WHERE handle = $1 AND is_active = TRUE
       ORDER BY version DESC LIMIT 1`,
      [handle]
    );

    if (result.rowCount === 0) {
      return json(res, 404, { error: 'No manifest found for handle', handle });
    }

    const row = result.rows[0];

    if (row.status === 'revoked') {
      return json(res, 410, { error: 'Manifest has been revoked', handle });
    }

    const manifest = JSON.parse(row.signed_manifest);
    const etag = computeEtag(manifest);

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'public, max-age=60',
        'X-UM-Resolver-Contract': CONTRACT_VERSION,
      });
      return res.end();
    }

    jsonLD(res, 200, manifest, etag);
  } catch (err) {
    console.error('[um-resolver] Error resolving handle:', err.message);
    json(res, 500, { error: 'Internal resolver error' });
  }
}


/**
 * 405 Method Not Allowed handler for non-GET/HEAD/OPTIONS on resolver paths.
 */
function methodNotAllowed(_req, res) {
  json(res, 405, { error: 'Method Not Allowed. Use GET, HEAD, or OPTIONS.' }, {
    'Allow': 'GET, HEAD, OPTIONS',
  });
}


// =============================================================================
// Route Registration
// =============================================================================

export default function registerResolverRoutes(routes) {
  // Health (exact match, before UMID wildcard)
  routes.push({
    method: 'GET',
    pattern: '/health',
    handler: healthEndpoint,
  });

  // Service discovery
  routes.push({
    method: 'GET',
    pattern: '/.well-known/myum-resolver.json',
    handler: serviceDiscovery,
  });

  // Well-known manifest by handle
  routes.push({
    method: 'GET',
    pattern: /^\/\.well-known\/manifest\/(.+)$/,
    handler: wellKnownManifestByHandle,
  });

  // CORS preflight
  routes.push({
    method: 'OPTIONS',
    pattern: /^\/.*$/,
    handler: corsOptions,
  });

  // Static assets: /view/equip.css, /view/equip.js, /view/fallback-avatar.svg
  // Must be before the SPA catch-all so file requests don't get index.html
  routes.push({
    method: 'GET',
    pattern: /^\/view\/([^/]+\.[a-z]+)$/,
    handler: serveStaticFile,
  });

  // Equip screen SPA: /view/{UMID}
  // All other /view/* paths serve index.html; the JS reads UMID from the URL
  routes.push({
    method: 'GET',
    pattern: /^\/view\/(.+)$/,
    handler: serveEquipScreen,
  });

  // UMID resolution (wildcard -- must be registered last)
  // Matches paths like /urn:uuid:xxx or /b64u:xxx
  // Excludes paths starting with /api/ or /. (well-known, health already handled above)
  routes.push({
    method: 'GET',
    pattern: /^\/([^/]+)$/,
    handler: async (req, res, match) => {
      const segment = match[1];

      // Skip paths that are clearly not UMIDs
      if (segment.startsWith('api') || segment === 'favicon.ico') {
        json(res, 404, { error: 'Not Found' });
        return;
      }

      await resolveManifest(req, res, match);
    },
  });

  // HEAD support for resolver paths (same as GET but no body)
  routes.push({
    method: 'HEAD',
    pattern: /^\/([^/]+)$/,
    handler: async (req, res, match) => {
      const segment = match[1];
      if (segment.startsWith('api') || segment === 'favicon.ico') {
        res.writeHead(404);
        return res.end();
      }
      // Reuse resolve logic but suppress body output
      await resolveManifest(req, res, match);
    },
  });

  // HEAD support for health
  routes.push({
    method: 'HEAD',
    pattern: '/health',
    handler: healthEndpoint,
  });

  // 405 Method Not Allowed for non-API resolver paths
  // Catches POST/PUT/DELETE/PATCH on resolver endpoints
  routes.push({
    method: 'POST',
    pattern: /^\/(?!api\/)([^/]+)$/,
    handler: methodNotAllowed,
  });
  routes.push({
    method: 'PUT',
    pattern: /^\/(?!api\/)([^/]+)$/,
    handler: methodNotAllowed,
  });
  routes.push({
    method: 'DELETE',
    pattern: /^\/(?!api\/)([^/]+)$/,
    handler: methodNotAllowed,
  });
  routes.push({
    method: 'PATCH',
    pattern: /^\/(?!api\/)([^/]+)$/,
    handler: methodNotAllowed,
  });
}

// =============================================================================
// Universal Manifest Module - Manifest CRUD Routes
// =============================================================================
// POST   /api/um/manifest             — create manifest for a subject
// GET    /api/um/manifest/:umid       — get by UMID
// GET    /api/um/manifest/subject/:webid — get by subject WebID
// PUT    /api/um/manifest/:umid/facet/:name — write/update facet
// DELETE /api/um/manifest/:umid       — revoke
// POST   /api/um/manifest/:umid/sign  — re-sign
// POST   /api/um/manifest/verify      — verify signature
// =============================================================================

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import {
  UM_CONTEXT,
  UM_MANIFEST_VERSION,
  DEFAULT_TTL_MS,
  generateKeypair,
  signManifest,
  verifyManifest,
} from '../lib/signing.js';
import {
  checkFacetAuth,
  registerFacet,
  recordFacetWrite,
} from '../lib/facet-auth.js';
import { emit } from '../lib/events.js';


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

function jsonLD(res, status, body, etag) {
  const data = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/ld+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'public, max-age=60',
  };
  if (etag) {
    headers['ETag'] = etag;
  }
  res.writeHead(status, headers);
  res.end(data);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        resolve(body);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function computeEtag(data) {
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}


// =============================================================================
// Route Handlers
// =============================================================================

/**
 * POST /api/um/manifest — Create a new manifest for a subject.
 */
async function createManifest(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { subject, facets, consents, claims, pointers, ttlMs } = body;

  if (!subject || typeof subject !== 'string') {
    return json(res, 400, { error: 'Missing required field: subject (WebID or DID)' });
  }

  // Generate UMID
  const umid = `urn:uuid:${randomUUID()}`;
  const now = new Date();
  const ttl = ttlMs || DEFAULT_TTL_MS;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttl).toISOString();

  // Build unsigned manifest
  const manifest = {
    '@context': UM_CONTEXT,
    '@id': umid,
    '@type': 'um:Manifest',
    manifestVersion: UM_MANIFEST_VERSION,
    subject,
    issuedAt,
    expiresAt,
    facets: facets || [],
    claims: claims || [],
    consents: consents || [],
    pointers: pointers || [],
  };

  // Generate or retrieve signing keypair
  // For now, generate a per-manifest keypair (Phase 1: instance-level key)
  const keypair = generateKeypair();
  const keyRef = `${subject}#key-1`;

  // Sign
  const signedManifest = signManifest(manifest, keypair.privateKeyPem, keypair.publicKeySpkiB64, keyRef);

  // Store keypair
  await pool.query(
    `INSERT INTO um.signing_keys (subject, public_key_spki_b64, private_key_pem_encrypted, key_ref, algorithm)
     VALUES ($1, $2, $3, $4, 'Ed25519')
     ON CONFLICT (key_ref) DO UPDATE SET
       public_key_spki_b64 = EXCLUDED.public_key_spki_b64,
       private_key_pem_encrypted = EXCLUDED.private_key_pem_encrypted`,
    [subject, keypair.publicKeySpkiB64, keypair.privateKeyPem, keyRef]
  );

  // Store manifest
  await pool.query(
    `INSERT INTO um.manifests (umid, subject, manifest_json, signed_manifest, manifest_version, version, status, is_active, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 1, 'active', TRUE, $6, $7)`,
    [
      umid,
      subject,
      JSON.stringify(manifest),
      JSON.stringify(signedManifest),
      UM_MANIFEST_VERSION,
      issuedAt,
      expiresAt,
    ]
  );

  console.log(`[um] Created manifest for ${subject} (UMID: ${umid})`);
  emit('um.manifest.created', { umid, subject });

  json(res, 201, { umid, signedManifest });
}


/**
 * GET /api/um/manifest/:umid — Get manifest by UMID.
 */
async function getManifestByUmid(req, res, match) {
  const umid = decodeURIComponent(match[1]);

  const result = await pool.query(
    `SELECT signed_manifest, status FROM um.manifests
     WHERE umid = $1 ORDER BY version DESC LIMIT 1`,
    [umid]
  );

  if (result.rowCount === 0) {
    return json(res, 404, { error: 'Manifest not found', umid });
  }

  const row = result.rows[0];

  if (row.status === 'revoked') {
    return json(res, 410, { error: 'Manifest has been revoked', umid });
  }

  const manifest = JSON.parse(row.signed_manifest);
  const etag = computeEtag(manifest);

  // Conditional request support
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }

  jsonLD(res, 200, manifest, etag);
}


/**
 * GET /api/um/manifest/subject/:webid — Get manifest by subject WebID.
 */
async function getManifestBySubject(req, res, match) {
  const webid = decodeURIComponent(match[1]);

  const result = await pool.query(
    `SELECT signed_manifest, status FROM um.manifests
     WHERE subject = $1 AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`,
    [webid]
  );

  if (result.rowCount === 0) {
    return json(res, 404, { error: 'No active manifest for subject', subject: webid });
  }

  const row = result.rows[0];

  if (row.status === 'revoked') {
    return json(res, 410, { error: 'Manifest has been revoked', subject: webid });
  }

  const manifest = JSON.parse(row.signed_manifest);
  const etag = computeEtag(manifest);

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }

  jsonLD(res, 200, manifest, etag);
}


/**
 * PUT /api/um/manifest/:umid/facet/:name — Write or update a facet.
 * Requires X-UM-Module-ID header for authorization.
 */
async function writeFacet(req, res, match) {
  const umid = decodeURIComponent(match[1]);
  const facetName = decodeURIComponent(match[2]);
  const moduleId = req.headers['x-um-module-id'];

  if (!moduleId) {
    return json(res, 400, { error: 'Missing X-UM-Module-ID header' });
  }

  // Check authorization
  const authorized = await checkFacetAuth(facetName, moduleId);
  if (!authorized) {
    return json(res, 403, {
      error: `Module "${moduleId}" not authorized for facet "${facetName}"`,
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  // Get current manifest
  const result = await pool.query(
    `SELECT id, manifest_json, version, subject, status FROM um.manifests
     WHERE umid = $1 AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`,
    [umid]
  );

  if (result.rowCount === 0) {
    return json(res, 404, { error: 'Manifest not found', umid });
  }

  const row = result.rows[0];

  if (row.status === 'revoked') {
    return json(res, 410, { error: 'Manifest has been revoked', umid });
  }

  const manifest = JSON.parse(row.manifest_json);
  const newVersion = row.version + 1;

  // Build the facet object
  const newFacet = {
    '@type': 'um:Facet',
    name: facetName,
    entity: body,
  };

  // Replace or add the facet
  const facetIndex = manifest.facets.findIndex(f => f.name === facetName);
  if (facetIndex >= 0) {
    manifest.facets[facetIndex] = newFacet;
  } else {
    manifest.facets.push(newFacet);
  }

  // Get signing key
  const keyResult = await pool.query(
    `SELECT public_key_spki_b64, private_key_pem_encrypted, key_ref
     FROM um.signing_keys
     WHERE subject = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [row.subject]
  );

  if (keyResult.rowCount === 0) {
    return json(res, 500, { error: 'No signing key found for manifest subject' });
  }

  const key = keyResult.rows[0];

  // Re-sign
  const signedManifest = signManifest(
    manifest,
    key.private_key_pem_encrypted,
    key.public_key_spki_b64,
    key.key_ref
  );

  // Deactivate old version, insert new
  await pool.query(
    `UPDATE um.manifests SET is_active = FALSE, updated_at = NOW()
     WHERE umid = $1 AND is_active = TRUE`,
    [umid]
  );

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);

  await pool.query(
    `INSERT INTO um.manifests (umid, subject, manifest_json, signed_manifest, manifest_version, version, status, is_active, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', TRUE, $7, $8)`,
    [
      umid,
      row.subject,
      JSON.stringify(manifest),
      JSON.stringify(signedManifest),
      UM_MANIFEST_VERSION,
      newVersion,
      now.toISOString(),
      expiresAt.toISOString(),
    ]
  );

  // Auto-register facet if unregistered
  await registerFacet(facetName, moduleId, null);

  // Record the write
  await recordFacetWrite(umid, facetName, moduleId);

  console.log(`[um] Facet "${facetName}" written by ${moduleId} on ${umid} (v${newVersion})`);
  emit('um.facet.written', { umid, facetName, writerModule: moduleId, version: newVersion });
  emit('um.manifest.updated', { umid, subject: row.subject, version: newVersion });

  json(res, 200, { umid, signedManifest });
}


/**
 * DELETE /api/um/manifest/:umid — Revoke a manifest.
 */
async function revokeManifest(req, res, match) {
  const umid = decodeURIComponent(match[1]);

  const result = await pool.query(
    `UPDATE um.manifests SET status = 'revoked', is_active = FALSE, updated_at = NOW()
     WHERE umid = $1 AND is_active = TRUE
     RETURNING id`,
    [umid]
  );

  if (result.rowCount === 0) {
    return json(res, 404, { error: 'Manifest not found or already revoked', umid });
  }

  console.log(`[um] Revoked manifest ${umid}`);
  emit('um.manifest.revoked', { umid });

  json(res, 200, { umid, status: 'revoked' });
}


/**
 * POST /api/um/manifest/:umid/sign — Re-sign a manifest.
 */
async function resignManifest(req, res, match) {
  const umid = decodeURIComponent(match[1]);

  const result = await pool.query(
    `SELECT id, manifest_json, version, subject, status FROM um.manifests
     WHERE umid = $1 AND is_active = TRUE
     ORDER BY version DESC LIMIT 1`,
    [umid]
  );

  if (result.rowCount === 0) {
    return json(res, 404, { error: 'Manifest not found', umid });
  }

  const row = result.rows[0];

  if (row.status === 'revoked') {
    return json(res, 410, { error: 'Manifest has been revoked', umid });
  }

  const manifest = JSON.parse(row.manifest_json);

  // Get signing key
  const keyResult = await pool.query(
    `SELECT public_key_spki_b64, private_key_pem_encrypted, key_ref
     FROM um.signing_keys
     WHERE subject = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [row.subject]
  );

  if (keyResult.rowCount === 0) {
    return json(res, 500, { error: 'No signing key found for manifest subject' });
  }

  const key = keyResult.rows[0];

  // Update timestamps
  const now = new Date();
  manifest.issuedAt = now.toISOString();
  manifest.expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS).toISOString();

  // Re-sign
  const signedManifest = signManifest(
    manifest,
    key.private_key_pem_encrypted,
    key.public_key_spki_b64,
    key.key_ref
  );

  // Update in place
  await pool.query(
    `UPDATE um.manifests SET
       manifest_json = $1,
       signed_manifest = $2,
       issued_at = $3,
       expires_at = $4,
       updated_at = NOW()
     WHERE umid = $5 AND is_active = TRUE`,
    [
      JSON.stringify(manifest),
      JSON.stringify(signedManifest),
      manifest.issuedAt,
      manifest.expiresAt,
      umid,
    ]
  );

  console.log(`[um] Re-signed manifest ${umid}`);
  emit('um.manifest.updated', { umid, subject: row.subject, action: 're-sign' });

  json(res, 200, { umid, signedManifest });
}


/**
 * POST /api/um/manifest/verify — Verify a manifest signature.
 */
async function verifyManifestRoute(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const result = verifyManifest(body);

  console.log(`[um] Verified manifest: valid=${result.valid}`);
  emit('um.manifest.verified', { valid: result.valid, errors: result.errors });

  json(res, 200, result);
}


// =============================================================================
// Route Registration
// =============================================================================

export default function registerManifestRoutes(routes) {
  // Create
  routes.push({
    method: 'POST',
    pattern: '/api/um/manifest',
    handler: createManifest,
  });

  // Verify (must be before :umid pattern)
  routes.push({
    method: 'POST',
    pattern: /^\/api\/um\/manifest\/verify$/,
    handler: verifyManifestRoute,
  });

  // Get by subject (must be before :umid pattern)
  routes.push({
    method: 'GET',
    pattern: /^\/api\/um\/manifest\/subject\/(.+)$/,
    handler: getManifestBySubject,
  });

  // Get by UMID
  routes.push({
    method: 'GET',
    pattern: /^\/api\/um\/manifest\/([^/]+)$/,
    handler: getManifestByUmid,
  });

  // Write facet
  routes.push({
    method: 'PUT',
    pattern: /^\/api\/um\/manifest\/([^/]+)\/facet\/([^/]+)$/,
    handler: writeFacet,
  });

  // Revoke
  routes.push({
    method: 'DELETE',
    pattern: /^\/api\/um\/manifest\/([^/]+)$/,
    handler: revokeManifest,
  });

  // Re-sign
  routes.push({
    method: 'POST',
    pattern: /^\/api\/um\/manifest\/([^/]+)\/sign$/,
    handler: resignManifest,
  });
}

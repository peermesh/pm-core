// =============================================================================
// Universal Manifest Module - Consumer SDK
// =============================================================================
// Lightweight client library for other Docker Lab modules to interact
// with the UM API. Import this file into your module to read/write manifests.
//
// Configuration:
//   UM_API_URL env var (defaults to http://um:4200)
//
// Usage:
//   import { createManifest, writeMyFacet, readManifest } from './um-client.js';
//
//   const { umid, signedManifest } = await createManifest('https://pod.example/profile/card#me');
//   await writeMyFacet(umid, 'publicProfile', { displayName: 'Alice' }, 'social-lab');
//   const manifest = await readManifest(umid);
// =============================================================================

const UM_API_URL = process.env.UM_API_URL || 'http://um:4200';


// =============================================================================
// Error Types
// =============================================================================

class UmClientError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'UmClientError';
    this.status = status;
    this.body = body;
  }
}

class UmUnauthorizedError extends UmClientError {
  constructor(message, body) {
    super(message, 403, body);
    this.name = 'UmUnauthorizedError';
  }
}

class UmNotFoundError extends UmClientError {
  constructor(message, body) {
    super(message, 404, body);
    this.name = 'UmNotFoundError';
  }
}

class UmRevokedError extends UmClientError {
  constructor(message, body) {
    super(message, 410, body);
    this.name = 'UmRevokedError';
  }
}


// =============================================================================
// HTTP Helpers
// =============================================================================

async function request(method, path, body, headers) {
  const url = `${UM_API_URL}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (res.status === 403) {
    throw new UmUnauthorizedError(json.error || 'Unauthorized', json);
  }
  if (res.status === 404) {
    throw new UmNotFoundError(json.error || 'Not found', json);
  }
  if (res.status === 410) {
    throw new UmRevokedError(json.error || 'Revoked', json);
  }
  if (res.status >= 400) {
    throw new UmClientError(json.error || `HTTP ${res.status}`, res.status, json);
  }

  return json;
}


// =============================================================================
// SDK Functions
// =============================================================================

/**
 * Create a new manifest for a subject.
 * @param {string} subject - WebID or DID of the manifest subject
 * @param {object} [options] - Optional: facets, consents, claims, pointers, ttlMs
 * @returns {Promise<{ umid: string, signedManifest: object }>}
 */
async function createManifest(subject, options) {
  return request('POST', '/api/um/manifest', { subject, ...options });
}

/**
 * Read a manifest by UMID.
 * @param {string} umid - The UMID to look up
 * @returns {Promise<object>} The signed manifest
 */
async function readManifest(umid) {
  return request('GET', `/api/um/manifest/${encodeURIComponent(umid)}`);
}

/**
 * Read a manifest by subject WebID.
 * @param {string} webid - The subject WebID
 * @returns {Promise<object>} The signed manifest
 */
async function readManifestBySubject(webid) {
  return request('GET', `/api/um/manifest/subject/${encodeURIComponent(webid)}`);
}

/**
 * Write or update a facet on a manifest.
 * @param {string} umid - The manifest UMID
 * @param {string} facetName - The facet name to write
 * @param {object} facetData - The facet entity data
 * @param {string} moduleId - The calling module ID (for authorization)
 * @returns {Promise<{ umid: string, signedManifest: object }>}
 */
async function writeMyFacet(umid, facetName, facetData, moduleId) {
  return request(
    'PUT',
    `/api/um/manifest/${encodeURIComponent(umid)}/facet/${encodeURIComponent(facetName)}`,
    facetData,
    { 'X-UM-Module-ID': moduleId }
  );
}

/**
 * Revoke a manifest.
 * @param {string} umid - The manifest UMID
 * @returns {Promise<{ umid: string, status: string }>}
 */
async function revokeManifest(umid) {
  return request('DELETE', `/api/um/manifest/${encodeURIComponent(umid)}`);
}

/**
 * Verify a manifest signature.
 * @param {object} signedManifest - The full signed manifest to verify
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
async function verifyManifest(signedManifest) {
  return request('POST', '/api/um/manifest/verify', signedManifest);
}

/**
 * Resolve a UMID via the resolver endpoint.
 * @param {string} umid - The UMID to resolve
 * @returns {Promise<object>} The signed manifest
 */
async function resolveUmid(umid) {
  return request('GET', `/${encodeURIComponent(umid)}`);
}

/**
 * Register a facet with an authorized writer module.
 * @param {string} moduleName - The module ID
 * @param {string} facetName - The facet name
 * @param {string} [description] - Optional description
 * @returns {Promise<{ registered: boolean, facetName: string, authorizedModule: string }>}
 */
async function registerFacet(moduleName, facetName, description) {
  return request('POST', '/api/um/facets/register', { moduleName, facetName, description });
}

/**
 * Provision an Ed25519 keypair for a user.
 * @param {string} subjectWebId - The user's WebID or DID
 * @returns {Promise<{ publicKeySpkiB64: string, keyRef: string }>}
 */
async function provisionKeys(subjectWebId) {
  return request('POST', '/api/um/keys/provision', { subjectWebId });
}


export {
  // SDK functions
  createManifest,
  readManifest,
  readManifestBySubject,
  writeMyFacet,
  revokeManifest,
  verifyManifest,
  resolveUmid,
  registerFacet,
  provisionKeys,

  // Error types
  UmClientError,
  UmUnauthorizedError,
  UmNotFoundError,
  UmRevokedError,
};

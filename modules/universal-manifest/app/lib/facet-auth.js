// =============================================================================
// Universal Manifest Module - Facet Authorization
// =============================================================================
// Manages the facet registry: which module is authorized to write which facet.
// Enforces write authorization at the API level.
//
// Well-known facet registrations are seeded by the database migration (001).
// Runtime registrations use the POST /api/um/facets/register endpoint.
// =============================================================================

import { pool } from '../db.js';

/**
 * Well-known facet registrations, seeded at startup if not present.
 * These match the migration seed data.
 */
const WELL_KNOWN_FACETS = [
  { name: 'publicProfile', authorizedModule: 'social-lab', description: 'Display name, bio, avatar, handle' },
  { name: 'socialIdentity', authorizedModule: 'social-lab', description: 'Protocol identities (AP, Nostr, AT, etc.)' },
  { name: 'socialGraph', authorizedModule: 'social-lab', description: 'Follower/following counts, group memberships' },
  { name: 'protocolStatus', authorizedModule: 'social-lab', description: 'Active/stub/unavailable protocol status' },
  { name: 'credentials', authorizedModule: 'did-wallet', description: 'Verifiable credentials' },
  { name: 'verifiableCredentials', authorizedModule: 'did-wallet', description: 'W3C Verifiable Credentials' },
  { name: 'spatialAnchors', authorizedModule: 'spatial-fabric', description: 'Spatial anchor locations' },
  { name: 'placeMembership', authorizedModule: 'spatial-fabric', description: 'Spatial place memberships' },
  { name: 'crossWorldProfile', authorizedModule: 'spatial-fabric', description: 'Cross-world identity projection' },
];


/**
 * Register a facet name with an authorized writer module.
 * A facet can only be registered by one module (first-register wins).
 *
 * @param {string} facetName - The facet name to register
 * @param {string} authorizedModule - The module ID authorized to write this facet
 * @param {string} [description] - Optional description
 * @returns {Promise<{ registered: boolean, facetName: string, authorizedModule: string, error?: string }>}
 */
async function registerFacet(facetName, authorizedModule, description) {
  try {
    await pool.query(
      `INSERT INTO um.facet_registry (facet_name, authorized_module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (facet_name) DO NOTHING`,
      [facetName, authorizedModule, description || null]
    );

    // Verify it was us who registered (or already registered by us)
    const result = await pool.query(
      `SELECT authorized_module FROM um.facet_registry WHERE facet_name = $1`,
      [facetName]
    );

    if (result.rowCount === 0) {
      return { registered: false, facetName, authorizedModule, error: 'Registration failed' };
    }

    const owner = result.rows[0].authorized_module;
    if (owner !== authorizedModule) {
      return {
        registered: false,
        facetName,
        authorizedModule: owner,
        error: `Facet "${facetName}" already registered by module "${owner}"`,
      };
    }

    return { registered: true, facetName, authorizedModule };
  } catch (err) {
    return { registered: false, facetName, authorizedModule, error: err.message };
  }
}


/**
 * Check if a module is authorized to write a given facet.
 *
 * @param {string} facetName - The facet name
 * @param {string} requestingModule - The module ID requesting write access
 * @returns {Promise<boolean>}
 */
async function checkFacetAuth(facetName, requestingModule) {
  const result = await pool.query(
    `SELECT authorized_module FROM um.facet_registry WHERE facet_name = $1`,
    [facetName]
  );

  if (result.rowCount === 0) {
    // Unregistered facet -- allow the write (open-world assumption for new facets)
    // The module will be auto-registered as the owner
    return true;
  }

  return result.rows[0].authorized_module === requestingModule;
}


/**
 * List all registered facets.
 *
 * @returns {Promise<Array<{ name: string, authorizedModule: string, description: string, createdAt: string }>>}
 */
async function listFacets() {
  const result = await pool.query(
    `SELECT facet_name, authorized_module, description, created_at
     FROM um.facet_registry
     ORDER BY facet_name ASC`
  );

  return result.rows.map(row => ({
    name: row.facet_name,
    authorizedModule: row.authorized_module,
    description: row.description,
    createdAt: row.created_at,
  }));
}


/**
 * Record a facet write in the audit log.
 *
 * @param {string} umid
 * @param {string} facetName
 * @param {string} writerModule
 */
async function recordFacetWrite(umid, facetName, writerModule) {
  await pool.query(
    `INSERT INTO um.facet_writes (umid, facet_name, writer_module)
     VALUES ($1, $2, $3)`,
    [umid, facetName, writerModule]
  );
}


export {
  WELL_KNOWN_FACETS,
  registerFacet,
  checkFacetAuth,
  listFacets,
  recordFacetWrite,
};

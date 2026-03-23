// =============================================================================
// Universal Manifest Module - Facet Registry Routes
// =============================================================================
// POST /api/um/facets/register — register facet name + authorized writer
// GET  /api/um/facets           — list all registered facets
// =============================================================================

import { registerFacet, listFacets } from '../lib/facet-auth.js';


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


// =============================================================================
// Route Handlers
// =============================================================================

/**
 * POST /api/um/facets/register — Register a facet with an authorized writer.
 */
async function registerFacetRoute(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { moduleName, facetName, description } = body;

  if (!moduleName || typeof moduleName !== 'string') {
    return json(res, 400, { error: 'Missing required field: moduleName' });
  }
  if (!facetName || typeof facetName !== 'string') {
    return json(res, 400, { error: 'Missing required field: facetName' });
  }

  const result = await registerFacet(facetName, moduleName, description);

  if (!result.registered) {
    return json(res, 409, result);
  }

  console.log(`[um] Facet "${facetName}" registered for module "${moduleName}"`);

  json(res, 201, result);
}


/**
 * GET /api/um/facets — List all registered facets.
 */
async function listFacetsRoute(_req, res) {
  const facets = await listFacets();
  json(res, 200, { facets });
}


// =============================================================================
// Route Registration
// =============================================================================

export default function registerFacetRoutes(routes) {
  routes.push({
    method: 'POST',
    pattern: '/api/um/facets/register',
    handler: registerFacetRoute,
  });

  routes.push({
    method: 'GET',
    pattern: '/api/um/facets',
    handler: listFacetsRoute,
  });
}

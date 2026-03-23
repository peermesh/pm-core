// =============================================================================
// Universal Manifest Module - Key Provisioning Routes
// =============================================================================
// POST /api/um/keys/provision — provision per-user Ed25519 keypair
// =============================================================================

import { pool } from '../db.js';
import { generateKeypair } from '../lib/signing.js';


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
 * POST /api/um/keys/provision — Provision an Ed25519 keypair for a user.
 *
 * Request body: { subjectWebId: string }
 * Response: { publicKeySpkiB64: string, keyRef: string }
 */
async function provisionKey(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { subjectWebId } = body;

  if (!subjectWebId || typeof subjectWebId !== 'string') {
    return json(res, 400, { error: 'Missing required field: subjectWebId' });
  }

  // Check if user already has an active key
  const existing = await pool.query(
    `SELECT public_key_spki_b64, key_ref FROM um.signing_keys
     WHERE subject = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [subjectWebId]
  );

  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    return json(res, 200, {
      publicKeySpkiB64: row.public_key_spki_b64,
      keyRef: row.key_ref,
      existing: true,
    });
  }

  // Generate new keypair
  const keypair = generateKeypair();
  const keyRef = `${subjectWebId}#key-1`;

  // Store keypair (private key stored as PEM -- Phase 1 approach)
  await pool.query(
    `INSERT INTO um.signing_keys (subject, public_key_spki_b64, private_key_pem_encrypted, key_ref, algorithm)
     VALUES ($1, $2, $3, $4, 'Ed25519')
     ON CONFLICT (key_ref) DO UPDATE SET
       public_key_spki_b64 = EXCLUDED.public_key_spki_b64,
       private_key_pem_encrypted = EXCLUDED.private_key_pem_encrypted`,
    [subjectWebId, keypair.publicKeySpkiB64, keypair.privateKeyPem, keyRef]
  );

  console.log(`[um] Provisioned Ed25519 keypair for ${subjectWebId} (keyRef: ${keyRef})`);

  json(res, 201, {
    publicKeySpkiB64: keypair.publicKeySpkiB64,
    keyRef,
    existing: false,
  });
}


// =============================================================================
// Route Registration
// =============================================================================

export default function registerKeyRoutes(routes) {
  routes.push({
    method: 'POST',
    pattern: '/api/um/keys/provision',
    handler: provisionKey,
  });
}

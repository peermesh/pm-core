// =============================================================================
// AT Protocol Routes
// =============================================================================
// GET /.well-known/did.json          — Domain-level DID Document
// GET /.well-known/atproto-did       — AT Protocol handle resolution
// GET /ap/actor/:handle/did.json     — Per-user DID Document

import { pool } from '../db.js';
import { json, jsonWithType, parseUrl, lookupProfileByHandle, BASE_URL, INSTANCE_DOMAIN } from '../lib/helpers.js';

// Import getOrCreateActorKeys indirectly — we need it for DID doc building.
// We replicate the minimal lookup here to avoid circular dependency.
import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto';

/**
 * Get or create an RSA keypair for an actor (shared with activitypub.js).
 * Duplicated here to avoid circular dependency. In a future refactor,
 * this could move to a shared lib/actor-keys.js module.
 */
async function getOrCreateActorKeys(profile) {
  const handle = profile.username;
  const actorUri = `${BASE_URL}/ap/actor/${handle}`;

  const existing = await pool.query(
    `SELECT id, actor_uri, public_key_pem, private_key_pem, key_id
     FROM social_federation.ap_actors
     WHERE webid = $1 AND status = 'active'`,
    [profile.webid]
  );

  if (existing.rowCount > 0 && existing.rows[0].public_key_pem && existing.rows[0].private_key_pem) {
    return existing.rows[0];
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = `${actorUri}#main-key`;
  const id = randomUUID();
  const publicKeyHash = createHash('sha256').update(publicKey).digest('hex');

  if (existing.rowCount > 0) {
    await pool.query(
      `UPDATE social_federation.ap_actors
       SET public_key_pem = $1, private_key_pem = $2, key_id = $3, updated_at = NOW()
       WHERE id = $4`,
      [publicKey, privateKey, keyId, existing.rows[0].id]
    );
    return { ...existing.rows[0], public_key_pem: publicKey, private_key_pem: privateKey, key_id: keyId };
  }

  const inboxUri = `${BASE_URL}/ap/inbox`;
  const outboxUri = `${BASE_URL}/ap/outbox/${handle}`;

  await pool.query(
    `INSERT INTO social_federation.ap_actors
       (id, webid, actor_uri, inbox_uri, outbox_uri, public_key_pem, private_key_pem, key_id, protocol, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'activitypub', 'active')`,
    [id, profile.webid, actorUri, inboxUri, outboxUri, publicKey, privateKey, keyId]
  );

  await pool.query(
    `UPDATE social_profiles.profile_index SET ap_actor_uri = $1, updated_at = NOW() WHERE id = $2`,
    [actorUri, profile.id]
  );

  await pool.query(
    `INSERT INTO social_keys.key_metadata
       (id, omni_account_id, protocol, key_type, public_key_hash, key_purpose, is_active)
     VALUES ($1, $2, 'activitypub', 'rsa2048', $3, 'signing', TRUE)`,
    [randomUUID(), profile.omni_account_id, publicKeyHash]
  );

  return { id, actor_uri: actorUri, public_key_pem: publicKey, private_key_pem: privateKey, key_id: keyId };
}

/**
 * Build a did:web DID Document for a profile.
 */
function buildDidDocument(profile, keys) {
  const handle = profile.username;
  const ourDomain = INSTANCE_DOMAIN;
  const did = profile.at_did || `did:web:${ourDomain}:ap:actor:${handle}`;

  let publicKeyMultibase = null;
  if (keys && keys.public_key_pem) {
    const pemLines = keys.public_key_pem.split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const derB64 = pemLines.join('');
    publicKeyMultibase = 'z' + derB64;
  }

  const didDoc = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
    ],
    id: did,
    alsoKnownAs: [
      `at://${handle}.${ourDomain}`,
      `${BASE_URL}/@${handle}`,
    ],
    verificationMethod: [],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: BASE_URL,
      },
      {
        id: '#profile',
        type: 'LinkedDomains',
        serviceEndpoint: `${BASE_URL}/@${handle}`,
      },
    ],
  };

  if (publicKeyMultibase) {
    didDoc.verificationMethod.push({
      id: `${did}#atproto`,
      type: 'Multikey',
      controller: did,
      publicKeyMultibase: publicKeyMultibase,
    });
  }

  return didDoc;
}

export default function registerRoutes(routes) {
  // GET /.well-known/did.json — Domain-level DID Document
  routes.push({
    method: 'GET',
    pattern: '/.well-known/did.json',
    handler: async (req, res) => {
      const ourDomain = INSTANCE_DOMAIN;
      const did = `did:web:${ourDomain}`;

      const didDoc = {
        '@context': [
          'https://www.w3.org/ns/did/v1',
          'https://w3id.org/security/multikey/v1',
        ],
        id: did,
        alsoKnownAs: [BASE_URL],
        service: [
          {
            id: '#social',
            type: 'SocialLabInstance',
            serviceEndpoint: BASE_URL,
          },
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: BASE_URL,
          },
        ],
      };

      jsonWithType(res, 200, 'application/did+json; charset=utf-8', didDoc, {
        'Cache-Control': 'max-age=86400, public',
        'Access-Control-Allow-Origin': '*',
      });
    },
  });

  // GET /.well-known/atproto-did — AT Protocol handle resolution
  routes.push({
    method: 'GET',
    pattern: '/.well-known/atproto-did',
    handler: async (req, res) => {
      const { searchParams } = parseUrl(req);
      const handleParam = searchParams.get('handle');

      if (!handleParam) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing required "handle" query parameter');
      }

      const ourDomain = INSTANCE_DOMAIN;
      let username = null;

      if (handleParam.endsWith(`.${ourDomain}`)) {
        username = handleParam.slice(0, -(ourDomain.length + 1));
      } else if (!handleParam.includes('.')) {
        username = handleParam;
      }

      if (!username) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Handle not found');
      }

      const profile = await lookupProfileByHandle(pool, username);
      if (!profile) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Handle not found');
      }

      const did = profile.at_did || `did:web:${ourDomain}:ap:actor:${username}`;

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'max-age=3600, public',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(did);
    },
  });

  // GET /ap/actor/:handle/did.json — Per-user DID Document
  routes.push({
    method: 'GET',
    pattern: /^\/ap\/actor\/([^/]+)\/did\.json$/,
    handler: async (req, res, matches) => {
      const handle = matches[1];
      const profile = await lookupProfileByHandle(pool, handle);
      if (!profile) {
        return json(res, 404, { error: 'Not Found', message: `No profile found for handle: ${handle}` });
      }

      const keys = await getOrCreateActorKeys(profile);
      const didDoc = buildDidDocument(profile, keys);

      jsonWithType(res, 200, 'application/did+json; charset=utf-8', didDoc, {
        'Cache-Control': 'max-age=86400, public',
        'Access-Control-Allow-Origin': '*',
      });
    },
  });
}

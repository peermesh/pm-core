import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://peers.social';
const ROLES = new Set(['super_admin', 'admin', 'moderator', 'user']);
const reject = () => { throw new Error('unauthorized'); };
const text = value => typeof value === 'string' && /^[\x21-\x7e]{1,1024}$/.test(value);
const identifier = value => text(value) && !/[,;\\]/.test(value);

export function identityHeaders(claims, profile, config) {
  const actor = profile?.shared_public_profile?.subject;
  if (profile?.did !== claims.sub || !text(actor) || !ROLES.has(profile.role)) reject();
  const webid = new URL(actor);
  if (webid.protocol !== 'https:' || webid.username || webid.password || webid.href !== actor) reject();
  return {
    'X-Peermesh-Auth-Subject': claims.sub,
    'X-Peermesh-Actor-WebID': actor,
    'X-Peermesh-Tenant-ID': config.tenantId,
    'X-Peermesh-Property-ID': config.propertyId,
    'X-Peermesh-Roles': profile.role,
  };
}

// Requests go only to operator-configured provider URLs, never token jku/x5u.
async function boundedJson(fetcher, url, headers) {
  const res = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!res.ok || !res.body) reject();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > 65536) { await res.body.cancel().catch(() => {}); reject(); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createVerifier(config, { fetcher = fetch, clock = Date.now } = {}) {
  if (config.issuer !== ISSUER || !identifier(config.audience) ||
      config.tenantId !== config.audience || !identifier(config.propertyId) ||
      !text(config.tenantKey) || config.tenantKey.length < 32) throw new Error('invalid configuration');
  const origin = new URL(config.origin);
  const fixtureOrigin = config.fixture === true && origin.protocol === 'http:' && origin.hostname === 'idp-check-social';
  if ((!fixtureOrigin && origin.origin !== ISSUER) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid provider origin');
  let keys = [], expires = 0, pending, unknownRefresh = -Infinity;
  async function refresh() {
    if (!pending) pending = (async () => {
      const data = await boundedJson(fetcher, origin.origin + '/.well-known/jwks.json', { Accept: 'application/json' });
      if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 8) reject();
      const ids = new Set();
      const next = data.keys.map(jwk => {
        if (!text(jwk.kid) || ids.has(jwk.kid) || jwk.kty !== 'RSA' || jwk.use !== 'sig' ||
            jwk.alg !== 'RS256' || jwk.d || jwk.p || jwk.q) reject();
        ids.add(jwk.kid);
        const key = createPublicKey({ key: jwk, format: 'jwk' });
        if (key.asymmetricKeyDetails?.modulusLength < 2048) reject();
        return { kid: jwk.kid, key };
      });
      keys = next; expires = clock() + 3600000;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return async authorization => {
    if (typeof authorization !== 'string' || authorization.length > 16384) reject();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) reject();
    const [encodedHeader, encodedClaims, encodedSignature] = match[1].split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
    if (header?.alg !== 'RS256' || header.typ !== 'JWT' || !text(header.kid) || header.crit ||
        header.jku || header.x5u || header.b64 !== undefined) reject();
    const now = Math.floor(clock() / 1000);
    if (claims?.iss !== ISSUER || claims.aud !== config.audience || claims.token_use !== 'access' ||
        !identifier(claims.sub) || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
        claims.iat > now || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 3600 ||
        (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))) reject();
    if (clock() >= expires) await refresh();
    if (!keys.some(k => k.kid === header.kid) && clock() - unknownRefresh >= 5000) {
      unknownRefresh = clock(); await refresh();
    }
    const key = keys.find(k => k.kid === header.kid)?.key;
    if (!key || !verifySignature('RSA-SHA256', Buffer.from(encodedHeader + '.' + encodedClaims),
      key, Buffer.from(encodedSignature, 'base64url'))) reject();
    // No identity/session/role cache: the provider revalidates the token and
    // resolves current subject, WebID and role on every protected request.
    const profile = await boundedJson(fetcher, origin.origin + '/api/platform/auth/profile', {
      Accept: 'application/json', Authorization: authorization,
      'X-Peermesh-Tenant-Key': config.tenantKey, 'X-Peermesh-Tenant-ID': config.tenantId,
    });
    return identityHeaders(claims, profile, config);
  };
}

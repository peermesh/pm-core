import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createVerifier } from '../src/identity.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const TENANT_KEY = 'k'.repeat(40);
const CONFIG = {
  issuer: 'https://peers.social', origin: 'http://idp-check-social:3000', fixture: true,
  audience: 'tenant-a', tenantId: 'tenant-a', propertyId: 'property-a', tenantKey: TENANT_KEY,
};
const ACTOR = 'https://social.example.test/users/alice';

function token(claims = {}, { key = privateKey, kid = 'test-key' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: 'https://peers.social', aud: 'tenant-a', token_use: 'access', sub: 'did:example:alice',
    iat: now - 10, exp: now + 600, ...claims,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(header + '.' + body), key).toString('base64url');
  return `${header}.${body}.${signature}`;
}

function provider({ profileStatus = 200, profile } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/api/platform/auth/profile')) {
      if (profileStatus !== 200) return new Response('no', { status: profileStatus });
      return Response.json(profile || { did: 'did:example:alice', role: 'user', shared_public_profile: { subject: ACTOR } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

test('a valid token yields exactly the five X-Peermesh-* headers', async () => {
  const { fetcher, calls } = provider();
  const verify = createVerifier(CONFIG, { fetcher });
  const headers = await verify('Bearer ' + token());
  assert.deepEqual(headers, {
    'X-Peermesh-Auth-Subject': 'did:example:alice',
    'X-Peermesh-Actor-WebID': ACTOR,
    'X-Peermesh-Tenant-ID': 'tenant-a',
    'X-Peermesh-Property-ID': 'property-a',
    'X-Peermesh-Roles': 'user',
  });
  const profileCall = calls.find((call) => call.url.endsWith('/api/platform/auth/profile'));
  assert.equal(profileCall.headers['X-Peermesh-Tenant-Key'], TENANT_KEY);
});

test('a revoked session (profile 401) is refused', async () => {
  const verify = createVerifier(CONFIG, provider({ profileStatus: 401 }));
  await assert.rejects(verify('Bearer ' + token()), /unauthorized/);
});

test('the profile is consulted on every request (no identity cache)', async () => {
  const { fetcher, calls } = provider();
  const verify = createVerifier(CONFIG, { fetcher });
  await verify('Bearer ' + token());
  await verify('Bearer ' + token());
  assert.equal(calls.filter((call) => call.url.endsWith('/api/platform/auth/profile')).length, 2);
});

for (const [label, value] of [
  ['a token signed by another key', () => 'Bearer ' + token({}, { key: otherKey })],
  ['an expired token', () => 'Bearer ' + token({ iat: 1000, exp: 2000 })],
  ['a token for another audience', () => 'Bearer ' + token({ aud: 'tenant-b' })],
  ['a token from another issuer', () => 'Bearer ' + token({ iss: 'https://evil.example' })],
  ['a refresh token', () => 'Bearer ' + token({ token_use: 'refresh' })],
  ['a malformed bearer', () => 'Bearer not-a-jwt'],
  ['a missing header', () => undefined],
]) {
  test(`${label} is refused`, async () => {
    const verify = createVerifier(CONFIG, provider());
    await assert.rejects(verify(value()));
  });
}

test('a profile for another subject is refused', async () => {
  const verify = createVerifier(CONFIG, provider({
    profile: { did: 'did:example:mallory', role: 'user', shared_public_profile: { subject: ACTOR } },
  }));
  await assert.rejects(verify('Bearer ' + token()), /unauthorized/);
});

test('the fixture provider origin is accepted only in fixture mode', () => {
  assert.throws(() => createVerifier({ ...CONFIG, fixture: false }, provider()), /invalid provider origin/);
});

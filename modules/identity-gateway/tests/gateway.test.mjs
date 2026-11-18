import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/gateway.mjs';

const OPERATOR = 'http://authentik-server:9000';
const secret = (c) => c.repeat(40);
const modules = () => ({
  publisher: { host: 'publisher.example.test', secret: secret('p') },
  media: { host: 'media.example.test', secret: secret('m') },
  podcast: { host: 'podcast.example.test', secret: secret('c') },
});
const IDENTITY = {
  'X-Peermesh-Auth-Subject': 'did:example:alice',
  'X-Peermesh-Actor-WebID': 'https://social.example.test/users/alice',
  'X-Peermesh-Tenant-ID': 'tenant-a',
  'X-Peermesh-Property-ID': 'property-a',
  'X-Peermesh-Roles': 'user',
};
const forwarded = (host, uri, method = 'POST') => ({
  'x-forwarded-proto': 'https', 'x-forwarded-host': host, 'x-forwarded-method': method, 'x-forwarded-uri': uri,
  authorization: 'Bearer a.b.c',
});

function gatewayWith(config = modules(), { authorize, fetcher } = {}) {
  const calls = { authorize: 0, fetcher: [] };
  const gateway = createGateway({ modules: config, operatorOrigin: OPERATOR }, {
    authorize: authorize || (async () => { calls.authorize += 1; return { ...IDENTITY }; }),
    fetcher: fetcher || (async (url, init) => { calls.fetcher.push({ url, init }); return new Response(null, { status: 200 }); }),
  });
  return { gateway, calls };
}

async function refused(promise) {
  await assert.rejects(promise, (error) => error.status === 401);
}

test('configuration with three distinct modules is accepted', () => {
  assert.doesNotThrow(() => gatewayWith());
});

test('configuration refuses a missing podcast module', () => {
  const config = modules();
  delete config.podcast;
  assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
});

for (const [label, value] of [
  ['shorter than 32 characters', 'x'.repeat(31)],
  ['longer than 1024 characters', 'x'.repeat(1025)],
  ['containing a space', 'x'.repeat(20) + ' ' + 'x'.repeat(20)],
  ['non-ASCII', 'x'.repeat(40) + 'é'],
  ['unset', undefined],
]) {
  test(`configuration refuses a podcast secret ${label}`, () => {
    const config = modules();
    config.podcast.secret = value;
    assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
  });
}

test('configuration accepts podcast secrets of exactly 32 and 1024 printable characters', () => {
  for (const length of [32, 1024]) {
    const config = modules();
    config.podcast.secret = '!'.repeat(length);
    assert.doesNotThrow(() => gatewayWith(config));
  }
});

for (const other of ['media', 'publisher']) {
  test(`configuration refuses a podcast secret equal to the ${other} secret`, () => {
    const config = modules();
    config.podcast.secret = config[other].secret;
    assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
  });
  test(`configuration refuses a podcast host equal to the ${other} host`, () => {
    const config = modules();
    config.podcast.host = config[other].host;
    assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
  });
}

test('configuration refuses a media secret equal to the publisher secret (previously unchecked)', () => {
  const config = modules();
  config.media.secret = config.publisher.secret;
  assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
});

test('configuration refuses peers.social and malformed podcast hosts', () => {
  for (const host of ['peers.social', 'Podcast.example.test', 'podcast.example.test:443', '', undefined]) {
    const config = modules();
    config.podcast.host = host;
    assert.throws(() => gatewayWith(config), /invalid gateway configuration/);
  }
});

test('/verify/podcast returns the identity plus the podcast hop secret only', async () => {
  const config = modules();
  const { gateway, calls } = gatewayWith(config);
  const headers = await gateway('/verify/podcast', forwarded('podcast.example.test', '/api/podcast/shows'));
  assert.deepEqual(headers, { ...IDENTITY, 'X-Module-Secret': config.podcast.secret });
  assert.notEqual(headers['X-Module-Secret'], config.media.secret);
  assert.equal(calls.authorize, 1);
});

test('/verify/media still returns the media hop secret', async () => {
  const config = modules();
  const { gateway } = gatewayWith(config);
  const headers = await gateway('/verify/media', forwarded('media.example.test', '/api/media/upload'));
  assert.equal(headers['X-Module-Secret'], config.media.secret);
});

test('a forwarded host for another module is refused before authorization', async () => {
  const { gateway, calls } = gatewayWith();
  await refused(gateway('/verify/podcast', forwarded('media.example.test', '/api/podcast/shows')));
  await refused(gateway('/verify/media', forwarded('podcast.example.test', '/api/media/upload')));
  assert.equal(calls.authorize, 0);
});

for (const uri of [
  '/api/podcast/cron', '/api/podcast/cron/', '/api/webhooks/events', '/api/maintenance/cleanup',
  '/api/podcast%2Fcron', '/api/webhooks/events?x=1', '/api/maintenance/cleanup/extra',
]) {
  test(`/verify/podcast refuses the service-only path ${uri}`, async () => {
    const { gateway, calls } = gatewayWith();
    await refused(gateway('/verify/podcast', forwarded('podcast.example.test', uri)));
    assert.equal(calls.authorize, 0);
  });
}

test('/verify/podcast accepts ordinary podcast user paths', async () => {
  const { gateway } = gatewayWith();
  for (const uri of ['/api/podcast/shows/abc', '/api/podcast/episodes/abc/schedule', '/api/podcast/shows/abc/analytics?range=7d']) {
    await gateway('/verify/podcast', forwarded('podcast.example.test', uri));
  }
});

test('the media stream exclusion is unchanged', async () => {
  const { gateway } = gatewayWith();
  await refused(gateway('/verify/media', forwarded('media.example.test', '/api/media/abc/stream', 'GET')));
});

test('unknown routes and malformed forwarded fields are refused', async () => {
  const { gateway, calls } = gatewayWith();
  await refused(gateway('/verify/podcasts', forwarded('podcast.example.test', '/api/podcast/shows')));
  await refused(gateway('/verify/podcast/', forwarded('podcast.example.test', '/api/podcast/shows')));
  await refused(gateway('/verify/podcast', { ...forwarded('podcast.example.test', '/api/podcast/shows'), 'x-forwarded-proto': 'http' }));
  await refused(gateway('/verify/podcast', { ...forwarded('podcast.example.test', '/api/podcast/shows'), 'x-forwarded-method': 'post' }));
  await refused(gateway('/verify/podcast', forwarded('podcast.example.test', '//evil.example/api')));
  await refused(gateway('/verify/podcast', forwarded('podcast.example.test', 'api/podcast/shows')));
  assert.equal(calls.authorize, 0);
});

test('an authorization failure yields no hop secret', async () => {
  const { gateway } = gatewayWith(modules(), {
    authorize: async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); },
  });
  await refused(gateway('/verify/podcast', forwarded('podcast.example.test', '/api/podcast/shows')));
});

test('/verify/podcast/operator revalidates with Authentik and returns only the podcast hop secret', async () => {
  const config = modules();
  const { gateway, calls } = gatewayWith(config);
  const headers = await gateway('/verify/podcast/operator', forwarded('podcast.example.test', '/api/podcast/shows'));
  assert.deepEqual(headers, { 'X-Module-Secret': config.podcast.secret });
  assert.equal(calls.fetcher.length, 1);
  assert.equal(calls.fetcher[0].url, OPERATOR + '/outpost.goauthentik.io/auth/traefik');
  assert.equal(calls.authorize, 0);
});

// Unit tests: node --test modules/bus-gateway/tests/
// No Redis, no network beyond 127.0.0.1; the bus is a fake injected through busFactory.
import assert from 'node:assert/strict';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BODY_LIMIT_BYTES, buildRegistry, createGateway, GatewayConfigError, loadKeyFile, loadManifests, lookupKey, providerBusFactory } from '../lib/gateway.mjs';
import { BusGatewayError, createGatewayPublisher } from '../lib/client.mjs';

const GROUPS_KEY = 'test-groups-' + randomBytes(24).toString('hex');
const EVENTS_KEY = 'test-events-' + randomBytes(24).toString('hex');
const MANIFESTS = [
  { id: 'groups', events: ['groups.member.joined', 'groups.member.left'] },
  { id: 'pm-module-events', events: ['pm-module-events.event.created'] },
];

class FakeBus {
  constructor(source, behaviour) { this.source = source; this.behaviour = behaviour; this.published = []; this.connected = true; this.closed = false; }
  isConnected() { return this.connected; }
  async publish(topic, payload, options) {
    const b = this.behaviour;
    if (b.publishDelay) await b.publishDelay;
    if (b.publishError) throw b.publishError();
    if (b.publishHang) return new Promise(() => {});
    this.published.push({ topic, payload, options, source: this.source });
  }
  async close() { this.closed = true; this.connected = false; }
}

function harness() {
  const behaviour = {};
  const created = [];
  const logs = [];
  const busFactory = async source => {
    if (behaviour.connectError) throw new Error('connect refused');
    const bus = new FakeBus(source, behaviour);
    created.push(bus);
    return bus;
  };
  const registry = buildRegistry({ keys: { groups: GROUPS_KEY, 'pm-module-events': EVENTS_KEY }, manifests: MANIFESTS });
  const gateway = createGateway({ registry, busFactory, publishTimeoutMs: 200, connectTimeoutMs: 200, log: e => logs.push(e) });
  return { behaviour, created, logs, gateway };
}

let h;
let base;
async function post(body, { key = GROUPS_KEY, raw, headers = {} } = {}) {
  const response = await fetch(base + '/v1/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}), ...headers },
    body: raw ?? JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const joined = (extra = {}) => ({ topic: 'groups.member.joined', payload: { groupId: 'g-1', userId: 'u-1', role: 'member', method: 'direct' },
  idempotencyKey: '7c1c4a9e-0000-4000-8000-000000000001', metadata: { originalTimestamp: 1763000000000 }, ...extra });

describe('gateway HTTP', () => {
  beforeEach(async () => {
    if (h) await h.gateway.close();
    h = harness();
    const address = await h.gateway.listen(0, '127.0.0.1');
    base = 'http://127.0.0.1:' + address.port;
  });
  after(async () => { if (h) await h.gateway.close(); });

  test('202 publishes with source stamped from the key, at-least-once and the given idempotency key', async () => {
    const r = await post(joined());
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { status: 'accepted' });
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].source, 'groups');
    const [event] = h.created[0].published;
    assert.equal(event.topic, 'groups.member.joined');
    assert.deepEqual(event.options, { deliveryGuarantee: 'at-least-once', idempotencyKey: joined().idempotencyKey,
      metadata: { originalTimestamp: 1763000000000 } });
  });

  test('202 is sent only after the provider publish resolved', async () => {
    let release;
    h.behaviour.publishDelay = new Promise(resolve => { release = resolve; });
    let settled = false;
    const pending = post(joined()).then(r => { settled = true; return r; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(settled, false);
    release();
    assert.equal((await pending).status, 202);
  });

  test('401 for no header, wrong scheme and unknown key', async () => {
    assert.equal((await post(joined(), { key: null })).status, 401);
    assert.equal((await post(joined(), { key: null, headers: { authorization: 'Basic ' + GROUPS_KEY } })).status, 401);
    const wrong = await post(joined(), { key: 'x' + GROUPS_KEY.slice(1) });
    assert.deepEqual(wrong, { status: 401, body: { error: 'unauthorized' } });
    assert.equal(h.created.length, 0);
  });

  test('403 for an undeclared topic and for another module\'s topic', async () => {
    const undeclared = await post(joined({ topic: 'groups.group.deleted' }));
    assert.deepEqual(undeclared, { status: 403, body: { error: 'topic_not_allowed' } });
    const crossModule = await post(joined(), { key: EVENTS_KEY });
    assert.deepEqual(crossModule, { status: 403, body: { error: 'topic_not_allowed' } });
    const eventsOther = await post(joined({ topic: 'pm-module-events.event.created' }));
    assert.equal(eventsOther.status, 403);
    assert.equal(h.created.length, 0);
  });

  test('400 for malformed requests', async () => {
    const cases = [
      [{ raw: '{not json' }, 'invalid_json'],
      [{ body: [] }, 'body_not_object'],
      [{ body: { ...joined(), extra: 1 } }, 'unknown_field'],
      [{ body: joined({ topic: 'Groups member' }) }, 'invalid_topic'],
      [{ body: joined({ payload: 'text' }) }, 'invalid_payload'],
      [{ body: joined({ idempotencyKey: '' }) }, 'invalid_idempotency_key'],
      [{ body: joined({ idempotencyKey: undefined }) }, 'invalid_idempotency_key'],
      [{ body: joined({ metadata: [] }) }, 'invalid_metadata'],
      [{ body: joined({ metadata: { idempotencyKey: 'other' } }) }, 'reserved_metadata'],
      [{ body: joined({ metadata: { source: 'chat' } }) }, 'reserved_metadata'],
    ];
    for (const [input, reason] of cases) {
      const r = await post(input.body, { raw: input.raw });
      assert.deepEqual(r, { status: 400, body: { error: reason } }, reason);
    }
    assert.equal(h.created.length, 0);
  });

  test('400 for a body over 64 KiB; a body at the limit is read', async () => {
    const filler = 'a'.repeat(BODY_LIMIT_BYTES);
    const over = await post(joined({ payload: { filler } }));
    assert.deepEqual(over, { status: 400, body: { error: 'body_too_large' } });
    const base = JSON.stringify(joined({ payload: { filler: '' } }));
    const exact = joined({ payload: { filler: 'a'.repeat(BODY_LIMIT_BYTES - Buffer.byteLength(base)) } });
    assert.equal(Buffer.byteLength(JSON.stringify(exact)), BODY_LIMIT_BYTES);
    assert.equal((await post(exact)).status, 202);
  });

  test('400 when the provider rejects the event (TypeError), without discarding the bus', async () => {
    h.behaviour.publishError = () => new TypeError('Unsupported exact topic');
    assert.deepEqual(await post(joined()), { status: 400, body: { error: 'provider_rejected' } });
    assert.equal(h.created[0].closed, false);
  });

  test('503 when the bus cannot connect, then recovers', async () => {
    h.behaviour.connectError = true;
    assert.deepEqual(await post(joined()), { status: 503, body: { error: 'bus_unavailable' } });
    h.behaviour.connectError = false;
    assert.equal((await post(joined())).status, 202);
  });

  test('503 on a publish transport error discards the bus; the next request reconnects', async () => {
    h.behaviour.publishError = () => new Error('Socket closed unexpectedly');
    assert.deepEqual(await post(joined()), { status: 503, body: { error: 'bus_unavailable' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.created[0].closed, true);
    h.behaviour.publishError = undefined;
    assert.equal((await post(joined())).status, 202);
    assert.equal(h.created.length, 2);
  });

  test('503 when publish does not settle in time', async () => {
    h.behaviour.publishHang = true;
    assert.deepEqual(await post(joined()), { status: 503, body: { error: 'bus_timeout' } });
  });

  test('a disconnected cached bus is replaced before publishing', async () => {
    assert.equal((await post(joined())).status, 202);
    h.created[0].connected = false;
    assert.equal((await post(joined())).status, 202);
    assert.equal(h.created.length, 2);
    assert.equal(h.created[1].published.length, 1);
  });

  test('healthz, metrics counters, 404 and 405', async () => {
    await post(joined());
    await post(joined({ topic: 'groups.group.deleted' }));
    await post(joined(), { key: null });
    h.behaviour.publishError = () => new Error('down');
    await post(joined());
    const health = await fetch(base + '/healthz');
    assert.deepEqual([health.status, await health.json()], [200, { status: 'ok' }]);
    const metrics = await (await fetch(base + '/metrics')).json();
    assert.deepEqual(metrics.byStatus, { 202: 1, 403: 1, 401: 1, 503: 1 });
    assert.deepEqual(metrics.byModuleTopic['groups|groups.member.joined'], { accepted: 1, refused: 0, busErrors: 1 });
    assert.deepEqual(metrics.byModuleTopic['groups|(undeclared)'], { accepted: 0, refused: 1, busErrors: 0 });
    assert.equal((await fetch(base + '/nope')).status, 404);
    assert.equal((await fetch(base + '/v1/publish')).status, 405);
  });

  test('logs never contain keys or payload values', async () => {
    await post(joined());
    await post(joined(), { key: 'wrong-' + GROUPS_KEY });
    await post(joined({ topic: 'groups.secret.topic-name' }));
    const text = JSON.stringify(h.logs);
    assert.ok(h.logs.length >= 3);
    for (const secret of [GROUPS_KEY, EVENTS_KEY, 'g-1', 'u-1', '7c1c4a9e', 'originalTimestamp', 'secret.topic-name']) {
      assert.equal(text.includes(secret), false, secret);
    }
  });
});

describe('key lookup and registry', () => {
  const registry = buildRegistry({ keys: { groups: GROUPS_KEY, 'pm-module-events': EVENTS_KEY }, manifests: MANIFESTS });

  test('every entry is compared with equal-length digests, whatever the token', () => {
    for (const token of [GROUPS_KEY, EVENTS_KEY, 'short', 'x'.repeat(500)]) {
      const calls = [];
      const result = lookupKey(registry, token, (a, b) => { calls.push([a.length, b.length]); return timingSafeEqual(a, b); });
      assert.equal(calls.length, registry.length);
      assert.ok(calls.every(([a, b]) => a === 32 && b === 32));
      assert.equal(result?.module ?? null, token === GROUPS_KEY ? 'groups' : token === EVENTS_KEY ? 'pm-module-events' : null);
    }
  });

  test('raw keys are not kept in the registry', () => {
    const dump = JSON.stringify(registry.map(e => ({ ...e, topics: [...e.topics], digest: e.digest.toString('hex') })));
    assert.equal(dump.includes(GROUPS_KEY), false);
  });

  test('startup refuses unsafe configuration', () => {
    const bad = [
      [{ groups: 'short' }, MANIFESTS],
      [{ groups: GROUPS_KEY, 'pm-module-events': GROUPS_KEY }, MANIFESTS],
      [{ chat: GROUPS_KEY }, MANIFESTS],
      [{ groups: GROUPS_KEY }, [{ id: 'groups', events: ['chat.message.created'] }]],
      [{}, MANIFESTS],
    ];
    for (const [keys, manifests] of bad) assert.throws(() => buildRegistry({ keys, manifests }), GatewayConfigError);
  });

  test('key file and manifests load from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bus-gateway-test-'));
    try {
      writeFileSync(join(dir, 'keys.json'), JSON.stringify({ groups: GROUPS_KEY }));
      writeFileSync(join(dir, 'groups.json'), JSON.stringify({ id: 'groups', provides: { events: ['groups.member.joined'] } }));
      writeFileSync(join(dir, 'broken.json'), '{');
      const reg = buildRegistry({ keys: loadKeyFile(join(dir, 'keys.json')), manifests: loadManifests([join(dir, 'groups.json')]) });
      assert.deepEqual([...reg[0].topics], ['groups.member.joined']);
      assert.throws(() => loadKeyFile(join(dir, 'broken.json')), err => err instanceof GatewayConfigError && !err.message.includes(GROUPS_KEY));
      assert.throws(() => loadManifests([join(dir, 'missing.json')]), GatewayConfigError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('client status mapping', () => {
  let stub;
  let url;
  let next;
  before(async () => {
    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        stub.last = { auth: req.headers.authorization, body: JSON.parse(raw) };
        if (next === 'hang') return;
        res.writeHead(next.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(next.body));
      });
    });
    await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + stub.address().port;
  });
  after(async () => { stub.closeAllConnections(); await new Promise(resolve => stub.close(resolve)); });

  test('202 resolves and sends the drain call shape', async () => {
    next = { status: 202, body: { status: 'accepted' } };
    const client = createGatewayPublisher({ url, key: GROUPS_KEY });
    assert.equal(await client.publish('groups.member.joined', { a: 1 }, { idempotencyKey: 'k1', metadata: { originalTimestamp: 5 } }), undefined);
    assert.equal(stub.last.auth, 'Bearer ' + GROUPS_KEY);
    assert.deepEqual(stub.last.body, { topic: 'groups.member.joined', payload: { a: 1 }, idempotencyKey: 'k1', metadata: { originalTimestamp: 5 } });
  });

  for (const [status, code, retryable] of [[400, 'bad_request', false], [401, 'unauthorized', false], [403, 'forbidden', false],
    [503, 'unavailable', true], [500, 'unexpected_status', true]]) {
    test(status + ' throws BusGatewayError ' + code, async () => {
      next = { status, body: { error: 'reason-' + status } };
      const client = createGatewayPublisher({ url, key: GROUPS_KEY });
      await assert.rejects(client.publish('groups.member.joined', {}, { idempotencyKey: 'k' }), err => {
        assert.ok(err instanceof BusGatewayError);
        assert.deepEqual([err.code, err.status, err.retryable, err.reason], [code, status, retryable, 'reason-' + status]);
        assert.equal(err.message.includes(GROUPS_KEY), false);
        return true;
      });
    });
  }

  test('timeout and transport failures are retryable typed errors', async () => {
    next = 'hang';
    const slow = createGatewayPublisher({ url, key: GROUPS_KEY, timeoutMs: 100 });
    await assert.rejects(slow.publish('groups.member.joined', {}, { idempotencyKey: 'k' }),
      err => err instanceof BusGatewayError && err.code === 'timeout' && err.retryable && err.status === null);
    const closed = createServer();
    await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
    const deadPort = closed.address().port;
    await new Promise(resolve => closed.close(resolve));
    const dead = createGatewayPublisher({ url: 'http://127.0.0.1:' + deadPort, key: GROUPS_KEY });
    await assert.rejects(dead.publish('groups.member.joined', {}, { idempotencyKey: 'k' }),
      err => err instanceof BusGatewayError && err.code === 'transport' && err.retryable);
  });

  test('client refuses a URL with credentials and an empty key', () => {
    assert.throws(() => createGatewayPublisher({ url: 'http://u:p@127.0.0.1:1', key: GROUPS_KEY }), TypeError);
    assert.throws(() => createGatewayPublisher({ url, key: '' }), TypeError);
  });
});

describe('client against the real gateway', () => {
  test('maps 202, 401, 403, 400 and 503 end to end over loopback', async () => {
    const local = harness();
    const address = await local.gateway.listen(0, '127.0.0.1');
    const gw = 'http://127.0.0.1:' + address.port;
    try {
      const groups = createGatewayPublisher({ url: gw, key: GROUPS_KEY });
      await groups.publish('groups.member.joined', { groupId: 'g' }, { idempotencyKey: 'k-1', metadata: { originalTimestamp: 1 } });
      assert.equal(local.created[0].published[0].options.idempotencyKey, 'k-1');
      const events = createGatewayPublisher({ url: gw, key: EVENTS_KEY });
      await assert.rejects(events.publish('groups.member.joined', {}, { idempotencyKey: 'k' }), { code: 'forbidden', reason: 'topic_not_allowed' });
      const stranger = createGatewayPublisher({ url: gw, key: 'z'.repeat(40) });
      await assert.rejects(stranger.publish('groups.member.joined', {}, { idempotencyKey: 'k' }), { code: 'unauthorized' });
      await assert.rejects(groups.publish('groups.member.joined', {}, {}), { code: 'bad_request', reason: 'invalid_idempotency_key' });
      local.behaviour.publishError = () => new Error('down');
      await assert.rejects(groups.publish('groups.member.joined', {}, { idempotencyKey: 'k' }), { code: 'unavailable', retryable: true });
    } finally { await local.gateway.close(); }
  });
});

describe('provider bus factory', () => {
  test('hands passwordFile and username to the provider and never reads the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bus-gateway-factory-'));
    try {
      const fake = join(dir, 'fake-provider.mjs');
      writeFileSync(fake, 'export const seen = [];\nexport class RedisStreamsEventBus {\n' +
        '  async connect(config) { seen.push(config); }\n  async close() {}\n}\n');
      const providerUrl = pathToFileURL(fake).href;
      const passwordFile = join(dir, 'does-not-exist');
      const factory = providerBusFactory({ providerUrl, redisUrl: 'redis://127.0.0.1:1', passwordFile, username: 'gateway' });
      await factory('groups');
      const plain = providerBusFactory({ providerUrl, redisUrl: 'redis://127.0.0.1:1' });
      await plain('groups');
      const { seen } = await import(providerUrl);
      assert.equal(seen[0].passwordFile, passwordFile);
      assert.equal(seen[0].username, 'gateway');
      assert.equal(seen[0].source, 'groups');
      assert.equal('passwordFile' in seen[1], false);
      assert.equal('username' in seen[1], false);
      assert.throws(() => providerBusFactory({ providerUrl, redisUrl: 'redis://127.0.0.1:1', username: 'gateway' }), GatewayConfigError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

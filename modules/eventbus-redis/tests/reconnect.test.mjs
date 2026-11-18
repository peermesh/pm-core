// Subscription reconnect against an isolated Redis. A local TCP relay sits between the provider and
// Redis so the test can cut every connection and refuse new ones, like a broker restart.
// Run: REDIS_URL=redis://127.0.0.1:<port> node --test modules/eventbus-redis/tests/reconnect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { RedisStreamsEventBus } from '../lib/eventbus-redis.mjs';

const URL_ENV = process.env.REDIS_URL;
const skip = URL_ENV ? false : 'REDIS_URL not set (needs an isolated Redis)';
const T = 'groups.member.joined', DLQ = 'groups.events.dead-letter';

function relay(target) {
  const { hostname, port } = new URL(target);
  const sockets = new Set();
  let refusing = false;
  const server = createServer(client => {
    if (refusing) { client.destroy(); return; }
    const upstream = connect(Number(port || 6379), hostname);
    for (const s of [client, upstream]) { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); }
    client.pipe(upstream); upstream.pipe(client);
    client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: 'redis://127.0.0.1:' + server.address().port,
    cut(refuse = true) { refusing = refuse; for (const s of sockets) s.destroy(); },
    restore() { refusing = false; },
    close: () => new Promise(done => { refusing = true; for (const s of sockets) s.destroy(); server.close(done); }),
  })));
}
async function until(fn, label, ms = 10000) {
  const deadline = Date.now() + ms;
  do { const value = await fn(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
async function observer() {
  const c = createClient({ url: URL_ENV, socket: { reconnectStrategy: false }, disableOfflineQueue: true });
  c.on('error', () => {}); await c.connect(); return c;
}
async function bus(url, prefix, source, overrides = {}) {
  const b = new RedisStreamsEventBus();
  await b.connect({ url, source, consumerGroup: source, streamPrefix: prefix, claimIdleMs: 300, maxDeliveryAttempts: 5, closeTimeoutMs: 1000, ...overrides });
  return b;
}
async function publish(prefix, payload) {
  const p = await bus(URL_ENV, prefix, 'groups', { consumerGroup: 'publisher' });
  try { await p.publish(T, payload, { idempotencyKey: 'k-' + payload.step }); } finally { await p.close(); }
}
const pending = (c, prefix, group = 'chat') => c.sendCommand(['XPENDING', prefix + ':stream:' + T, group, '-', '+', '100']);

test('same subscription reconnects, receives new events and redelivers an unacknowledged entry once more', { skip, timeout: 30000 }, async () => {
  const prefix = 'wo298rc' + randomBytes(4).toString('hex');
  const r = await relay(URL_ENV), c = await observer();
  const b = await bus(r.url, prefix, 'chat');
  const calls = [];
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  const sub = b.subscribe(T, async event => {
    calls.push(event.payload.step);
    if (event.payload.step === 'x' && calls.filter(s => s === 'x').length === 1) { entered = true; await gate; }
  }, { fromBeginning: true, deadLetterTopic: DLQ });
  try {
    await sub.ready;
    const id = sub.id;
    await publish(prefix, { step: 'a' });
    await until(() => calls.includes('a'), 'a received');
    await publish(prefix, { step: 'x' });
    await until(() => entered, 'x handler entered');
    r.cut(true); // every connection dropped, new ones refused
    release(); // the handler finishes; its acknowledgment cannot reach Redis, so the loop sees the drop
    await until(() => sub.reconnecting, 'reconnecting');
    assert.equal(sub.error, undefined);
    assert.equal(sub.active, true);
    await delay(400);
    r.restore();
    await until(() => !sub.reconnecting && sub.reconnects >= 1, 'reconnected');
    await until(() => calls.filter(s => s === 'x').length === 2, 'x redelivered');
    await publish(prefix, { step: 'b' });
    await until(() => calls.includes('b'), 'b received on the same subscription');
    await until(async () => (await pending(c, prefix)).length === 0, 'all acknowledged');
    await delay(800); // past claimIdleMs again: no further redelivery
    assert.deepEqual(calls, ['a', 'x', 'x', 'b']);
    assert.equal(sub.id, id);
    assert.equal(sub.error, undefined);
    assert.equal(sub.active, true);
    assert.ok(sub.reconnects >= 1);
  } finally { release(); await b.close(); await r.close(); await c.disconnect(); }
  assert.equal(sub.error, undefined);
});

test('close() during a reconnect ends the loop within closeTimeoutMs and reports the last cause', { skip, timeout: 15000 }, async () => {
  const prefix = 'wo298rc' + randomBytes(4).toString('hex');
  const r = await relay(URL_ENV);
  const b = await bus(r.url, prefix, 'chat', { closeTimeoutMs: 300 });
  const sub = b.subscribe(T, () => {}, { fromBeginning: true, deadLetterTopic: DLQ });
  try {
    await sub.ready;
    r.cut(true);
    await until(() => sub.reconnecting, 'reconnecting');
    await delay(700); // a few failed attempts
    const started = Date.now();
    await b.close();
    assert.ok(Date.now() - started < 300, 'close took ' + (Date.now() - started) + ' ms');
    await sub.closed;
    assert.equal(sub.active, false);
    assert.equal(sub.reconnecting, false);
    assert.ok(sub.error instanceof Error);
  } finally { await r.close(); }
});

test('a non-retryable reply during rejoin ends the loop with that error', { skip, timeout: 15000 }, async () => {
  const prefix = 'wo298rc' + randomBytes(4).toString('hex');
  const r = await relay(URL_ENV), c = await observer();
  const b = await bus(r.url, prefix, 'chat');
  const sub = b.subscribe(T, () => {}, { fromBeginning: true, deadLetterTopic: DLQ });
  try {
    await sub.ready;
    r.cut(true);
    await until(() => sub.reconnecting, 'reconnecting');
    // Another policy now owns the group contract, so the rejoin must fail instead of changing it.
    await c.sendCommand(['SET', prefix + ':stream:' + T + ':contract:chat', '{"changed":true}']);
    r.restore();
    await sub.closed;
    assert.match(sub.error.message, /GROUP_CONTRACT_CONFLICT/);
    assert.equal(sub.active, false);
    assert.equal(sub.reconnecting, false);
  } finally { await b.close(); await r.close(); await c.disconnect(); }
});

// Unit layer for the topic pattern, the dead-letter topic rule and the envelope checks. Needs no
// Redis: `redis` resolves to tests/fixtures/redis-stub.mjs, which opens no socket.
// Run: node --test modules/eventbus-redis/tests/topic-pattern.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

register('./fixtures/redis-stub-hooks.mjs', import.meta.url);
const { RedisStreamsEventBus } = await import('../lib/eventbus-redis.mjs');
const stub = globalThis.__eventbusRedisStub;
assert.ok(stub, 'redis stub must be loaded instead of the real client');

const GROUPS_TOPICS = ['groups.group.created', 'groups.group.updated', 'groups.member.joined',
  'groups.member.left', 'groups.member.approved'];
// Mirrors pm-module-events/src/lib/events/event-names.ts and module/module.json provides.events.
const EVENTS_TOPICS = ['pm-module-events.event.created', 'pm-module-events.event.updated',
  'pm-module-events.event.submitted', 'pm-module-events.event.withdrawn', 'pm-module-events.event.reviewed',
  'pm-module-events.event.approved', 'pm-module-events.event.rejected',
  'pm-module-events.event.revision-requested', 'pm-module-events.event.published',
  'pm-module-events.event.cancelled', 'pm-module-events.rsvp.created', 'pm-module-events.rsvp.updated',
  'pm-module-events.attendance.checked-in'];
const PREFIX = 'unit', E = EVENTS_TOPICS[0], G = 'groups.member.joined';
const EVENTS_DLQ = 'pm-module-events.dead-letter.notifications', GROUPS_DLQ = 'groups.events.dead-letter';
const MAX = 128;
// A topic of exactly n characters in the Events namespace.
const sized = n => { const head = 'pm-module-events.event.'; return head + 'x'.repeat(n - head.length); };
// Every malformed topic the pattern must refuse, by reason.
const MALFORMED = {
  uppercase: ['pm-module-events.Event.created', 'PM-MODULE-EVENTS.event.created', 'groups.Member.joined'],
  emptySegment: ['pm-module-events..created', 'pm-module-events.event.', '.event.created', 'pm-module-events.event..x'],
  twoSegments: ['pm-module-events.event', 'groups.member'],
  oneOrNone: ['pm-module-events', ''],
  tooLong: [sized(MAX + 1), sized(300)],
  unknownCharacters: ['pm-module-events.event.revision_requested', 'pm-module-events.event.*', 'pm-module-events.event.>',
    'pm-module-events.event.created ', 'pm-module-events.event/created.x', 'pm-module-events:x.event.created',
    'pm-module-events.évent.created', 'pm-module-events.event.created\n'],
};

// Scripted broker: one queued entry per stream, delivered once by XAUTOCLAIM.
const queued = new Map(), owners = new Map(), completes = [];
stub.reply = async args => {
  const [cmd] = args;
  if (cmd === 'PING') return 'PONG';
  if (cmd === 'XADD') return '1-0';
  if (cmd === 'EVAL' && args[1].includes("'XGROUP'")) return 1;
  if (cmd === 'EVAL' && args[1].includes("'XACK'")) { completes.push(args); return 1; }
  if (cmd === 'XAUTOCLAIM') {
    const entry = queued.get(args[1]);
    if (!entry) return ['0-0', []];
    queued.delete(args[1]); owners.set(entry[0], args[3]);
    return ['0-0', [entry]];
  }
  if (cmd === 'XREADGROUP') { await delay(5); return null; }
  if (cmd === 'XPENDING') return [[args[3], owners.get(args[3]), 0, 1]];
  throw new Error('Unscripted command ' + cmd);
};

async function bus(source) {
  const b = new RedisStreamsEventBus();
  await b.connect({url: 'redis://fixture-redis:6379', source, streamPrefix: PREFIX, consumerGroup: 'unit',
    claimIdleMs: 100, maxDeliveryAttempts: 1, closeTimeoutMs: 1000});
  return b;
}
async function using(source, fn) {
  const b = await bus(source);
  try { return await fn(b); } finally { await b.close(); }
}
function lastXadd() {
  const calls = stub.clients.flatMap(c => c.calls).filter(a => a[0] === 'XADD');
  return calls[calls.length - 1];
}
function stored(topic, extra = {}) {
  return {id: randomUUID(), timestamp: Date.now(), source: topic.split('.')[0], type: topic, specversion: '1.0',
    datacontenttype: 'application/json', payload: {eventId: 'synthetic'}, correlationId: randomUUID(),
    metadata: {idempotencyKey: 'transition-1'}, ...extra};
}
// Feed one stored envelope through the consume path; return handler calls and the completion.
async function consume(topic, envelope, deadLetterTopic) {
  const b = await bus('notifications'), seen = [], before = completes.length;
  const stream = PREFIX + ':stream:' + topic, id = '1700000000000-' + completes.length;
  queued.set(stream, [id, ['event', JSON.stringify(envelope)]]);
  const sub = b.subscribe(topic, event => { seen.push(event); }, {deadLetterTopic, fromBeginning: true});
  await sub.ready;
  const deadline = Date.now() + 2000;
  while (completes.length === before && Date.now() < deadline) await delay(5);
  b.unsubscribe(sub); await sub.closed; await b.close();
  assert.equal(completes.length, before + 1, 'one completion for ' + topic);
  const done = completes[completes.length - 1];
  return {seen, sourceStream: done[3], dlqStream: done[4], record: done[9] ? JSON.parse(done[9]) : null};
}
function subscribeRefused(b, topic, deadLetterTopic, pattern) {
  assert.throws(() => b.subscribe(topic, () => {}, {deadLetterTopic}), pattern, JSON.stringify([topic, deadLetterTopic]));
}

test('valid: all thirteen Events topics publish with source pm-module-events', () => using('pm-module-events', async b => {
  for (const topic of EVENTS_TOPICS) {
    const correlationId = randomUUID();
    assert.equal(await b.publish(topic, {eventId: 'synthetic'}, {correlationId, idempotencyKey: 'k-' + topic}), undefined, topic);
    const [, stream, , field, raw] = lastXadd();
    assert.equal(stream, PREFIX + ':stream:' + topic);
    assert.equal(field, 'event');
    const event = JSON.parse(raw);
    assert.equal(event.type, topic); assert.equal(event.source, 'pm-module-events');
    assert.equal(event.correlationId, correlationId); assert.equal(event.metadata.idempotencyKey, 'k-' + topic);
  }
}));

test('valid: all five Groups topics publish with source groups', () => using('groups', async b => {
  for (const topic of GROUPS_TOPICS) {
    assert.equal(await b.publish(topic, {memberId: 'synthetic'}, {idempotencyKey: 'k'}), undefined, topic);
    assert.equal(JSON.parse(lastXadd()[4]).type, topic);
  }
}));

test('valid: subscribe accepts Events and Groups topics with a dead-letter topic in their own namespace', () => using('notifications', async b => {
  const subs = [
    ...EVENTS_TOPICS.map(t => b.subscribe(t, () => {}, {deadLetterTopic: EVENTS_DLQ})),
    ...GROUPS_TOPICS.map(t => b.subscribe(t, () => {}, {deadLetterTopic: GROUPS_DLQ})),
    b.subscribe(G, () => {}, {deadLetterTopic: 'groups.dlq.chat.member.joined'}), // Chat's DLQ naming
  ];
  await Promise.all(subs.map(s => s.ready));
  assert.ok(subs.every(s => s.active));
}));

test('valid: a topic of exactly the maximum length is accepted', () => using('pm-module-events', async b => {
  const topic = sized(MAX);
  assert.equal(topic.length, MAX);
  assert.equal(await b.publish(topic, {}), undefined);
}));

test('refused: wrong source prefix at publish', async () => {
  await using('pm-module-events', async b => {
    await assert.rejects(b.publish(G, {}), /Source\/topic mismatch/);
    await assert.rejects(b.publish('pm-module-eventsx.event.created', {}), /Source\/topic mismatch/);
  });
  await using('groups', async b => assert.rejects(b.publish(E, {}), /Source\/topic mismatch/));
});

test('refused: a stored envelope whose source is not the topic prefix goes to the dead-letter topic', async () => {
  const result = await consume(E, stored(E, {source: 'groups'}), EVENTS_DLQ);
  assert.equal(result.seen.length, 0);
  assert.equal(result.dlqStream, PREFIX + ':stream:' + EVENTS_DLQ);
  assert.equal(result.record.cause, 'Malformed event envelope');
});

for (const [reason, topics] of Object.entries(MALFORMED)) {
  test('refused: ' + reason + ' topics at publish and subscribe', () => using('pm-module-events', async b => {
    for (const topic of topics) {
      await assert.rejects(b.publish(topic, {}), /Unsupported exact topic/, JSON.stringify(topic));
      subscribeRefused(b, topic, EVENTS_DLQ, /Unsupported exact topic/);
    }
  }));
}

test('refused: non-string topics', () => using('pm-module-events', async b => {
  for (const topic of [undefined, null, 42, ['pm-module-events', 'event', 'created'], {}]) {
    await assert.rejects(b.publish(topic, {}), /Unsupported exact topic/);
    subscribeRefused(b, topic, EVENTS_DLQ, /Unsupported exact topic/);
  }
}));

test('dead-letter: subscribe applies the topic rule and the topic-source namespace', () => using('notifications', async b => {
  const bad = [
    ...Object.values(MALFORMED).flat(),        // includes a dead-letter topic one character too long
    GROUPS_DLQ,                               // other namespace than the Events topic
    'pm-module-notifications.dead-letter.events', // the subscriber's namespace is not the topic's
    E,                                         // must differ from the topic it serves
  ];
  for (const deadLetterTopic of bad) subscribeRefused(b, E, deadLetterTopic, /dead-letter topic/);
  subscribeRefused(b, G, EVENTS_DLQ, /dead-letter topic/);
  subscribeRefused(b, G, G, /dead-letter topic/);
  subscribeRefused(b, E, undefined, /dead-letter topic/);
}));

test('dead-letter: publish metadata follows the same rule', () => using('pm-module-events', async b => {
  assert.equal(await b.publish(E, {}, {deadLetterTopic: EVENTS_DLQ}), undefined);
  assert.equal(JSON.parse(lastXadd()[4]).metadata.deadLetterTopic, EVENTS_DLQ);
  for (const deadLetterTopic of [GROUPS_DLQ, E, 'pm-module-events.Dead.letter', 'pm-module-events.dead', sized(MAX + 1)]) {
    await assert.rejects(b.publish(E, {}, {deadLetterTopic}), /dead-letter topic/, deadLetterTopic);
    await assert.rejects(b.publish(E, {}, {metadata: {deadLetterTopic}}), /dead-letter topic/, deadLetterTopic);
  }
}));

test('dead-letter: a stored envelope naming a dead-letter topic in another namespace is refused', async () => {
  const result = await consume(E, stored(E, {metadata: {idempotencyKey: 'k', deadLetterTopic: GROUPS_DLQ}}), EVENTS_DLQ);
  assert.equal(result.seen.length, 0);
  assert.equal(result.dlqStream, PREFIX + ':stream:' + EVENTS_DLQ);
  assert.match(result.record.cause, /dead-letter topic/);
});

test('envelope: a valid stored Events envelope reaches the handler and is acknowledged', async () => {
  const envelope = stored(EVENTS_TOPICS[12], {metadata: {idempotencyKey: 'k', deadLetterTopic: EVENTS_DLQ}});
  const result = await consume(EVENTS_TOPICS[12], envelope, EVENTS_DLQ);
  assert.equal(result.seen.length, 1); assert.deepEqual(result.seen[0], envelope);
  assert.equal(result.record, null, 'plain acknowledgment, no dead-letter record');
});

test('envelope: the other checks are unchanged (UUID ids, idempotency key)', () => using('pm-module-events', async b => {
  await assert.rejects(b.publish(E, {}, {correlationId: 'evt-' + randomUUID()}), /Invalid correlationId/);
  await assert.rejects(b.publish(E, {}, {causationId: 'evt-' + randomUUID()}), /Invalid causationId/);
  await assert.rejects(b.publish(E, {}, {idempotencyKey: ''}), /Invalid idempotencyKey/);
  await assert.rejects(b.publish(E, {when: new Date()}), /must be an object/);
}));

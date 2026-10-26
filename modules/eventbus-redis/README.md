# Redis Event Bus Provider

The existing module manifest registers `eventbus-redis` as an eventbus provider.
The callable ESM entrypoint is `lib/eventbus-redis.mjs`, exporting
`RedisStreamsEventBus`; package version 0.1.0 uses locked `redis` 4.7.0.
Importing it does not install a module, activate the Core Redis profile, or wire
Groups/Chat lifecycle hooks. Those are separate integration steps.

```js
import { RedisStreamsEventBus } from './lib/eventbus-redis.mjs';
const bus = new RedisStreamsEventBus();
await bus.connect({
  url: 'redis://fixture-redis:6379', source: 'chat',
  streamPrefix: 'membership', consumerGroup: 'chat',
  claimIdleMs: 30000, maxDeliveryAttempts: 5, closeTimeoutMs: 2000,
});
const subscription = bus.subscribe('groups.member.joined', async event => {
  await applyMembershipIdempotently(event);
}, {fromBeginning: true, deadLetterTopic: 'groups.events.dead-letter'});
await subscription.ready;
// During shutdown:
bus.unsubscribe(subscription);
await bus.close();
```

## Offered subset

This candidate implements exact subscriptions for the Groups topics declared by
Chat: `groups.group.created`, `groups.group.updated`, `groups.member.joined`,
`groups.member.left`, and `groups.member.approved`. Wildcards, other topics,
manual acknowledgment, filters, excludeSelf, financial/compliance-critical
guarantees and unknown options are rejected. It is not full Foundation EventBus
or Payments conformance; older manifest capability text is broader than this
callable subset. No manual-ack API is invented.

`connect` requires an explicit credential-free Redis URL, source module, stream
prefix, consumer group and positive claim idle duration. It performs no installed
host discovery. Connections do not reconnect automatically: after a transport
failure, create a new instance with the same explicit durable group contract.
`isConnected` reports the command connection's readiness, not consumer effects.
The retry limit defaults to the provider metadata's five deliveries; it can be
explicitly configured from 1 to 100. Claim and close bounds are 1–60000 ms.

`subscribe` returns synchronously with `id`, `topic`, `active`, `ready`, `closed`
and `error`. Await `ready` before treating the subscriber as registered. Failure
rejects readiness and sets inactive. The explicitly configured group belongs to
the source module. A different source, retry limit, claim duration, DLQ or initial
history policy for an existing group/topic contract fails instead of silently
changing it. An existing group without this adapter's contract also fails.
`fromBeginning` defaults to false for new groups; true starts at the beginning.
Reopening a group never resets its cursor or deletes its pending entries.

## Delivery, acknowledgment and recovery

Each exact topic has a stream at `<prefix>:stream:<topic>`. Distinct module
consumer groups have independent copies. Within a group, consumers compete.
`XREADGROUP` adds a pending entry; the adapter awaits the handler before `XACK`.
Throwing or rejecting retains the entry. `XAUTOCLAIM` recovers sufficiently idle
entries after handler failure or consumer loss. Redis delivery counts include
claims, so consumer crashes can consume attempts without a completed handler.
Retries preserve the stored event ID, payload and idempotency key.

Exhaustion atomically adds one `record` field to the configured DLQ stream and
acknowledges the original entry. The JSON record contains the decoded event,
original serialized envelope, source stream/ID, group, attempt count and cause.
The operation checks current pending ownership and delivery generation; stale
handlers cannot acknowledge a newer claim. A malformed externally inserted
envelope is never passed to the handler and follows bounded failure/DLQ handling.
Neither source entries nor other groups' pending copies are trimmed or deleted.
No automatic retention, compaction or DLQ replay policy is supplied.

Choose claim idle duration above the expected handler duration. A slow or stuck
handler can overlap a recovery consumer and repeat external effects. Ownership
checks protect broker acknowledgment, not exactly-once application effects.
Handlers must implement persistent consumer deduplication; this package does not.

`unsubscribe` marks the subscription inactive immediately and prevents new
handler calls; an in-flight handler cannot be cancelled. It leaves pending work
recoverable. `close` marks all subscriptions stopped and waits for loops/in-flight
handlers up to `closeTimeoutMs`, then disconnects its clients. A timeout rejects
explicitly because a handler may still be running. `subscription.closed` signals
loop exit; inspect `subscription.error` for a background transport failure.

## Publishing and persistence

`publish` returns `Promise<void>` and creates a UUIDv4 ID, integer millisecond
timestamp, configured source, exact topic, JSON object payload, specification
version and JSON content type. Optional UUID correlation/causation IDs and JSON
metadata are supported. Source must match the topic's first segment. Unsupported
guarantees, malformed payloads and conflicting metadata are rejected.

`PublishOptions.idempotencyKey` carries the caller's stable transition identifier
unchanged. It is a consumer deduplication key, not producer duplicate suppression.
Repeated publishes have different event IDs, even with the same key. After a lost
write response, retry with the same stable key and deduplicate at the consumer.
A successful call means Redis accepted `XADD`; it does not prove fsync, replicated
durability or completed consumer effects. `waitForAck: true` is unsupported.

Disposable qualification uses the exact Core Redis image with AOF,
`appendfsync always` and `noeviction`, including process/broker restart checks.
This does not establish those settings or crash guarantees for an installed
profile. Groups/Chat delivery tier, final retry policy, complete consumer inventory
and persistent deduplication remain receiving-integration inputs. Payments'
financial requirements are not inherited.

## Groups/Chat receiving boundary

The receiving proposal uses source/module group `chat` and exact subscriptions
`groups.member.joined` and `groups.member.left`. Startup must await both readiness
promises and unwind only the handles it acquired if either fails. Close only a
caller-owned bus, settle in-flight work under the timeout contract, then close
owned application stores; do not close another caller's shared connection.

The current Chat bridge deduplicates `envelope.id`. That is compatible with the
same stored stream entry being redelivered, but not automatically with producer
retries: a new publish has a new UUID and timestamp even when
`metadata.idempotencyKey` is stable. Communications must bind persistent key
adaptation and Groups producer transition/outbox atomicity before claiming that
end-to-end contract. Groups' currently advertised `groups.group.joined/left`
names also require producer-owned alignment with Chat's canonical member topics.

A receiving callback may resolve for acknowledgment only after recognized input,
validated envelope/payload, admitted identity and room mapping, required effect,
and durable success. Existing HTTP200 or a returned handler promise alone does
not establish that: error-backed duplicates, missing mappings, silent no-ops,
swallowed effect errors and failed durable marks must remain failures. This
package neither repairs those consumer branches nor proves Matrix effects.

## Qualification

The bounded test command from a staged Core tree is:

```sh
node --test modules/eventbus-redis/tests/redis-streams.test.mjs
```

It requires an explicitly isolated Redis fixture, `REDIS_URL`, `PROOF_DIR`, and
`PROOF_GROUP`. Groups 2–4 run independently, with `2-boundary` covering strict
input types; groups 5 and 6 have before/after crash
phases (`5-before`, `6-before`, `5-after`, `6-after`). The harness kills both the
proof container and broker between phases, verifies new process identities and
retains the AOF directory. No default installed endpoint is selected. Actual
Groups/provider manifest registration is qualified separately with the canonical
Bash resolver and an inert Docker fallback; unresolved Groups postgres remains a
separate required dependency and prevents whole-module readiness.

API references: [node-redis 4.7.0](https://github.com/redis/node-redis/tree/redis%404.7.0),
[XREADGROUP](https://redis.io/docs/latest/commands/xreadgroup/),
[XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/), and
[atomic Lua execution](https://redis.io/docs/latest/develop/programmability/eval-intro/).

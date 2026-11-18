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
  passwordFile: '/run/secrets/redis_password', // optional; omit for a Redis without a password
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

This candidate implements exact subscriptions to module-scoped topics. A topic
is accepted when it matches one pattern: lowercase dot-separated segments of
`[a-z0-9-]`, at least three segments, no empty segment, and at most 128
characters. Its first segment is the publishing module's source: `publish`
requires it to equal the bus `source`, and every stored envelope must carry
`source` equal to it. Examples: the Groups topics declared by Chat
(`groups.member.joined`, `groups.member.left` and the other `groups.*` names)
and the thirteen Events topics (`pm-module-events.event.created` and so on).
The provider does not keep a list of topics. Which topics a module may publish
is decided by its manifest (`provides.events`), which the bus gateway enforces
per module key. The type definitions keep `MembershipTopic` (the five Groups
topics) and add `EventBusTopic`, a template-literal type that only requires
three dot-separated parts; the rest of the pattern is checked at runtime.

A dead-letter topic follows the same pattern, its first segment must be the
first segment of the topic it serves, and it must differ from that topic. Chat's
`groups.dlq.chat.member.joined` therefore stays valid for `groups.member.joined`,
and an Events subscriber can use `pm-module-events.dead-letter.<consumer>`.

Wildcards, malformed topics, manual acknowledgment, filters, excludeSelf,
financial/compliance-critical
guarantees and unknown options are rejected. It is not full Foundation EventBus
or Payments conformance; older manifest capability text is broader than this
callable subset. No manual-ack API is invented.

`connect` requires an explicit credential-free Redis URL, source module, stream
prefix, consumer group and positive claim idle duration. It performs no installed
host discovery. `connect` sends one `PING`, so a Redis that needs a password and
did not get one fails at connect with `Redis requires authentication: configure
passwordFile (NOAUTH)`, and a wrong password fails with `Redis authentication
failed ... (WRONGPASS)`. The publish (command) connection does not reconnect:
after a transport failure, create a new instance with the same explicit durable
group contract. Subscriptions do reconnect (see below). `isConnected` reports the
command connection's readiness, not consumer effects.

## Redis credentials

Credentials inside the URL are refused. For a Redis with `requirepass` (the Core
Redis profile), pass `passwordFile`: the path of a file that holds only the
password, such as the Core `redis_password` secret mounted at
`/run/secrets/redis_password`. Pass `username` as well only for a Redis ACL
user; without it the default user is used.

- The file is read once, at `connect`; one trailing newline (`\n` or `\r\n`) is
  removed. Every client of that instance (publish and subscriptions, including
  reconnects) uses the value read then. Rotating the password needs a new
  instance.
- The file is refused when it is missing, empty, larger than 4096 bytes, a
  symlink, not a regular file, or group- or world-readable (any `0o044` bit). Use
  mode `0600` or `0400`, owned by the user the process runs as.
- Errors name the path and the reason. The password is never logged and never
  put in an error message.
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

## Subscription reconnect

When the subscription loop loses its Redis connection (for example a Redis
restart), it does not end. It reconnects with exponential backoff (100 ms
doubling to a 5 s ceiling, each wait randomized between half and all of the
step), then rejoins its consumer group with the same contract and resumes as the
same consumer. The subscription object stays the same; it is not re-created.

- Retryable: connection errors (socket closed, refused, reset, timeout, client
  offline) and the broker replies `LOADING`, `NOGROUP`, `BUSY`, `MASTERDOWN` and
  `TRYAGAIN`. Every other reply (for example `WRONGPASS`, `NOPERM`, `WRONGTYPE`,
  `GROUP_CONTRACT_CONFLICT`, `UNMANAGED_GROUP`) ends the loop and sets `error`.
- If the group survived the restart, it keeps its cursor and pending entries.
  Entries delivered but not acknowledged before the drop stay pending and are
  reclaimed by `XAUTOCLAIM` once idle for `claimIdleMs`, which counts one more
  delivery under the same `maxDeliveryAttempts` and DLQ rules. Nothing beyond
  at-least-once redelivery is added.
- If Redis lost its data (no persistence), the group is recreated at the start
  of the stream (`0`), so entries written after the loss are not skipped.
- `subscription.reconnecting` is true while backing off and reconnecting;
  `subscription.reconnects` counts successful reconnects. `subscription.error`
  is set only when the loop has ended for good: a non-retryable error, or
  `unsubscribe`/`close` while still reconnecting (it then holds the last
  connection error). `close` interrupts the backoff and the pending connect, so
  it still ends within `closeTimeoutMs`.

## Unsubscribe and close

`unsubscribe` marks the subscription inactive immediately and prevents new
handler calls; an in-flight handler cannot be cancelled. It leaves pending work
recoverable. `close` marks all subscriptions stopped and waits for loops/in-flight
handlers up to `closeTimeoutMs`, then disconnects its clients. A timeout rejects
explicitly because a handler may still be running. `subscription.closed` signals
loop exit; inspect `subscription.error` for a terminal failure.

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

Two more test files:

```sh
node --test modules/eventbus-redis/tests/password-file.test.mjs   # no Redis needed
node --test modules/eventbus-redis/tests/topic-pattern.test.mjs   # no Redis, no redis package
REDIS_URL=redis://127.0.0.1:<port> node --test modules/eventbus-redis/tests/reconnect.test.mjs
```

`topic-pattern.test.mjs` checks the topic pattern, the dead-letter topic rule
and the envelope checks against an in-process stand-in for the `redis` package
(`tests/fixtures/redis-stub.mjs`, loaded by a resolve hook).

`password-file.test.mjs` checks the password file rules (missing, empty, group-
or world-readable, symlink, URL credentials, and that the value never appears in
errors or output). `reconnect.test.mjs` puts a local TCP relay between the
provider and an isolated Redis, cuts every connection, and checks that the same
subscription reconnects, receives new events and redelivers an unacknowledged
entry once more. It skips when `REDIS_URL` is not set.

`redis-streams.test.mjs` requires an explicitly isolated Redis fixture, `REDIS_URL`, `PROOF_DIR`, and
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

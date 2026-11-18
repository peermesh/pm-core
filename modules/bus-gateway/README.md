# Core Bus Gateway

Internal HTTP gateway for module event publishing (WO-PMSYS-20261110-298,
design C1-C6). The gateway alone holds the event bus connection. Each module
runs its own outbox drain and publishes through this gateway with its own key.
Module code never sees bus credentials, and the gateway never reads a module's
tables.

## API

`POST /v1/publish` with `Authorization: Bearer <module key>` and a JSON body:

```json
{"topic": "groups.member.joined", "payload": {}, "idempotencyKey": "<stable id>", "metadata": {}}
```

- `202 {"status":"accepted"}`: sent only after the provider's `publish`
  resolved (Redis accepted `XADD`).
- `400`: body over 64 KiB (`body_too_large`), invalid JSON, unknown field,
  missing/invalid topic, payload that is not an object, missing idempotency
  key (1-200 characters), metadata that is not an object or that sets a
  reserved field (`idempotencyKey`, `deliveryGuarantee`, `deadLetterTopic`,
  `deliveryTier`, `source`), or a provider validation refusal
  (`provider_rejected`). A body over 1 MiB gets 400 and the connection closes;
  a client still sending may see a reset instead.
- `401 unauthorized`: missing header, wrong scheme or unknown key.
- `403 topic_not_allowed`: the topic is not in the key's module manifest
  `provides.events`.
- `503 bus_unavailable` / `bus_timeout`: the bus cannot connect, the publish
  failed, or it did not settle within the publish timeout. The module retries
  later with the same idempotency key; its outbox row stays pending.

`GET /healthz` returns `{"status":"ok"}`. `GET /metrics` returns counters by
status and by `module|topic` (`accepted`, `refused`, `busErrors`; refused
undeclared topics count under `module|(undeclared)`).

Logs are one JSON line per publish request: status, reason code, module id and
the topic only when it is allowed. Keys, headers and payloads are never logged.

## Keys and allow-list

- `BUS_GATEWAY_KEYS_FILE`: JSON object `{"<module-id>": "<key>"}`, keys of 32-512
  token characters. Keys are hashed with SHA-256 at startup; the raw strings
  are not kept. Lookup compares the presented key's digest with every entry
  using `crypto.timingSafeEqual` on equal-length digests.
- `BUS_GATEWAY_MANIFESTS`: manifest paths separated by `:`. A module's
  `provides.events` is its allow-list. Startup fails when a keyed module has no
  manifest, when two modules share a key, or when a manifest declares a topic
  outside its own `<module-id>.` namespace.
- Source stamping: the gateway keeps one provider instance per module, connected
  with `source = <module id>`, so every event carries the publishing module.

Other settings: `BUS_GATEWAY_REDIS_URL` (credential-free; the provider refuses
credentials in the URL), `BUS_GATEWAY_REDIS_PASSWORD_FILE` and
`BUS_GATEWAY_REDIS_USERNAME` (see Redis credentials), `BUS_GATEWAY_STREAM_PREFIX` (default `eventbus`; must
match the subscribers), `BUS_GATEWAY_PROVIDER` (path of
`eventbus-redis/lib/eventbus-redis.mjs`), `BUS_GATEWAY_HOST` (default
`127.0.0.1`), `BUS_GATEWAY_PORT` (default 8080), `BUS_GATEWAY_PUBLISH_TIMEOUT_MS`
and `BUS_GATEWAY_CONNECT_TIMEOUT_MS` (default 5000).

## Redis credentials

The Core Redis profile runs with `requirepass`. Set
`BUS_GATEWAY_REDIS_PASSWORD_FILE` to the path of the mounted Core
`redis_password` secret (for example `/run/secrets/redis_password`). The gateway
passes the path to the provider as `passwordFile`; the provider reads the file
once per connection instance and refuses it when it is missing, empty, a
symlink, or group- or world-readable, so the file must be mode `0600` or `0400`
and readable by the gateway user (uid 1000 in `docker-compose.yml`). Set
`BUS_GATEWAY_REDIS_USERNAME` only for a Redis ACL user; it requires the password
file. The gateway never reads, logs or returns the password. Leave both unset
for a Redis without a password.

## Module client

```js
import { createGatewayPublisher, BusGatewayError } from './lib/client.mjs';
const publisher = createGatewayPublisher({ url: 'http://bus-gateway:8080', key: moduleKey });
await drainMembershipOutbox({ publisher, limit: 100, publishTimeoutMs: 10000 });
```

`publish(topic, payload, {idempotencyKey, metadata})` resolves on 202 and
throws `BusGatewayError` otherwise, with `code` (`bad_request`,
`unauthorized`, `forbidden`, `unavailable`, `unexpected_status`, `timeout`,
`transport`), `status`, `retryable` and the gateway `reason`.

## Run and test

```sh
node --test modules/bus-gateway/tests/gateway.test.mjs   # unit tests, no Redis
node modules/bus-gateway/lib/server.mjs                  # needs the env above
```

The provider needs its locked `redis` dependency installed
(`npm ci` in `modules/eventbus-redis`). `docker-compose.yml` runs the gateway
under the `bus-gateway` profile with no published port, on
`pmdl_app-internal` only.

## Limits

The provider currently accepts only five fixed `groups.*` topics; other declared
topics get `400 provider_rejected` until the provider's topic union becomes a
validated pattern (design C4). `docker-compose.yml` mounts the Core Redis
password (default source `./secrets/redis_password`, override with
`BUS_GATEWAY_REDIS_PASSWORD_SOURCE`) as the secret `bus_gateway_redis_password`
at `/run/secrets/redis_password`, asking for uid 1000 and mode `0400`. Whether a
non-swarm Compose engine applies that uid and mode to a file secret is not
proven; check the mounted file before the first deploy, or the provider refuses
it and every publish gets 503.

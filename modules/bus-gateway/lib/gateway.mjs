// Core bus gateway (WO-PMSYS-20261110-298, design C1-C6).
// Holds the bus connection; modules publish over HTTP with a per-module key.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

export const BODY_LIMIT_BYTES = 64 * 1024;
const DISCARD_LIMIT_BYTES = 1024 * 1024;
const MODULE_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TOPIC = /^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/;
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/;
const MIN_KEY_LENGTH = 32;
const REQUEST_FIELDS = new Set(['topic', 'payload', 'idempotencyKey', 'metadata']);
// The gateway sets these itself; a module cannot supply them.
const RESERVED_METADATA = new Set(['idempotencyKey', 'deliveryGuarantee', 'deadLetterTopic', 'deliveryTier', 'source']);

export class GatewayConfigError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function digest(key) {
  return createHash('sha256').update(key, 'utf8').digest();
}

/** Reads {"<module-id>": "<key>"}; keys stay in the returned object only until buildRegistry hashes them. */
export function loadKeyFile(path) {
  if (!path) throw new GatewayConfigError('Key file path required');
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new GatewayConfigError('Key file is not readable JSON'); }
  if (!isPlainObject(parsed)) throw new GatewayConfigError('Key file must be a JSON object of module id to key');
  return parsed;
}

/** Reads each module manifest and keeps its id and declared published events (provides.events). */
export function loadManifests(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new GatewayConfigError('At least one module manifest required');
  return paths.map(path => {
    let manifest;
    try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new GatewayConfigError('Manifest is not readable JSON: ' + path); }
    if (!isPlainObject(manifest) || typeof manifest.id !== 'string') throw new GatewayConfigError('Manifest has no id: ' + path);
    const events = manifest.provides?.events ?? [];
    if (!Array.isArray(events)) throw new GatewayConfigError('Manifest provides.events must be an array: ' + path);
    return { id: manifest.id, events };
  });
}

/**
 * Builds the in-memory key registry. Keys are hashed (SHA-256) and the raw strings are not kept.
 * A key whose module has no manifest, and a manifest topic outside the module's own namespace, fail startup.
 */
export function buildRegistry({ keys, manifests }) {
  if (!isPlainObject(keys)) throw new GatewayConfigError('Keys must be an object');
  const byId = new Map();
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) throw new GatewayConfigError('Duplicate manifest for module ' + manifest.id);
    byId.set(manifest.id, manifest);
  }
  const entries = [];
  const seen = new Set();
  for (const [module, key] of Object.entries(keys)) {
    if (!MODULE_ID.test(module)) throw new GatewayConfigError('Invalid module id in key file');
    if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH || key.length > 512 || !/^[A-Za-z0-9._~+/=-]+$/.test(key)) {
      throw new GatewayConfigError('Key for module ' + module + ' must be 32-512 token characters');
    }
    const manifest = byId.get(module);
    if (!manifest) throw new GatewayConfigError('No manifest for keyed module ' + module);
    const topics = new Set();
    for (const topic of manifest.events) {
      if (typeof topic !== 'string' || !TOPIC.test(topic) || topic.split('.')[0] !== module) {
        throw new GatewayConfigError('Module ' + module + ' declares a topic outside its namespace');
      }
      topics.add(topic);
    }
    const hash = digest(key);
    const fingerprint = hash.toString('hex');
    if (seen.has(fingerprint)) throw new GatewayConfigError('Two modules share one key');
    seen.add(fingerprint);
    entries.push(Object.freeze({ module, digest: hash, topics }));
  }
  if (entries.length === 0) throw new GatewayConfigError('No module keys configured');
  return Object.freeze(entries);
}

/**
 * Finds the entry for a presented token. Every entry is compared, with equal-length digests,
 * so the time taken does not depend on which entry matches or on the token length.
 */
export function lookupKey(entries, token, compare = timingSafeEqual) {
  const presented = digest(token);
  let found = null;
  for (const entry of entries) {
    const match = compare(entry.digest, presented);
    if (match && found === null) found = entry;
  }
  return found;
}

/**
 * Default bus factory: one provider instance per source module, connected with an explicit config.
 * passwordFile (and username for a Redis ACL user) is handed to the provider, which reads the file itself;
 * the gateway never reads or holds the Redis password.
 */
export function providerBusFactory({ providerUrl, redisUrl, streamPrefix = 'eventbus', claimIdleMs = 30000, passwordFile, username }) {
  if (!providerUrl) throw new GatewayConfigError('Provider module URL required');
  if (!redisUrl) throw new GatewayConfigError('Redis URL required');
  if (username && !passwordFile) throw new GatewayConfigError('Redis username requires a password file');
  const auth = { ...(passwordFile ? { passwordFile } : {}), ...(username ? { username } : {}) };
  return async source => {
    const { RedisStreamsEventBus } = await import(providerUrl);
    const bus = new RedisStreamsEventBus();
    try {
      await bus.connect({ url: redisUrl, source, streamPrefix, consumerGroup: 'bus-gateway-' + source, claimIdleMs, ...auth });
    } catch (error) {
      try { await bus.close(); } catch { /* connection already gone */ }
      throw error;
    }
    return bus;
  };
}

function newCounters() {
  return { byStatus: {}, byModuleTopic: {} };
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(label), { gatewayTimeout: true })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Creates the gateway. Returns {server, listen(port, host), close(), counters()}.
 * options.busFactory(source) -> Promise<bus with publish(topic, payload, options), isConnected(), close()>.
 */
export function createGateway({ registry, busFactory, publishTimeoutMs = 5000, connectTimeoutMs = 5000,
  log = defaultLog, bodyLimit = BODY_LIMIT_BYTES }) {
  if (!Array.isArray(registry) || registry.length === 0) throw new GatewayConfigError('Registry required');
  if (typeof busFactory !== 'function') throw new GatewayConfigError('Bus factory required');
  const buses = new Map();
  const counters = newCounters();

  function count(status, module, topicLabel, field) {
    counters.byStatus[status] = (counters.byStatus[status] ?? 0) + 1;
    if (module) {
      const key = module + '|' + (topicLabel ?? '(none)');
      const bucket = counters.byModuleTopic[key] ??= { accepted: 0, refused: 0, busErrors: 0 };
      bucket[field] += 1;
    }
  }

  function getBus(source) {
    let pending = buses.get(source);
    if (!pending) {
      pending = withTimeout(Promise.resolve().then(() => busFactory(source)), connectTimeoutMs, 'Bus connect timed out');
      buses.set(source, pending);
      pending.catch(() => { if (buses.get(source) === pending) buses.delete(source); });
    }
    return pending;
  }

  function discardBus(source, pending) {
    if (buses.get(source) !== pending) return;
    buses.delete(source);
    pending.then(bus => bus.close()).catch(() => {});
  }

  async function busFor(source) {
    const pending = getBus(source);
    const bus = await pending;
    if (bus.isConnected()) return { bus, pending };
    discardBus(source, pending);
    const fresh = getBus(source);
    return { bus: await fresh, pending: fresh };
  }

  function respond(res, status, body, ctx) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
    if (ctx) log({ status, code: body.error ?? body.status, module: ctx.module, topic: ctx.topic });
  }

  function readBody(req) {
    return new Promise(resolve => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > DISCARD_LIMIT_BYTES) { resolve({ tooLarge: true, destroy: true }); return; }
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > bodyLimit) tooLarge = true;
        if (size > DISCARD_LIMIT_BYTES) { resolve({ tooLarge: true, destroy: true }); req.pause(); return; }
        if (!tooLarge) chunks.push(chunk);
      });
      req.on('end', () => resolve(tooLarge ? { tooLarge: true } : { body: Buffer.concat(chunks) }));
      req.on('error', () => resolve({ tooLarge: false, broken: true }));
    });
  }

  function validate(parsed) {
    if (!isPlainObject(parsed)) return 'body_not_object';
    for (const key of Object.keys(parsed)) if (!REQUEST_FIELDS.has(key)) return 'unknown_field';
    if (typeof parsed.topic !== 'string' || !TOPIC.test(parsed.topic)) return 'invalid_topic';
    if (!isPlainObject(parsed.payload)) return 'invalid_payload';
    if (typeof parsed.idempotencyKey !== 'string' || parsed.idempotencyKey.length < 1 || parsed.idempotencyKey.length > 200) {
      return 'invalid_idempotency_key';
    }
    if (parsed.metadata !== undefined) {
      if (!isPlainObject(parsed.metadata)) return 'invalid_metadata';
      for (const key of Object.keys(parsed.metadata)) if (RESERVED_METADATA.has(key)) return 'reserved_metadata';
    }
    return null;
  }

  async function publish(req, res) {
    const ctx = { module: undefined, topic: undefined };
    const match = BEARER.exec(req.headers.authorization ?? '');
    const entry = match ? lookupKey(registry, match[1]) : null;
    if (!entry) {
      res.setHeader('connection', 'close');
      count(401);
      respond(res, 401, { error: 'unauthorized' }, ctx);
      return;
    }
    ctx.module = entry.module;
    const read = await readBody(req);
    if (read.tooLarge || read.broken) {
      res.setHeader('connection', 'close');
      count(400, entry.module, null, 'refused');
      respond(res, 400, { error: read.tooLarge ? 'body_too_large' : 'body_unreadable' }, ctx);
      if (read.destroy) res.on('finish', () => req.destroy());
      return;
    }
    let parsed;
    try { parsed = JSON.parse(read.body.toString('utf8')); }
    catch { count(400, entry.module, null, 'refused'); respond(res, 400, { error: 'invalid_json' }, ctx); return; }
    const invalid = validate(parsed);
    if (invalid) { count(400, entry.module, null, 'refused'); respond(res, 400, { error: invalid }, ctx); return; }
    if (!entry.topics.has(parsed.topic)) {
      count(403, entry.module, '(undeclared)', 'refused');
      respond(res, 403, { error: 'topic_not_allowed' }, ctx);
      return;
    }
    ctx.topic = parsed.topic;
    let handle;
    try {
      handle = await busFor(entry.module);
    } catch {
      count(503, entry.module, parsed.topic, 'busErrors');
      respond(res, 503, { error: 'bus_unavailable' }, ctx);
      return;
    }
    const options = { deliveryGuarantee: 'at-least-once', idempotencyKey: parsed.idempotencyKey };
    if (parsed.metadata !== undefined) options.metadata = parsed.metadata;
    try {
      await withTimeout(Promise.resolve().then(() => handle.bus.publish(parsed.topic, parsed.payload, options)),
        publishTimeoutMs, 'Publish timed out');
    } catch (error) {
      if (error instanceof TypeError) {
        count(400, entry.module, parsed.topic, 'refused');
        respond(res, 400, { error: 'provider_rejected' }, ctx);
        return;
      }
      discardBus(entry.module, handle.pending);
      count(503, entry.module, parsed.topic, 'busErrors');
      respond(res, 503, { error: error?.gatewayTimeout ? 'bus_timeout' : 'bus_unavailable' }, ctx);
      return;
    }
    count(202, entry.module, parsed.topic, 'accepted');
    respond(res, 202, { status: 'accepted' }, ctx);
  }

  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/v1/publish') {
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); respond(res, 405, { error: 'method_not_allowed' }); return; }
      publish(req, res).catch(() => {
        if (!res.headersSent) respond(res, 500, { error: 'internal_error' }, {});
      });
      return;
    }
    if (path === '/healthz' && req.method === 'GET') { respond(res, 200, { status: 'ok' }); return; }
    if (path === '/metrics' && req.method === 'GET') { respond(res, 200, structuredClone(counters)); return; }
    respond(res, 404, { error: 'not_found' });
  });

  return {
    server,
    counters: () => structuredClone(counters),
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    async close() {
      const closed = new Promise(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
      const pending = [...buses.values()];
      buses.clear();
      await Promise.allSettled(pending.map(p => p.then(bus => bus.close())));
    },
  };
}

function defaultLog(entry) {
  // Status, reason code, module id and an allowed topic only: never keys, headers or payloads.
  process.stderr.write(JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}

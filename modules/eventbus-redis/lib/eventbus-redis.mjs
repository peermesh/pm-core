import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const TOPICS = new Set(['groups.group.created', 'groups.group.updated', 'groups.member.joined',
  'groups.member.left', 'groups.member.approved']);
const TOPIC = /^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/;
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Contract creation and conflict detection are a single broker operation.
const REGISTER = `
local prior = redis.call('GET', KEYS[2])
if prior and prior ~= ARGV[2] then return redis.error_reply('GROUP_CONTRACT_CONFLICT') end
local result = redis.pcall('XGROUP', 'CREATE', KEYS[1], ARGV[1], ARGV[3], 'MKSTREAM')
if type(result) == 'table' and result.err and not string.find(result.err, 'BUSYGROUP', 1, true) then
  return redis.error_reply(result.err)
end
if not prior and type(result) == 'table' and result.err then
  return redis.error_reply('UNMANAGED_GROUP')
end
if not prior then redis.call('SET', KEYS[2], ARGV[2]) end
return 1`;

// Check ownership and delivery generation so a stale handler cannot ack a newer claim.
// A DLQ write precedes the source ack in the same atomic script. Wrong-type DLQ errors
// occur before XACK; no stream entry is trimmed/deleted, including other groups' copies.
const COMPLETE = `
local p = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #p == 0 or p[1][2] ~= ARGV[3] or tostring(p[1][4]) ~= ARGV[4] then return 0 end
if ARGV[5] ~= '' then redis.call('XADD', KEYS[2], '*', 'record', ARGV[5]) end
return redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])`;

function object(value, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(label + ' must be an object');
}
function options(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError('Unsupported ' + label + ': ' + key);
}
function positive(value, label, maximum = 60000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('Invalid ' + label);
}
function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) return value.forEach(jsonValue);
  object(value, 'JSON value');
  Object.values(value).forEach(jsonValue);
}
function topic(value) {
  if (!TOPICS.has(value)) throw new TypeError('Unsupported exact topic');
}
function dlq(value) {
  if (typeof value !== 'string' || !TOPIC.test(value) || !value.startsWith('groups.') || TOPICS.has(value)) {
    throw new TypeError('Invalid distinct Groups dead-letter topic');
  }
}
function envelope(value, expectedTopic) {
  object(value, 'Event');
  const allowed = ['id','timestamp','source','type','specversion','datacontenttype','payload','correlationId','causationId','metadata'];
  options(value, allowed, 'event field');
  if (typeof value.id !== 'string' || !UUID.test(value.id) || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0 ||
      value.type !== expectedTopic || value.source !== expectedTopic.split('.')[0] ||
      value.specversion !== '1.0' || value.datacontenttype !== 'application/json') throw new TypeError('Malformed event envelope');
  object(value.payload, 'payload'); jsonValue(value.payload);
  for (const key of ['correlationId','causationId']) if (key in value && (typeof value[key] !== 'string' || !UUID.test(value[key]))) throw new TypeError('Invalid ' + key);
  if ('metadata' in value) {
    object(value.metadata, 'metadata'); jsonValue(value.metadata);
    const m = value.metadata;
    if (m.deliveryGuarantee !== undefined && m.deliveryGuarantee !== 'at-least-once') throw new TypeError('Unsupported delivery guarantee');
    if (m.deliveryTier !== undefined && !['informational','operational-critical'].includes(m.deliveryTier)) throw new TypeError('Unsupported delivery tier');
    if (m.idempotencyKey !== undefined && (typeof m.idempotencyKey !== 'string' || !m.idempotencyKey)) throw new TypeError('Invalid idempotencyKey');
    if (m.deadLetterTopic !== undefined) dlq(m.deadLetterTopic);
    if (m.version !== undefined && typeof m.version !== 'string') throw new TypeError('Invalid metadata version');
    if (m.retryCount !== undefined && (!Number.isSafeInteger(m.retryCount) || m.retryCount < 0)) throw new TypeError('Invalid retryCount');
    if (m.originalTimestamp !== undefined && !Number.isSafeInteger(m.originalTimestamp)) throw new TypeError('Invalid originalTimestamp');
  }
}
async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Close timed out; handler may still be running')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export class RedisStreamsEventBus {
  #client;
  #config;
  #subscriptions = new Set();
  #closing = false;

  async connect(config) {
    if (this.#client || this.#closing) throw new Error('Create a new bus instance to reconnect');
    options(config, ['url','source','streamPrefix','consumerGroup','maxDeliveryAttempts','claimIdleMs','closeTimeoutMs'], 'config');
    if (typeof config.url !== 'string') throw new TypeError('Explicit Redis URL required');
    const url = new URL(config.url);
    if (!['redis:','rediss:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new TypeError('Explicit credential-free Redis URL required');
    for (const key of ['source','streamPrefix','consumerGroup']) if (typeof config[key] !== 'string' || !NAME.test(config[key])) throw new TypeError('Invalid ' + key);
    const c = {...config, maxDeliveryAttempts: config.maxDeliveryAttempts ?? 5, closeTimeoutMs: config.closeTimeoutMs ?? 2000};
    positive(c.maxDeliveryAttempts, 'maxDeliveryAttempts', 100); positive(c.claimIdleMs, 'claimIdleMs'); positive(c.closeTimeoutMs, 'closeTimeoutMs');
    this.#config = Object.freeze(c);
    this.#client = this.#newClient();
    try { await this.#client.connect(); }
    catch (error) { if (this.#client.isOpen) await this.#client.disconnect(); throw error; }
  }

  #newClient() {
    const client = createClient({url: this.#config.url, disableOfflineQueue: true,
      socket: {connectTimeout: 1000, reconnectStrategy: false}});
    client.on('error', () => {}); // Command/loop promises carry failures; no unhandled EventEmitter error.
    return client;
  }

  isConnected() { return !this.#closing && Boolean(this.#client?.isReady); }

  async publish(type, payload, supplied = {}) {
    if (!this.isConnected()) throw new Error('Bus is not connected');
    topic(type);
    if (type.split('.')[0] !== this.#config.source) throw new TypeError('Source/topic mismatch');
    options(supplied, ['correlationId','causationId','waitForAck','deliveryGuarantee','deliveryTier','idempotencyKey','deadLetterTopic','metadata'], 'publish option');
    if (supplied.waitForAck !== undefined && supplied.waitForAck !== false) throw new TypeError('Consumer/fsync acknowledgment is unsupported');
    const metadata = {...(supplied.metadata ?? {})};
    if (supplied.metadata !== undefined) object(supplied.metadata, 'metadata');
    for (const key of ['deliveryGuarantee','deliveryTier','idempotencyKey','deadLetterTopic']) {
      if (supplied[key] !== undefined) {
        if (metadata[key] !== undefined && metadata[key] !== supplied[key]) throw new TypeError('Conflicting metadata ' + key);
        metadata[key] = supplied[key];
      }
    }
    const event = {id: randomUUID(), timestamp: Date.now(), source: this.#config.source, type,
      specversion: '1.0', datacontenttype: 'application/json', payload};
    for (const key of ['correlationId','causationId']) if (supplied[key] !== undefined) event[key] = supplied[key];
    if (Object.keys(metadata).length) event.metadata = metadata;
    envelope(event, type);
    await this.#client.sendCommand(['XADD', this.#stream(type), '*', 'event', JSON.stringify(event)]);
  }

  #stream(type) { return this.#config.streamPrefix + ':stream:' + type; }

  subscribe(type, handler, supplied = {}) {
    if (!this.isConnected()) throw new Error('Bus is not connected');
    topic(type);
    if (typeof handler !== 'function') throw new TypeError('Handler required');
    options(supplied, ['group','fromBeginning','ackMode','deliveryGuarantee','maxDeliveryAttempts','deadLetterTopic'], 'subscribe option');
    if (supplied.group !== undefined && supplied.group !== this.#config.consumerGroup) throw new TypeError('Group must match explicit module consumerGroup');
    if (supplied.ackMode !== undefined && supplied.ackMode !== 'auto') throw new TypeError('Only auto acknowledgment is supported');
    if (supplied.deliveryGuarantee !== undefined && supplied.deliveryGuarantee !== 'at-least-once') throw new TypeError('Unsupported subscription guarantee');
    if (supplied.fromBeginning !== undefined && typeof supplied.fromBeginning !== 'boolean') throw new TypeError('Invalid fromBeginning');
    dlq(supplied.deadLetterTopic);
    const policy = {source: this.#config.source, group: this.#config.consumerGroup,
      maxDeliveryAttempts: supplied.maxDeliveryAttempts ?? this.#config.maxDeliveryAttempts,
      claimIdleMs: this.#config.claimIdleMs, deadLetterTopic: supplied.deadLetterTopic,
      fromBeginning: supplied.fromBeginning ?? false, ackMode: 'auto', deliveryGuarantee: 'at-least-once'};
    positive(policy.maxDeliveryAttempts, 'maxDeliveryAttempts', 100);
    const sub = {id: randomUUID(), topic: type, active: false, error: undefined};
    const state = {sub, policy, handler, stopped: false, client: this.#newClient()};
    this.#subscriptions.add(state);
    sub.ready = (async () => {
      try {
        await state.client.connect();
        if (state.stopped) throw new Error('Subscription closed before readiness');
        await state.client.sendCommand(['EVAL', REGISTER, '2', this.#stream(type),
          this.#stream(type) + ':contract:' + policy.group, policy.group, JSON.stringify(policy), policy.fromBeginning ? '0' : '$']);
        if (state.stopped) throw new Error('Subscription closed before readiness');
        sub.active = true;
      } catch (error) { sub.error = error; state.stopped = true; throw error; }
    })();
    // Keep a handled internal branch while the original ready promise remains rejectable by callers.
    sub.closed = sub.ready.then(() => this.#consume(state)).catch(error => {
      sub.error = error;
    }).finally(async () => {
      sub.active = false; state.stopped = true;
      if (state.client.isOpen) await state.client.disconnect();
    });
    return sub;
  }

  async #consume(state) {
    const {sub, policy, client} = state;
    const stream = this.#stream(sub.topic);
    let cursor = '0-0';
    while (!state.stopped) {
      const claimed = await client.sendCommand(['XAUTOCLAIM', stream, policy.group, sub.id,
        String(policy.claimIdleMs), cursor, 'COUNT', '1']);
      cursor = claimed[0];
      let entries = claimed[1];
      if (!entries.length && !state.stopped) {
        const fresh = await client.sendCommand(['XREADGROUP','GROUP',policy.group,sub.id,'COUNT','1','BLOCK','50','STREAMS',stream,'>']);
        entries = fresh?.[0]?.[1] ?? [];
      }
      for (const [id, fields] of entries) {
        if (state.stopped) break;
        const pending = await client.sendCommand(['XPENDING',stream,policy.group,id,id,'1']);
        if (!pending.length || pending[0][1] !== sub.id || state.stopped) continue;
        const attempts = Number(pending[0][3]);
        let event, cause;
        const raw = fields?.[fields.indexOf('event') + 1];
        try {
          event = JSON.parse(raw); envelope(event, sub.topic);
          if (event.metadata?.deadLetterTopic && event.metadata.deadLetterTopic !== policy.deadLetterTopic) throw new Error('Event/group DLQ conflict');
          if (attempts > policy.maxDeliveryAttempts) throw new Error('Recovery delivery limit exhausted');
          await state.handler(event);
        } catch (error) { cause = error instanceof Error ? error.message : String(error); }
        if (state.stopped) break;
        if (cause === undefined || attempts >= policy.maxDeliveryAttempts) {
          const record = cause !== undefined ? JSON.stringify({event: event ?? null, originalEnvelope: raw ?? null,
            sourceStream: stream, sourceId: id, group: policy.group, attempts, cause}) : '';
          await client.sendCommand(['EVAL', COMPLETE, '2', stream, this.#stream(policy.deadLetterTopic),
            policy.group, id, sub.id, String(attempts), record]);
        }
      }
    }
  }

  unsubscribe(subscription) {
    const state = [...this.#subscriptions].find(s => s.sub === subscription);
    if (!state) throw new TypeError('Unknown subscription');
    state.stopped = true; state.sub.active = false;
  }

  async close() {
    this.#closing = true;
    for (const state of this.#subscriptions) this.unsubscribe(state.sub);
    const draining = Promise.all([...this.#subscriptions].map(s => s.sub.closed));
    try { await bounded(draining, this.#config?.closeTimeoutMs ?? 2000); }
    finally {
      for (const state of this.#subscriptions) if (state.client.isOpen) await state.client.disconnect();
      if (this.#client?.isOpen) await this.#client.disconnect();
    }
  }
}

import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { ClientClosedError, ClientOfflineError, ConnectionTimeoutError, DisconnectsClientError, ErrorReply,
  ReconnectStrategyError, SocketClosedUnexpectedlyError, createClient } from 'redis';

// A topic is module-scoped: lowercase dot-separated segments of [a-z0-9-], at least three, and its
// first segment is the publishing module's source (checked at publish and on every stored envelope).
// The gateway's per-module allow-list, read from each manifest's provides.events, decides which
// topics a module may publish. 128 bounds the stream and contract keys; the longest topic today is 41.
const TOPIC = /^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/;
const TOPIC_MAX_LENGTH = 128;
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[\x21-\x7e]{1,256}$/;
const PASSWORD_FILE_MAX_BYTES = 4096;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5000;
// Broker replies that clear after a restart or a lost group; every other reply is terminal.
const RETRYABLE_REPLY = /^(LOADING|NOGROUP|BUSY|MASTERDOWN|TRYAGAIN)\b/;
const TRANSPORT_ERRORS = [ClientClosedError, ClientOfflineError, ConnectionTimeoutError, DisconnectsClientError,
  ReconnectStrategyError, SocketClosedUnexpectedlyError];
const NETWORK_CODES = new Set(['ECONNREFUSED','ECONNRESET','ECONNABORTED','EPIPE','ETIMEDOUT','EHOSTUNREACH',
  'ENETUNREACH','ENETDOWN','EAI_AGAIN','ENOTFOUND']);

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
  if (typeof value !== 'string' || value.length > TOPIC_MAX_LENGTH || !TOPIC.test(value)) throw new TypeError('Unsupported exact topic');
}
// A dead-letter topic follows the topic rule, lives in the namespace of the topic it serves (its
// first segment is that topic's source) and differs from that topic.
function dlq(value, forTopic) {
  if (typeof value !== 'string' || value.length > TOPIC_MAX_LENGTH || !TOPIC.test(value) ||
      value.split('.')[0] !== forTopic.split('.')[0] || value === forTopic) {
    throw new TypeError('Invalid distinct dead-letter topic for the topic source');
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
    if (m.deadLetterTopic !== undefined) dlq(m.deadLetterTopic, expectedTopic);
    if (m.version !== undefined && typeof m.version !== 'string') throw new TypeError('Invalid metadata version');
    if (m.retryCount !== undefined && (!Number.isSafeInteger(m.retryCount) || m.retryCount < 0)) throw new TypeError('Invalid retryCount');
    if (m.originalTimestamp !== undefined && !Number.isSafeInteger(m.originalTimestamp)) throw new TypeError('Invalid originalTimestamp');
  }
}
function retryable(error) {
  if (error instanceof ErrorReply) return RETRYABLE_REPLY.test(error.message);
  if (TRANSPORT_ERRORS.some(type => error instanceof type)) return true;
  return typeof error?.code === 'string' && NETWORK_CODES.has(error.code);
}
function backoffMs(failures) {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(failures, 16));
  return Math.round(ceiling / 2 + Math.random() * ceiling / 2);
}
// The secret is read once; errors name the path and the fault, never the file contents.
async function readPasswordFile(path) {
  if (typeof path !== 'string' || !path) throw new TypeError('Invalid passwordFile');
  const refuse = reason => new Error('Redis password file ' + reason + ': ' + path);
  let info, handle, value;
  try { info = await lstat(path); }
  catch (error) { throw refuse('cannot be read (' + (error?.code ?? 'error') + ')'); }
  if (info.isSymbolicLink()) throw refuse('must not be a symlink');
  if (!info.isFile()) throw refuse('must be a regular file');
  if (info.mode & 0o044) throw refuse('must not be group- or world-readable (use mode 0600 or 0400)');
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev || (opened.mode & 0o044)) throw refuse('changed while opening');
    if (opened.size > PASSWORD_FILE_MAX_BYTES) throw refuse('is larger than ' + PASSWORD_FILE_MAX_BYTES + ' bytes');
    value = await handle.readFile('utf8');
  } catch (error) {
    if (error?.message?.startsWith('Redis password file ')) throw error;
    throw refuse('cannot be read (' + (error?.code ?? 'error') + ')');
  } finally { await handle?.close(); }
  if (value.endsWith('\r\n')) value = value.slice(0, -2);
  else if (value.endsWith('\n')) value = value.slice(0, -1);
  if (!value) throw refuse('is empty');
  return value;
}
function authFailure(error) {
  if (!(error instanceof ErrorReply)) return error;
  if (/^NOAUTH\b/.test(error.message)) return new Error('Redis requires authentication: configure passwordFile (NOAUTH)', {cause: error});
  if (/^WRONGPASS\b/.test(error.message)) return new Error('Redis authentication failed: wrong username or password (WRONGPASS)', {cause: error});
  return error;
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
  #password;
  #subscriptions = new Set();
  #closing = false;

  async connect(config) {
    if (this.#client || this.#closing) throw new Error('Create a new bus instance to reconnect');
    options(config, ['url','source','streamPrefix','consumerGroup','maxDeliveryAttempts','claimIdleMs','closeTimeoutMs',
      'passwordFile','username'], 'config');
    if (typeof config.url !== 'string') throw new TypeError('Explicit Redis URL required');
    const url = new URL(config.url);
    if (!['redis:','rediss:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new TypeError('Explicit credential-free Redis URL required');
    for (const key of ['source','streamPrefix','consumerGroup']) if (typeof config[key] !== 'string' || !NAME.test(config[key])) throw new TypeError('Invalid ' + key);
    if (config.passwordFile !== undefined && (typeof config.passwordFile !== 'string' || !config.passwordFile)) throw new TypeError('Invalid passwordFile');
    if (config.username !== undefined) {
      if (typeof config.username !== 'string' || !USERNAME.test(config.username)) throw new TypeError('Invalid username');
      if (config.passwordFile === undefined) throw new TypeError('username requires passwordFile');
    }
    const c = {...config, maxDeliveryAttempts: config.maxDeliveryAttempts ?? 5, closeTimeoutMs: config.closeTimeoutMs ?? 2000};
    positive(c.maxDeliveryAttempts, 'maxDeliveryAttempts', 100); positive(c.claimIdleMs, 'claimIdleMs'); positive(c.closeTimeoutMs, 'closeTimeoutMs');
    const password = c.passwordFile === undefined ? undefined : await readPasswordFile(c.passwordFile);
    if (this.#client || this.#closing) throw new Error('Create a new bus instance to reconnect');
    this.#password = password;
    this.#config = Object.freeze(c);
    this.#client = this.#newClient();
    try {
      await this.#client.connect();
      await this.#client.sendCommand(['PING']); // Surfaces NOAUTH here instead of on the first publish.
    } catch (error) {
      if (this.#client.isOpen) await this.#client.disconnect();
      throw authFailure(error);
    }
  }

  #newClient() {
    const auth = this.#password === undefined ? {} :
      {password: this.#password, ...(this.#config.username ? {username: this.#config.username} : {})};
    const client = createClient({url: this.#config.url, ...auth, disableOfflineQueue: true,
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
    dlq(supplied.deadLetterTopic, type);
    const policy = {source: this.#config.source, group: this.#config.consumerGroup,
      maxDeliveryAttempts: supplied.maxDeliveryAttempts ?? this.#config.maxDeliveryAttempts,
      claimIdleMs: this.#config.claimIdleMs, deadLetterTopic: supplied.deadLetterTopic,
      fromBeginning: supplied.fromBeginning ?? false, ackMode: 'auto', deliveryGuarantee: 'at-least-once'};
    positive(policy.maxDeliveryAttempts, 'maxDeliveryAttempts', 100);
    const sub = {id: randomUUID(), topic: type, active: false, error: undefined, reconnects: 0, reconnecting: false};
    let signalStop;
    const state = {sub, policy, handler, stopped: false, client: this.#newClient(), connecting: undefined,
      stopSignal: new Promise(resolve => { signalStop = resolve; })};
    state.stop = () => { state.stopped = true; signalStop(); };
    this.#subscriptions.add(state);
    sub.ready = (async () => {
      try {
        await this.#open(state, state.client);
        if (state.stopped) throw new Error('Subscription closed before readiness');
        await this.#register(state, policy.fromBeginning ? '0' : '$');
        if (state.stopped) throw new Error('Subscription closed before readiness');
        sub.active = true;
      } catch (error) { sub.error = authFailure(error); state.stop(); throw sub.error; }
    })();
    // Keep a handled internal branch while the original ready promise remains rejectable by callers.
    sub.closed = sub.ready.then(() => this.#run(state)).catch(error => {
      sub.error = error;
    }).finally(async () => {
      sub.active = false; sub.reconnecting = false; state.stop();
      await this.#release(state);
    });
    return sub;
  }

  // Never disconnect a client while its connect() is pending: node-redis would then leak the socket.
  async #open(state, client) {
    state.connecting = client.connect();
    try { await state.connecting; } finally { state.connecting = undefined; }
  }

  async #release(state) {
    const client = state.client;
    if (state.connecting) {
      state.connecting.then(() => client.isOpen && client.disconnect(), () => {}).catch(() => {});
      return;
    }
    if (client.isOpen) await client.disconnect().catch(() => {});
  }

  #register(state, start) {
    const {sub, policy} = state;
    return state.client.sendCommand(['EVAL', REGISTER, '2', this.#stream(sub.topic),
      this.#stream(sub.topic) + ':contract:' + policy.group, policy.group, JSON.stringify(policy), start]);
  }

  async #run(state) {
    while (!state.stopped) {
      try { await this.#consume(state); return; }
      catch (error) {
        if (state.stopped || !retryable(error)) throw error;
        if (!await this.#reconnect(state, error)) return;
      }
    }
  }

  // Bounded exponential backoff with jitter. An existing group keeps its cursor and pending entries
  // (BUSYGROUP); a group lost with broker data is recreated at '0' so entries written since are not skipped.
  async #reconnect(state, cause) {
    const {sub} = state;
    sub.reconnecting = true;
    let lastError = cause;
    for (let failures = 0; ; failures++) {
      let timer;
      await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, backoffMs(failures)); }), state.stopSignal]);
      clearTimeout(timer);
      if (state.stopped) break;
      try {
        if (state.client.isOpen && !state.connecting) await state.client.disconnect().catch(() => {});
        state.client = this.#newClient();
        const opening = this.#open(state, state.client);
        opening.catch(() => {});
        await Promise.race([opening, state.stopSignal]);
        if (state.stopped) break;
        await this.#register(state, '0');
        if (state.stopped) break;
        sub.reconnecting = false; sub.reconnects++;
        return true;
      } catch (error) {
        lastError = error;
        if (state.stopped) break;
        if (!retryable(error)) { sub.reconnecting = false; throw authFailure(error); }
      }
    }
    // Closed while disconnected: the loop ends without a broker connection; report the last cause.
    sub.reconnecting = false; sub.error = lastError;
    return false;
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
    state.stop(); state.sub.active = false;
  }

  async close() {
    this.#closing = true;
    for (const state of this.#subscriptions) this.unsubscribe(state.sub);
    const draining = Promise.all([...this.#subscriptions].map(s => s.sub.closed));
    try { await bounded(draining, this.#config?.closeTimeoutMs ?? 2000); }
    finally {
      for (const state of this.#subscriptions) await this.#release(state);
      if (this.#client?.isOpen) await this.#client.disconnect();
    }
  }
}

// Password file rules for RedisStreamsEventBus.connect. No Redis needed: a minimal RESP server on
// 127.0.0.1 records the AUTH arguments and answers like Redis does.
// Run: node --test modules/eventbus-redis/tests/password-file.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { RedisStreamsEventBus } from '../lib/eventbus-redis.mjs';

const SECRET = 'pw-' + randomBytes(24).toString('hex');
let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'eventbus-redis-pwfile-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

function secretFile(name, content = SECRET + '\n', mode = 0o600) {
  const path = join(dir, name);
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
  return path;
}

// Parses RESP arrays of bulk strings (what node-redis sends) and replies per command.
function fakeRedis({ password, username = 'default' }) {
  const seen = [];
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); // the client may reset the connection after an auth failure
    let authed = password === undefined;
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const parsed = parseArray(buffer);
        if (!parsed) break;
        buffer = buffer.subarray(parsed.length);
        const [name, ...args] = parsed.args;
        const command = name.toUpperCase();
        seen.push({ command, args });
        if (command === 'AUTH') {
          const [user, pass] = args.length === 2 ? args : ['default', args[0]];
          authed = user === username && pass === password;
          socket.write(authed ? '+OK\r\n' : '-WRONGPASS invalid username-password pair or user is disabled.\r\n');
        } else if (!authed) socket.write('-NOAUTH Authentication required.\r\n');
        else if (command === 'PING') socket.write('+PONG\r\n');
        else if (command === 'EVAL') socket.write(':1\r\n');
        else if (command === 'XAUTOCLAIM') socket.write('*3\r\n$3\r\n0-0\r\n*0\r\n*0\r\n');
        else if (command === 'XREADGROUP') setTimeout(() => socket.writable && socket.write('*-1\r\n'), 20);
        else socket.write('-ERR unknown command\r\n');
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: 'redis://127.0.0.1:' + server.address().port, seen,
    close: () => new Promise(done => { for (const s of sockets) s.destroy(); server.close(done); }),
  })));
}
function parseArray(buffer) {
  const text = buffer.toString('latin1');
  if (text[0] !== '*') return null;
  let at = text.indexOf('\r\n');
  if (at < 0) return null;
  const count = Number(text.slice(1, at));
  let offset = at + 2;
  const args = [];
  for (let i = 0; i < count; i++) {
    at = text.indexOf('\r\n', offset);
    if (at < 0 || text[offset] !== '$') return null;
    const size = Number(text.slice(offset + 1, at));
    const start = at + 2;
    if (buffer.length < start + size + 2) return null;
    args.push(buffer.subarray(start, start + size).toString('utf8'));
    offset = start + size + 2;
  }
  return { args, length: offset };
}

function config(extra) {
  return { url: 'redis://127.0.0.1:1', source: 'chat', streamPrefix: 'pwtest', consumerGroup: 'chat', claimIdleMs: 1000, ...extra };
}
// Everything a caller or a log line could show about an error.
function exposed(error) {
  const parts = [];
  for (let e = error; e; e = e.cause) parts.push(String(e.message), String(e.stack), inspect(e, { depth: 5 }), JSON.stringify(e));
  return parts.join('\n');
}
// Captures console and stdout/stderr writes while fn runs.
async function captureOutput(fn) {
  const out = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug,
    stdout: process.stdout.write, stderr: process.stderr.write };
  for (const k of ['log', 'error', 'warn', 'info', 'debug']) console[k] = (...a) => out.push(a.map(String).join(' '));
  process.stdout.write = (chunk, ...rest) => { out.push(String(chunk)); return saved.stdout.call(process.stdout, chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { out.push(String(chunk)); return saved.stderr.call(process.stderr, chunk, ...rest); };
  try { return { result: await fn(), out }; }
  finally {
    for (const k of ['log', 'error', 'warn', 'info', 'debug']) console[k] = saved[k];
    process.stdout.write = saved.stdout; process.stderr.write = saved.stderr;
  }
}
async function refusal(cfg) {
  const bus = new RedisStreamsEventBus();
  let caught;
  const { out } = await captureOutput(async () => { try { await bus.connect(cfg); } catch (error) { caught = error; } });
  assert.ok(caught, 'connect must reject');
  assert.equal(exposed(caught).includes(SECRET), false, 'secret in error');
  assert.equal(out.join('\n').includes(SECRET), false, 'secret in output');
  assert.equal(bus.isConnected(), false);
  return caught;
}

test('missing password file is refused with the path and ENOENT', async () => {
  const path = join(dir, 'absent');
  const error = await refusal(config({ passwordFile: path }));
  assert.match(error.message, /Redis password file cannot be read \(ENOENT\)/);
  assert.ok(error.message.includes(path));
});

test('world-readable and group-readable files are refused before reading', async () => {
  for (const [name, mode] of [['world', 0o644], ['world-only', 0o604], ['group', 0o640]]) {
    const error = await refusal(config({ passwordFile: secretFile(name, SECRET + '\n', mode) }));
    assert.match(error.message, /must not be group- or world-readable/, name);
  }
});

test('a symlink is refused even when its target is mode 0600', async () => {
  const target = secretFile('target');
  const link = join(dir, 'link');
  symlinkSync(target, link);
  const error = await refusal(config({ passwordFile: link }));
  assert.match(error.message, /must not be a symlink/);
});

test('a directory, an empty file and an oversized file are refused', async () => {
  const sub = join(dir, 'a-directory');
  mkdirSync(sub, { mode: 0o700 });
  assert.match((await refusal(config({ passwordFile: sub }))).message, /must be a regular file/);
  assert.match((await refusal(config({ passwordFile: secretFile('empty', '\n') }))).message, /is empty/);
  assert.match((await refusal(config({ passwordFile: secretFile('big', SECRET + 'x'.repeat(5000)) }))).message, /larger than 4096 bytes/);
});

test('credentials in the URL stay refused, and option types are checked', async () => {
  for (const url of ['redis://:' + SECRET + '@127.0.0.1:6379', 'redis://user:' + SECRET + '@127.0.0.1:6379', 'redis://user@127.0.0.1:6379']) {
    const error = await refusal(config({ url }));
    assert.match(error.message, /credential-free Redis URL required/);
  }
  await assert.rejects(new RedisStreamsEventBus().connect(config({ passwordFile: '' })), /Invalid passwordFile/);
  await assert.rejects(new RedisStreamsEventBus().connect(config({ passwordFile: 7 })), /Invalid passwordFile/);
  await assert.rejects(new RedisStreamsEventBus().connect(config({ username: 'chat' })), /username requires passwordFile/);
  await assert.rejects(new RedisStreamsEventBus().connect(config({ passwordFile: secretFile('u'), username: 'bad name' })), /Invalid username/);
});

test('a valid file against an unreachable Redis fails without exposing the value', async () => {
  const error = await refusal(config({ passwordFile: secretFile('valid') }));
  assert.equal(error.code, 'ECONNREFUSED');
});

test('the file is read once, one trailing newline is removed, and every client uses it', async () => {
  const redis = await fakeRedis({ password: SECRET });
  try {
    const path = secretFile('once', SECRET + '\n');
    const bus = new RedisStreamsEventBus();
    await bus.connect(config({ url: redis.url, passwordFile: path }));
    assert.equal(bus.isConnected(), true);
    writeFileSync(path, 'changed-after-connect\n'); // not read again
    const sub = bus.subscribe('groups.member.joined', () => {}, { deadLetterTopic: 'groups.events.dead-letter' });
    await sub.ready;
    bus.unsubscribe(sub); await sub.closed;
    await bus.close();
    const auths = redis.seen.filter(s => s.command === 'AUTH');
    assert.equal(auths.length, 2);
    for (const a of auths) assert.deepEqual(a.args, [SECRET]);
    assert.equal(redis.seen.some(s => s.command === 'PING'), true);
  } finally { await redis.close(); }
});

test('CRLF counts as one newline, only one is removed, and username is sent for ACL users', async () => {
  const redis = await fakeRedis({ password: SECRET + '\n', username: 'gateway' });
  try {
    const bus = new RedisStreamsEventBus();
    await bus.connect(config({ url: redis.url, passwordFile: secretFile('acl', SECRET + '\n\r\n'), username: 'gateway' }));
    await bus.close();
    assert.deepEqual(redis.seen.find(s => s.command === 'AUTH').args, ['gateway', SECRET + '\n']);
  } finally { await redis.close(); }
});

test('wrong password and missing password fail at connect with clear errors and no value', async () => {
  const redis = await fakeRedis({ password: 'the-real-one-' + randomBytes(8).toString('hex') });
  try {
    const wrong = await refusal(config({ url: redis.url, passwordFile: secretFile('wrong') }));
    assert.match(wrong.message, /Redis authentication failed: wrong username or password \(WRONGPASS\)/);
    const none = await refusal(config({ url: redis.url }));
    assert.match(none.message, /Redis requires authentication: configure passwordFile \(NOAUTH\)/);
  } finally { await redis.close(); }
});

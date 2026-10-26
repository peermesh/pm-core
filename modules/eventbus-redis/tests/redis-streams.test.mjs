import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { RedisStreamsEventBus } from '../lib/eventbus-redis.mjs';

const URL = process.env.REDIS_URL;
const DIR = process.env.PROOF_DIR;
const GROUP = process.env.PROOF_GROUP;
assert.ok(URL && DIR && GROUP, 'Explicit isolated fixture configuration required');
const TOPICS = ['groups.group.created','groups.group.updated','groups.member.joined','groups.member.left','groups.member.approved'];
const T = TOPICS[2], DLQ = 'groups.events.dead-letter';
const stream = (prefix, topic = T) => prefix + ':stream:' + topic;
const observed = [];
async function record(name, value) {
  const row = {name, at: new Date().toISOString(), value};
  observed.push(row);
  await writeFile(DIR + '/' + GROUP + '.json', JSON.stringify({group: GROUP, observations: observed}, null, 2) + '\n');
}
async function until(fn, label) {
  const deadline = Date.now() + 5000;
  do { const value = await fn(); if (value) return value; await delay(20); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
async function observer() {
  const c = createClient({url: URL, socket: {reconnectStrategy: false}, disableOfflineQueue: true});
  c.on('error', () => {}); await c.connect(); return c;
}
async function bus(prefix, source = 'chat', consumerGroup = 'chat', overrides = {}) {
  const b = new RedisStreamsEventBus();
  await b.connect({url: URL, source, consumerGroup, streamPrefix: prefix,
    claimIdleMs: 150, maxDeliveryAttempts: 3, closeTimeoutMs: 1000, ...overrides});
  return b;
}
function subscribe(b, handler, options = {}, topic = T) {
  return b.subscribe(topic, handler, {fromBeginning: true, deadLetterTopic: DLQ, ...options});
}
async function pending(c, prefix, group = 'chat', topic = T) {
  return c.sendCommand(['XPENDING', stream(prefix, topic), group, '-', '+', '100']);
}
async function entries(c, prefix, topic = T) {
  return c.sendCommand(['XRANGE', stream(prefix, topic), '-', '+']);
}
function event(row) { return JSON.parse(row[1][row[1].indexOf('event') + 1]); }
async function publish(prefix, payload, options, topic = T) {
  const p = await bus(prefix, 'groups', 'publisher');
  try { assert.equal(await p.publish(topic, payload, options), undefined); }
  finally { await p.close(); }
}
function group(name, fn) {
  if (GROUP === name) test('finite proof group ' + name, {timeout: 20000}, async () => {
    await record('expected-before', {name, sourceTopics: TOPICS, fixtureOnly: true});
    await fn(); await record('status', 'PASS');
  });
}

group('2', async () => {
  const p = 'pm267g2', c = await observer(), b = await bus(p);
  assert.equal(b.isConnected(), true);
  try {
    assert.throws(() => subscribe(b, () => {}, {}, 'groups.member.*'), /Unsupported/);
    assert.throws(() => subscribe(b, () => {}, {ackMode: 'manual'}), /Only auto/);
    assert.throws(() => subscribe(b, () => {}, {filter: () => true}), /Unsupported/);
    assert.throws(() => subscribe(b, () => {}, {group: 'different'}), /Group must match/);
    assert.throws(() => subscribe(b, () => {}, {deliveryGuarantee: 'exactly-once'}), /Unsupported/);
    const bad = new RedisStreamsEventBus();
    await assert.rejects(bad.connect({url: 'http://redis', source: 'chat', streamPrefix: p, consumerGroup: 'chat', claimIdleMs: 100}));
    const unavailable = new RedisStreamsEventBus();
    await assert.rejects(unavailable.connect({url: 'redis://redis:6380', source: 'chat', streamPrefix: p, consumerGroup: 'chat', claimIdleMs: 100}));
    assert.equal(unavailable.isConnected(), false); await unavailable.close();
    const sub = subscribe(b, () => {}); await sub.ready; assert.equal(sub.active, true);
    const conflict = await bus(p, 'chat', 'chat', {maxDeliveryAttempts: 2});
    const rejected = subscribe(conflict, () => {});
    await assert.rejects(rejected.ready, /GROUP_CONTRACT_CONFLICT/); await rejected.closed;
    assert.equal(rejected.active, false); await conflict.close();
    b.unsubscribe(sub); await sub.closed;
    await record('readiness-and-options', {connected: true, contractConflictRejected: true, failedReadyInactive: true});
  } finally { await b.close(); }
  assert.equal(b.isConnected(), false);
  const stuck = await bus(p+'stuck', 'chat', 'chat', {claimIdleMs: 5000, closeTimeoutMs: 50});
  let release, called = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const sub = subscribe(stuck, async () => { called++; await gate; }); await sub.ready;
  await publish(p+'stuck', {case: 'stuck'}); await until(() => called === 1, 'stuck handler entered');
  await assert.rejects(stuck.close(), /Close timed out/);
  release(); await sub.closed;
  assert.equal((await pending(c,p+'stuck')).length, 1);
  await record('stuck-close', {reportedTimeout: true, handlerExitedAfterRelease: true, pending: await pending(c,p+'stuck')});
  await c.disconnect();
});

group('3', async () => {
  const chat=JSON.parse(await readFile('fixture-contracts/chat.json','utf8'));
  assert.deepEqual(chat.requires.events.filter(t=>t.startsWith('groups.')),TOPICS);
  const p='pm267g3', c=await observer(), a=await bus(p,'chat','chat'), b=await bus(p,'audit','audit');
  const seenA=[],seenB=[], subscriptions=[];
  try {
    for (const topic of TOPICS) {
      subscriptions.push(subscribe(a,e=>seenA.push(e),{},topic),subscribe(b,e=>seenB.push(e),{},topic));
    }
    await Promise.all(subscriptions.map(s=>s.ready));
    const correlationId=randomUUID(),causationId=randomUUID();
    for (const topic of TOPICS) await publish(p,{topic,memberId:'synthetic-member'},
      {idempotencyKey:'transition-'+topic,correlationId,causationId,metadata:{fixture:true},deliveryGuarantee:'at-least-once'},topic);
    await until(()=>seenA.length===5&&seenB.length===5,'both groups all topics');
    assert.deepEqual(seenA.map(e=>e.id).sort(),seenB.map(e=>e.id).sort());
    for(const e of seenA){
      assert.match(e.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.ok(Number.isSafeInteger(e.timestamp)); assert.equal(e.source,'groups');
      assert.equal(e.metadata.idempotencyKey,'transition-'+e.type); assert.equal(e.correlationId,correlationId);
      assert.equal(e.causationId,causationId); assert.equal(e.metadata.fixture,true);
    }
    await publish(p,{topic:T,memberId:'synthetic-member'},{idempotencyKey:'transition-'+T});
    await until(()=>seenA.length===6&&seenB.length===6,'same key second publish delivered');
    const repeated=seenA.filter(e=>e.type===T); assert.notEqual(repeated[0].id,repeated[1].id);
    assert.equal(repeated[0].metadata.idempotencyKey,repeated[1].metadata.idempotencyKey);
    await record('actual-envelopes',{chat:seenA,audit:seenB,allTopics:TOPICS});
  } finally { await a.close();await b.close();await c.disconnect(); }
});

group('2-boundary',async()=>{
  for(const field of ['source','streamPrefix','consumerGroup']) {
    const b=new RedisStreamsEventBus();
    await assert.rejects(b.connect({url:URL,source:'chat',streamPrefix:'pm267types',consumerGroup:'chat',claimIdleMs:100,[field]:true}),/Invalid/);
  }
  const b=await bus('pm267types','groups','publisher');
  await assert.rejects(b.publish(T,{}, {correlationId:[randomUUID()]}),/Invalid/);
  await assert.rejects(b.publish(T,{}, {metadata:null}),/must be an object/);
  await b.close();await record('strict-types',{coercedNamesRejected:3,uuidArrayRejected:true,nullMetadataRejected:true});
});

group('4',async()=>{
  const p='pm267g4',c=await observer(),b=await bus(p,'chat','chat',{claimIdleMs:300});
  let release,attempts=0;const seen=[];const gate=new Promise(r=>{release=r;});
  const sub=subscribe(b,async e=>{seen.push(e);attempts++;if(attempts===1)throw new Error('');
    if(attempts===2)return Promise.reject(new Error('async rejection'));await gate;});
  try{
    await sub.ready;await publish(p,{transition:'retry-value'},{idempotencyKey:'stable-retry'});
    await until(()=>attempts===1,'throw observed');const first=await pending(c,p);assert.equal(first.length,1);
    await record('after-throw',first);
    await until(()=>attempts===2,'rejection observed');const second=await pending(c,p);assert.equal(second.length,1);
    await record('after-rejection',second);
    await until(()=>attempts===3,'async success handler entered');
    await delay(80);assert.equal((await pending(c,p)).length,1);await record('before-awaited-success',await pending(c,p));
    assert.equal(new Set(seen.map(e=>e.id)).size,1);assert.deepEqual(seen.map(e=>e.payload),Array(3).fill({transition:'retry-value'}));
    release();await until(async()=>!(await pending(c,p)).length,'success ack');
    await record('retry-success',{events:seen,attempts,pending:await pending(c,p),source:await entries(c,p)});
  }finally{release();await b.close();await c.disconnect();}
});

group('5-before',async()=>{
  const p='pm267g5',c=await observer();let first=0;
  const a=await bus(p,'chat','chat',{claimIdleMs:300});const sa=subscribe(a,()=>{first++;throw new Error('consumer failed');});
  await sa.ready;await publish(p,{transition:'recreate'},{idempotencyKey:'recreate-key'});
  await until(()=>first===1,'first consumer failed');await a.close();
  const original=await entries(c,p),before=await pending(c,p);assert.equal(before.length,1);
  const b=await bus(p,'chat','chat',{claimIdleMs:300});let recovered;
  const sb=subscribe(b,e=>{recovered=e;});await sb.ready;await until(()=>recovered,'new instance recovery');
  await until(async()=>!(await pending(c,p)).length,'recovery ack');assert.deepEqual(recovered,event(original[0]));await b.close();
  const prefix='pm267restart';const crash=await bus(prefix,'chat','chat',{claimIdleMs:1000});let failed=0;
  const sc=subscribe(crash,()=>{failed++;throw new Error('pending across broker kill');});await sc.ready;
  await publish(prefix,{transition:'aof-retained'},{idempotencyKey:'aof-stable'});await until(()=>failed===1,'pending before kill');await crash.close();
  const snapshot={prefix,source:await entries(c,prefix),pending:await pending(c,prefix)};
  assert.equal(snapshot.pending.length,1);await writeFile(DIR+'/restart-before.json',JSON.stringify(snapshot));
  await record('consumer-recreation',{oldConsumer:sa.id,newConsumer:sb.id,original,recovered});
  await record('broker-before',snapshot);await c.disconnect();
});

group('5-after',async()=>{
  const snapshot=JSON.parse(await readFile(DIR+'/restart-before.json','utf8')),c=await observer();
  assert.deepEqual(await entries(c,snapshot.prefix),snapshot.source);
  const retained=await pending(c,snapshot.prefix);assert.equal(retained.length,1);assert.equal(retained[0][0],snapshot.pending[0][0]);
  assert.equal(retained[0][1],snapshot.pending[0][1]);assert.equal(retained[0][3],snapshot.pending[0][3]);
  const b=await bus(snapshot.prefix,'chat','chat',{claimIdleMs:1000});let received;
  const sub=subscribe(b,e=>{received=e;});await sub.ready;await until(()=>received,'fresh post-restart consumer');
  await until(async()=>!(await pending(c,snapshot.prefix)).length,'post-restart ack');
  assert.deepEqual(received,event(snapshot.source[0]));
  await record('broker-after',{source:await entries(c,snapshot.prefix),retainedBeforeConsumption:retained,received,pending:await pending(c,snapshot.prefix),newConsumer:sub.id});
  await b.close();await c.disconnect();
});

group('6-before',async()=>{
  const p='pm267g6',c=await observer(),bad=await bus(p,'chat','chat',{maxDeliveryAttempts:2}),good=await bus(p,'audit','audit');
  let failures=0,goodEvents=[];
  const a=subscribe(bad,()=>{failures++;throw new Error('terminal synthetic handler failure');});
  const b=subscribe(good,e=>goodEvents.push(e));await Promise.all([a.ready,b.ready]);
  await publish(p,{transition:'poison'},{idempotencyKey:'poison-key',deadLetterTopic:DLQ});
  const dead=await until(async()=>{const rows=await entries(c,p,DLQ);return rows.length?rows:false;},'DLQ commit');
  await until(async()=>!(await pending(c,p)).length&&!(await pending(c,p,'audit')).length,'both groups ack');
  assert.equal(failures,2);assert.equal(goodEvents.length,1);assert.equal(dead.length,1);
  const recordValue=JSON.parse(dead[0][1][1]);assert.equal(recordValue.attempts,2);assert.equal(recordValue.event.id,goodEvents[0].id);
  assert.equal(recordValue.originalEnvelope,JSON.stringify(goodEvents[0]));assert.match(recordValue.cause,/terminal synthetic/);
  await bad.close();await good.close();
  await writeFile(DIR+'/dlq-before.json',JSON.stringify({prefix:p,dead,source:await entries(c,p),record:recordValue}));
  await record('atomic-dlq',{dead,record:recordValue,goodEvents,failures,pending:await pending(c,p),otherPending:await pending(c,p,'audit')});
  const invalid=await bus('pm267invalid','groups','publisher');
  for(const [type,payload,opts] of [[T,null,{}],[T,[],{}],[T,{bad:NaN},{}],[T,{}, {waitForAck:true}],
      [T,{}, {deliveryTier:'compliance-critical'}],[T,{}, {deliveryGuarantee:'exactly-once'}],
      ['groups.unknown.event',{},{}],[T,{}, {unknown:true}],[T,{}, {correlationId:'bad'}]]){
    await assert.rejects(invalid.publish(type,payload,opts));
  }
  assert.equal((await entries(c,'pm267invalid')).length,0);await invalid.close();
  const mismatch=await bus('pm267mismatch');await assert.rejects(mismatch.publish(T,{}),/Source\/topic mismatch/);await mismatch.close();
  const stopped=await bus('pm267stop');let calls=0;const sub=subscribe(stopped,()=>calls++);await sub.ready;
  stopped.unsubscribe(sub);await sub.closed;await publish('pm267stop',{later:true});await delay(200);assert.equal(calls,0);await stopped.close();
  const malformed=await bus('pm267malformed','chat','chat',{maxDeliveryAttempts:1});let malformedCalls=0;
  const sm=subscribe(malformed,()=>malformedCalls++);await sm.ready;
  await c.sendCommand(['XADD',stream('pm267malformed'),'*','event','{"type":"groups.unknown.event"}']);
  await until(async()=>(await entries(c,'pm267malformed',DLQ)).length===1,'malformed DLQ');
  assert.equal(malformedCalls,0);await malformed.close();
  await record('malformed-and-stop',{malformedHandlerCalls:malformedCalls,malformedDLQ:await entries(c,'pm267malformed',DLQ),callsAfterUnsubscribe:calls});
  await c.disconnect();
});

group('6-after',async()=>{
  const snapshot=JSON.parse(await readFile(DIR+'/dlq-before.json','utf8')),c=await observer();
  assert.deepEqual(await entries(c,snapshot.prefix,DLQ),snapshot.dead);
  assert.deepEqual(await entries(c,snapshot.prefix),snapshot.source);
  assert.equal((await pending(c,snapshot.prefix)).length,0);
  const b=await bus(snapshot.prefix,'chat','chat',{maxDeliveryAttempts:2});let calls=0;
  const sub=subscribe(b,()=>calls++);await sub.ready;await delay(300);await b.close();
  assert.equal(calls,0);assert.deepEqual(await entries(c,snapshot.prefix,DLQ),snapshot.dead);
  await record('dlq-after-broker-crash',{dead:await entries(c,snapshot.prefix,DLQ),pending:await pending(c,snapshot.prefix),handlerCalls:calls});
  await c.disconnect();
});

// Entry point: node lib/server.mjs. Configuration comes from the environment only.
import { delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRegistry, createGateway, loadKeyFile, loadManifests, providerBusFactory } from './gateway.mjs';

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(name + ' must be an integer ' + min + '..' + max);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is required');
  return value;
}

export async function startFromEnv() {
  const manifests = loadManifests(required('BUS_GATEWAY_MANIFESTS').split(delimiter).filter(Boolean));
  const registry = buildRegistry({ keys: loadKeyFile(required('BUS_GATEWAY_KEYS_FILE')), manifests });
  const providerPath = process.env.BUS_GATEWAY_PROVIDER
    ? pathToFileURL(process.env.BUS_GATEWAY_PROVIDER).href
    : new URL('../../eventbus-redis/lib/eventbus-redis.mjs', import.meta.url).href;
  const gateway = createGateway({
    registry,
    busFactory: providerBusFactory({
      providerUrl: providerPath,
      redisUrl: required('BUS_GATEWAY_REDIS_URL'),
      streamPrefix: process.env.BUS_GATEWAY_STREAM_PREFIX || 'eventbus',
      claimIdleMs: intEnv('BUS_GATEWAY_CLAIM_IDLE_MS', 30000, 1, 60000),
      passwordFile: process.env.BUS_GATEWAY_REDIS_PASSWORD_FILE || undefined,
      username: process.env.BUS_GATEWAY_REDIS_USERNAME || undefined,
    }),
    publishTimeoutMs: intEnv('BUS_GATEWAY_PUBLISH_TIMEOUT_MS', 5000, 1, 60000),
    connectTimeoutMs: intEnv('BUS_GATEWAY_CONNECT_TIMEOUT_MS', 5000, 1, 60000),
  });
  const host = process.env.BUS_GATEWAY_HOST || '127.0.0.1';
  const address = await gateway.listen(intEnv('BUS_GATEWAY_PORT', 8080, 0, 65535), host);
  process.stderr.write(JSON.stringify({ t: new Date().toISOString(), event: 'listening', host: address.address,
    port: address.port, modules: registry.map(e => e.module) }) + '\n');
  return gateway;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startFromEnv().then(gateway => {
    const stop = () => gateway.close().finally(() => process.exit(0));
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }, error => {
    process.stderr.write(JSON.stringify({ t: new Date().toISOString(), event: 'startup_failed', error: error.message }) + '\n');
    process.exit(1);
  });
}

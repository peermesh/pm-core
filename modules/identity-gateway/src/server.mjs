import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createVerifier } from './identity.mjs';
import { createBrowserAuth } from './browser.mjs';
import { createGateway } from './gateway.mjs';

const fixture = process.env.IDENTITY_FIXTURE === '1';
const tenantKey = fixture ? process.env.IDENTITY_TENANT_KEY :
  readFileSync(process.env.IDENTITY_TENANT_KEY_FILE || '/run/secrets/identity_tenant_key', 'utf8').trim();
const verify = createVerifier({
  issuer: 'https://peers.social', origin: process.env.IDENTITY_SOCIAL_ORIGIN || 'https://peers.social',
  audience: process.env.IDENTITY_AUDIENCE, tenantId: process.env.IDENTITY_TENANT_ID,
  propertyId: process.env.IDENTITY_PROPERTY_ID, tenantKey, fixture,
});
const browser = createBrowserAuth({
  origins: (process.env.IDENTITY_BROWSER_ORIGINS || '').split(',').filter(Boolean),
  providerOrigin: process.env.IDENTITY_SOCIAL_ORIGIN || 'https://peers.social',
  clientId: process.env.IDENTITY_AUDIENCE, fixture,
}, { verify });
const secret = name => fixture ? process.env[name] : readFileSync(process.env[name + '_FILE'], 'utf8').trim();
const gateway = createGateway({
  modules: {
    publisher: { host: process.env.PUBLISHER_HOST, secret: secret('PUBLISHER_GATEWAY_SECRET') },
    media: { host: process.env.MEDIA_HOST, secret: secret('MEDIA_GATEWAY_SECRET') },
    podcast: { host: process.env.PODCAST_HOST, secret: secret('PODCAST_GATEWAY_SECRET') },
  },
  operatorOrigin: 'http://authentik-server:9000',
}, { authorize: browser.authorize });
const server = createServer({ maxHeaderSize: 24576 }, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain');
  // This endpoint only permits Traefik's regex removal of caller headers.
  // It authenticates nobody and never emits any identity or credential.
  if (req.method === 'GET' && (req.url === '/strip' || req.url === '/health')) {
    res.writeHead(204).end(); return;
  }
  try {
    if (req.url.startsWith('/_core/')) {
      const result = await browser.handle(req);
      res.writeHead(result.status, result.headers).end(result.body); return;
    }
    if (req.method !== 'GET') throw new Error('unauthorized');
    if (req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'authorization').length > 1) {
      throw new Error('unauthorized');
    }
    const headers = await gateway(req.url, req.headers);
    res.writeHead(204, headers).end();
  } catch (error) {
    // Never serialize token, provider response, request URL or exception text.
    if (error.status === 403) { res.writeHead(403).end('Forbidden'); return; }
    if (req.headers.accept?.includes('text/html')) {
      const result = browser.loginRequired(req.headers);
      res.writeHead(401, result.headers).end(result.body); return;
    }
    res.writeHead(401).end('Unauthorized');
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(8080, '0.0.0.0');

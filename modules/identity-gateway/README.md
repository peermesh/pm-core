# Core Identity Gateway

Traefik forward-auth target for module user routes (WO-PMSYS-20261023-235).
It is the accepted WO-235 runtime snapshot, adopted into Core with Podcast
added. Not deployed: no production router uses it yet.

## What it does

`GET /verify/<module>` with `<module>` = `publisher`, `media` or `podcast`:

1. Checks the forwarded request: `X-Forwarded-Proto: https`, `X-Forwarded-Host`
   equal to that module's host, a valid `X-Forwarded-Method` and `X-Forwarded-Uri`.
2. Refuses paths that must never carry the user hop credential:
   - Media: `/api/media/{id}/stream`.
   - Podcast: `/api/podcast/cron`, `/api/webhooks/events`, `/api/maintenance/cleanup`.
3. Authenticates the caller:
   - `Authorization: Bearer <peers.social access token>`: RS256, verified with
     the provider JWKS, issuer `https://peers.social`, audience = tenant ID,
     `token_use: access`, at most one hour long.
   - or the Core browser session cookie `__Host-pm_session` (routes under `/_core/auth/`).
   - A request that changes state (not GET, HEAD or OPTIONS) with no bearer token
     must carry a same-origin `Origin`, otherwise 403.
4. Calls `/api/platform/auth/profile` on the provider on every request (no
   identity cache), so a revoked session fails at once.
5. Answers 204 with `X-Peermesh-Auth-Subject`, `X-Peermesh-Actor-WebID`,
   `X-Peermesh-Tenant-ID`, `X-Peermesh-Property-ID`, `X-Peermesh-Roles` and
   `X-Module-Secret` (that module's hop secret). Otherwise 401 (403 for a
   failed CSRF check). Errors never echo the token, URL or provider answer.

`GET /verify/<module>/operator` re-checks the caller with Authentik
(`http://authentik-server:9000`, fixed) and answers only `X-Module-Secret`.
`GET /health` and `GET /strip` answer 204 and authenticate nobody.

## Configuration

Startup fails when any of these is wrong:

- `IDENTITY_AUDIENCE` = `IDENTITY_TENANT_ID`, `IDENTITY_PROPERTY_ID`, and the
  tenant key file (`IDENTITY_TENANT_KEY_FILE`, at least 32 characters).
- `IDENTITY_BROWSER_ORIGINS`: 1 to 8 https origins, never `https://peers.social`.
- `PUBLISHER_HOST`, `MEDIA_HOST`, `PODCAST_HOST`: lower-case host names, all
  different, never `peers.social`.
- `PUBLISHER_GATEWAY_SECRET_FILE`, `MEDIA_GATEWAY_SECRET_FILE`,
  `PODCAST_GATEWAY_SECRET_FILE`: one secret per module, 32 to 1024 printable
  ASCII characters, all different.

`IDENTITY_FIXTURE=1` is for tests only: it reads values from the environment
and allows the provider origin `http://idp-check-social`.

## Deployment shape

`docker-compose.yml` (profile `identity-gateway`): no host port, no proxy
labels, read-only, all capabilities dropped, one internal network
`pmdl_edge-control`. Only Traefik may join that network. Before a rollout:

- attach Traefik to `pmdl_edge-control`;
- the network has no internet access, but the gateway calls
  `https://peers.social`. Give Traefik the alias `peers.social` on that network,
  or change the design;
- create the four secret files listed in `secrets-required.txt`.

The staged Traefik routes for Podcast and Media, and the loopback harness
that proves them, are in
`~/work/peermesh/repo/peermesh-core/.dev/ai/staging/WO-PMSYS-20261023-235/2026-11-14-podcast-edge/`.

## Provenance

`src/browser.mjs` and `src/identity.mjs` are byte-identical to the snapshot in
`~/work/peermesh/repo/peermesh-system/.dev/ai/subtask-comms/2026-10-26-04-00-34Z-prospective-combined235/core-runtime-source/`.
`src/gateway.mjs` and `src/server.mjs` differ only by the Podcast change:
the `/verify/podcast` route, the `podcast` module entry, the Podcast
service-only refusals, distinct secrets across modules, and a type check on hosts.

## Tests

```
node --test tests/gateway.test.mjs tests/identity.test.mjs
```

# Third-party notices

## Scope

This repository combines **original PeerMesh materials** (licensed under PolyForm Noncommercial 1.0.0; see [`LICENSE`](LICENSE)) with **third-party components**. Third-party software, data, and container images **remain under their own licenses**. The project license does **not** apply to them and does **not** grant rights to third-party trademarks.

This file includes a **machine-assisted inventory** (compose image lines, Go `require` summaries, npm lockfile packages). It is **not** a complete legal attribution list. Maintain a full bill of materials for production distributions (for example via SBOM tools). See [`DEPENDENCY-LICENSE-POLICY.md`](DEPENDENCY-LICENSE-POLICY.md).

## Container images and runtime services

Docker Compose profiles pull upstream images (for example reverse proxy, databases, caches, object storage, observability). Each image is subject to its **upstream license** and notices on the registry or inside the image. The **Automated inventory** section lists `image:` references found under this tree.

## Go modules

Go code under `services/` uses modules declared in `go.mod`. Third-party modules are listed in the **Automated inventory** section when present.

## JavaScript / Node dependencies

Projects using `package-lock.json` list resolved packages (with SPDX `license` fields when present) in the **Automated inventory** section.

## OpenTofu / Terraform providers

Infrastructure code under `infra/opentofu/` uses providers and modules governed by their respective licenses and provider terms.

## Example and template content

`examples/`, `foundation/templates/`, and similar paths may reference **upstream patterns** or **sample applications**. Treat those as separate projects for licensing when copied or deployed.

## Automated inventory (generated)

Regenerate locally:

```bash
./scripts/generate-third-party-notices.sh --write   # from repo root (parent)
# or, from sub-repos/core:
./scripts/generate-third-party-notices.sh --write
```

## Container images (compose)

Extracted from `docker-compose*.yml` / `docker-compose*.yaml` under this tree (sorted, de-duplicated by image).

### `${COMPOSE_PROJECT_NAME:-pmdl}-webhook:${WEBHOOK_IMAGE_TAG:-0.1.0}`
- `docker-compose.webhook.yml`

### `[image]:[tag]`
- `profiles/_template/docker-compose.example.yml`

### `alpine@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659`
- `examples/matrix/docker-compose.matrix.yml`

### `alpine@sha256:6baf43584bcb78f2e5847d1de515f23499913ac9f12bdf834811a3145eb11ca1`
- `foundation/templates/module-template/docker-compose.yml`
- `modules/test-module/docker-compose.yml`

### `chocobozzz/peertube@sha256:011b0ec43d921bd60a3aa01fc7995e42cf15275925f16bee6f17a6c896ca5060`
- `examples/peertube/docker-compose.peertube.yml`

### `ghcr.io/danny-avila/librechat-dev@sha256:2cca5314474da68ef6366acf692dfe4993d9b83316c737085e4abdd2c1927239`
- `examples/librechat/docker-compose.librechat.yml`

### `ghcr.io/mastodon/mastodon@sha256:1b385b58aff828988fcf22d449f167da612f56558816bd5d08a1a3db4327cc02`
- `modules/mastodon/docker-compose.yml`

### `ghost@sha256:3ffcb8f2f1f808806e7a0f694a2b130cd78652a26b4337b33fe7e249ce58665a`
- `examples/ghost/docker-compose.ghost.yml`

### `grafana/grafana:10.4.2`
- `profiles/observability-full/docker-compose.observability-full.yml`

### `grafana/loki:2.9.6`
- `profiles/observability-full/docker-compose.observability-full.yml`

### `kennethreitz/httpbin@sha256:599fe5e5073102dbb0ee3dbb65f049dab44fa9fc251f6835c9990f8fb196a72b`
- `examples/python-api/docker-compose.python-api.yml`

### `listmonk/listmonk@sha256:bf3903d54a468ba0544629b474a9c78714b1419ba9f89e186590264fa40d4ea1`
- `examples/listmonk/docker-compose.listmonk.yml`

### `louislam/uptime-kuma@sha256:3d632903e6af34139a37f18055c4f1bfd9b7205ae1138f1e5e8940ddc1d176f9`
- `profiles/observability-lite/docker-compose.observability-lite.yml`

### `matrixdotorg/synapse@sha256:339b18c57de915e0746d0ae1d4e425e914e4ee034763a37bd5c4e63723582c8c`
- `examples/matrix/docker-compose.matrix.yml`

### `minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`
- `docker-compose.yml`
- `profiles/minio/docker-compose.minio.yml`

### `mitmproxy/mitmproxy:latest`
- `profiles/dev-security/docker-compose.dev-security.yml`

### `mongo@sha256:03cda579c8caad6573cb98c2b3d5ff5ead452a6450561129b89595b4b9c18de2`
- `docker-compose.yml`

### `mongo@sha256:f2b40853c0f796b105e672e04045d2b3e127bd54782dfe7e9b08aebbd9f602ce`
- `profiles/mongodb/docker-compose.mongodb.yml`

### `mysql@sha256:64756cc92f707eb504496d774353990bcb0f6999ddf598b6ad188f2da66bd000`
- `docker-compose.yml`
- `profiles/mysql/docker-compose.mysql.yml`

### `nats:2-alpine`
- `profiles/nats/docker-compose.nats.yml`

### `netdata/netdata@sha256:4cbe33f6fc317a7f5c453c8b4997316e4e320a7abd8cc921cecba98f2a5cbcf5`
- `profiles/observability-lite/docker-compose.observability-lite.yml`

### `nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`
- `modules/hello-core/docker-compose.yml`
- `modules/hello-custom/docker-compose.yml`

### `nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`
- `docker-compose.dc.yml`

### `nginx@sha256:dec7a90bd0973b076832dc56933fe876bc014929e14b4ec49923951405370112`
- `examples/landing/docker-compose.landing.yml`

### `oliver006/redis_exporter@sha256:6a97d4dd743b533e1f950c677b87d880e44df363c61af3f406fc9e53ed65ee03`
- `profiles/redis/docker-compose.redis.yml`

### `opensearchproject/opensearch@sha256:b35ccb8fbda049fe1cf4a935907365fc2009c41453c0e28597aed3b31d046c4f`
- `modules/mastodon/docker-compose.yml`

### `organization/myapp:1.0.0`
- `examples/_template/docker-compose.template.yml`

### `pgvector/pgvector@sha256:7d400e340efb42f4d8c9c12c6427adb253f726881a9985d2a471bf0eed824dff`
- `docker-compose.yml`
- `profiles/postgresql/docker-compose.postgresql.yml`

### `pmdl/backup:latest`
- `modules/backup/docker-compose.yml`

### `pmdl/dashboard:${DASHBOARD_IMAGE_TAG:-0.1.0}`
- `docker-compose.yml`

### `prom/prometheus:v2.51.2`
- `profiles/observability-full/docker-compose.observability-full.yml`

### `redis@sha256:8b81dd37ff027bec4e516d41acfbe9fe2460070dc6d4a4570a2ac5b9d59df065`
- `docker-compose.yml`
- `examples/peertube/docker-compose.peertube.yml`
- `profiles/redis/docker-compose.redis.yml`

### `restic/restic@sha256:63e86f6726e2afcd49c882d2fc67ae483a38a1ffcb50cbf5f474bd11f5129217`
- `profiles/backup/docker-compose.backup.yml`

### `smallstep/step-ca@sha256:56e4b440afaf243c43c25112204b5433edfcc2581971ff3c90c2af630015fd7a`
- `modules/pki/docker-compose.yml`

### `solidproject/community-server@sha256:47260bc766cc11da881ca037e2ea672f853344c232577597a1fcbbceac76c3ef`
- `examples/solid/docker-compose.solid.yml`
- `profiles/identity/docker-compose.identity.yml`

### `tecnativa/docker-socket-proxy@sha256:1f3a6f303320723d199d2316a3e82b2e2685d86c275d5e3deeaf182573b47476`
- `docker-compose.yml`

### `traefik/whoami@sha256:1699d99cb4b9acc17f74ca670b3d8d0b7ba27c948b3445f0593b58ebece92f04`
- `modules/federation-adapter/docker-compose.yml`

### `traefik@sha256:a6e718e8f84d4e45282a53a8e7338ab74372abac3ff78f9261a015bc8b45be95`
- `docker-compose.yml`

### `vectorim/element-web@sha256:3f031bba174a062d21dcb506662031ce717586c05c03d018063c19470941ac70`
- `examples/matrix/docker-compose.matrix.yml`

### `wordpress@sha256:ee74dc0ebbe7ec43b7f473c0fb4f1dfb6b211d7785f0a95bcdfa10e628c2e67f`
- `examples/wordpress/docker-compose.wordpress.yml`

## Go modules

### `services/dashboard/go.mod`

_No third-party `require` entries (stdlib / empty module list)._

## npm packages (package-lock.json)

### `modules/social/app/package-lock.json`

- `@bergos/jsonparse` @ `1.4.2` — license: `MIT`
- `@emnapi/runtime` @ `1.9.1` — license: `MIT`
- `@img/sharp-darwin-arm64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-darwin-x64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-libvips-darwin-arm64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-darwin-x64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linux-arm` @ `1.0.5` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linux-arm64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linux-s390x` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linux-x64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linuxmusl-arm64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-libvips-linuxmusl-x64` @ `1.0.4` — license: `LGPL-3.0-or-later`
- `@img/sharp-linux-arm` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-linux-arm64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-linux-s390x` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-linux-x64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-linuxmusl-arm64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-linuxmusl-x64` @ `0.33.5` — license: `Apache-2.0`
- `@img/sharp-wasm32` @ `0.33.5` — license: `Apache-2.0 AND LGPL-3.0-or-later AND MIT`
- `@img/sharp-win32-ia32` @ `0.33.5` — license: `Apache-2.0 AND LGPL-3.0-or-later`
- `@img/sharp-win32-x64` @ `0.33.5` — license: `Apache-2.0 AND LGPL-3.0-or-later`
- `@inrupt/solid-client` @ `2.1.2` — license: `MIT`
- `@inrupt/solid-client-authn-core` @ `2.5.0` — license: `MIT`
- `@inrupt/solid-client-authn-core/node_modules/uuid` @ `11.1.0` — license: `MIT`
- `@inrupt/solid-client-authn-node` @ `2.5.0` — license: `MIT`
- `@inrupt/solid-client-authn-node/node_modules/uuid` @ `11.1.0` — license: `MIT`
- `@inrupt/solid-client-errors` @ `0.0.2`
- `@inrupt/vocab-common-rdf` @ `1.0.5` — license: `MIT`
- `@noble/curves` @ `1.9.7` — license: `MIT`
- `@noble/hashes` @ `1.8.0` — license: `MIT`
- `@rdfjs/data-model` @ `1.3.4` — license: `MIT`
- `@rdfjs/dataset` @ `1.1.1` — license: `MIT`
- `@rdfjs/types` @ `2.0.1` — license: `MIT`
- `@types/http-link-header` @ `1.0.7` — license: `MIT`
- `@types/node` @ `25.5.0` — license: `MIT`
- `@types/readable-stream` @ `4.0.23` — license: `MIT`
- `abort-controller` @ `3.0.0` — license: `MIT`
- `agent-base` @ `7.1.4` — license: `MIT`
- `asn1.js` @ `5.4.1` — license: `MIT`
- `base64-js` @ `1.5.1` — license: `MIT`
- `bn.js` @ `4.12.3` — license: `MIT`
- `buffer` @ `6.0.3` — license: `MIT`
- `buffer-equal-constant-time` @ `1.0.1` — license: `BSD-3-Clause`
- `busboy` @ `1.6.0`
- `canonicalize` @ `1.0.8` — license: `Apache-2.0`
- `color` @ `4.2.3` — license: `MIT`
- `color-convert` @ `2.0.1` — license: `MIT`
- `color-name` @ `1.1.4` — license: `MIT`
- `color-string` @ `1.9.1` — license: `MIT`
- `debug` @ `4.4.3` — license: `MIT`
- `detect-libc` @ `2.1.2` — license: `Apache-2.0`
- `ecdsa-sig-formatter` @ `1.0.11` — license: `Apache-2.0`
- `event-target-shim` @ `5.0.1` — license: `MIT`
- `events` @ `3.3.0` — license: `MIT`
- `fsevents` @ `2.3.3` — license: `MIT`
- `http-link-header` @ `1.1.3` — license: `MIT`
- `http_ece` @ `1.2.0` — license: `MIT`
- `https-proxy-agent` @ `7.0.6` — license: `MIT`
- `ieee754` @ `1.2.1` — license: `BSD-3-Clause`
- `inherits` @ `2.0.4` — license: `ISC`
- `is-arrayish` @ `0.3.4` — license: `MIT`
- `jose` @ `5.10.0` — license: `MIT`
- `jsonld-context-parser` @ `3.1.0` — license: `MIT`
- `jsonld-context-parser/node_modules/@types/node` @ `18.19.130` — license: `MIT`
- `jsonld-context-parser/node_modules/undici-types` @ `5.26.5` — license: `MIT`
- `jsonld-streaming-parser` @ `4.0.1` — license: `MIT`
- `jwa` @ `2.0.1` — license: `MIT`
- `jws` @ `4.0.1` — license: `MIT`
- `lru-cache` @ `6.0.0` — license: `ISC`
- `minimalistic-assert` @ `1.0.1` — license: `ISC`
- `minimist` @ `1.2.8` — license: `MIT`
- `ms` @ `2.1.3` — license: `MIT`
- `n3` @ `1.26.0` — license: `MIT`
- `object-hash` @ `2.2.0` — license: `MIT`
- `oidc-token-hash` @ `5.2.0` — license: `MIT`
- `openid-client` @ `5.7.1` — license: `MIT`
- `openid-client/node_modules/jose` @ `4.15.9` — license: `MIT`
- `pg` @ `8.20.0` — license: `MIT`
- `pg-cloudflare` @ `1.3.0` — license: `MIT`
- `pg-connection-string` @ `2.12.0` — license: `MIT`
- `pg-int8` @ `1.0.1` — license: `ISC`
- `pg-pool` @ `3.13.0` — license: `MIT`
- `pg-protocol` @ `1.13.0` — license: `MIT`
- `pg-types` @ `2.2.0` — license: `MIT`
- `pgpass` @ `1.0.5` — license: `MIT`
- `postgres-array` @ `2.0.0` — license: `MIT`
- `postgres-bytea` @ `1.0.1` — license: `MIT`
- `postgres-date` @ `1.0.7` — license: `MIT`
- `postgres-interval` @ `1.2.0` — license: `MIT`
- `process` @ `0.11.10` — license: `MIT`
- `rdf-data-factory` @ `1.1.3` — license: `MIT`
- `rdf-data-factory/node_modules/@rdfjs/types` @ `1.1.2` — license: `MIT`
- `readable-stream` @ `4.7.0` — license: `MIT`
- `relative-to-absolute-iri` @ `1.0.8` — license: `MIT`
- `safe-buffer` @ `5.2.1` — license: `MIT`
- `safer-buffer` @ `2.1.2` — license: `MIT`
- `semver` @ `7.7.4` — license: `ISC`
- `sharp` @ `0.33.5` — license: `Apache-2.0`
- `simple-swizzle` @ `0.2.4` — license: `MIT`
- `split2` @ `4.2.0` — license: `ISC`
- `streamsearch` @ `1.1.0`
- `string_decoder` @ `1.3.0` — license: `MIT`
- `tslib` @ `2.8.1` — license: `0BSD`
- `undici-types` @ `7.18.2` — license: `MIT`
- `uuid` @ `10.0.0` — license: `MIT`
- `web-push` @ `3.6.7` — license: `MPL-2.0`
- `xtend` @ `4.0.2` — license: `MIT`
- `yallist` @ `4.0.0` — license: `ISC`

### `tests/lib/bats-assert/package-lock.json`

- `bats` @ `1.9.0`
- `bats-support` @ `0.3.0`

### `tests/lib/bats-support/package-lock.json`

- `bats` @ `1.1.0`

_Generator version: third-party-notices v1 (bash + python3 stdlib)._


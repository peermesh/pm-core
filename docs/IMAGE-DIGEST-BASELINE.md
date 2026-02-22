# Image Digest Baseline

Last updated: 2026-02-22

This file records the immutable image references currently used by Docker Lab compose definitions.

## External Images (Digest-Pinned)

- `alpine@sha256:6baf43584bcb78f2e5847d1de515f23499913ac9f12bdf834811a3145eb11ca1`
- `alpine@sha256:a4f4213abb84c497377b8544c81b3564f313746700372ec4fe84653e4fb03805`
- `chocobozzz/peertube@sha256:011b0ec43d921bd60a3aa01fc7995e42cf15275925f16bee6f17a6c896ca5060`
- `ghcr.io/danny-avila/librechat-dev@sha256:3db851096c0a7fbc3f2b3e41f7baed03203cd4a8c4cdde6e2c8ff0fa49efab9c`
- `ghcr.io/mastodon/mastodon@sha256:1b385b58aff828988fcf22d449f167da612f56558816bd5d08a1a3db4327cc02`
- `ghost@sha256:a0506f3f05f5bdc6c950c5113cdcdb1e1f96fbf15f6dc0a39fc093c25348bdb5`
- `kennethreitz/httpbin@sha256:599fe5e5073102dbb0ee3dbb65f049dab44fa9fc251f6835c9990f8fb196a72b`
- `listmonk/listmonk@sha256:bf3903d54a468ba0544629b474a9c78714b1419ba9f89e186590264fa40d4ea1`
- `louislam/uptime-kuma@sha256:3d632903e6af34139a37f18055c4f1bfd9b7205ae1138f1e5e8940ddc1d176f9`
- `matrixdotorg/synapse@sha256:657cfa115c71701d188f227feb9d1c0fcd2213b26fcc1afd6c647ba333582634`
- `minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`
- `mongo@sha256:03cda579c8caad6573cb98c2b3d5ff5ead452a6450561129b89595b4b9c18de2`
- `mongo@sha256:81ed620b45935fb49704010b75d3fa73df547f71323cfdba49323a64412253a4`
- `mysql@sha256:a3dff78d876222746a0bacc36dd7e4bf9e673c85fb7ee0d12ed25bd32c43c19b`
- `netdata/netdata@sha256:4cbe33f6fc317a7f5c453c8b4997316e4e320a7abd8cc921cecba98f2a5cbcf5`
- `nginx@sha256:1d13701a5f9f3fb01aaa88cef2344d65b6b5bf6b7d9fa4cf0dca557a8d7702ba`
- `nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`
- `oliver006/redis_exporter@sha256:0a0b4058d3698421bf341fc399258fea46df377ac78ed469ba315821b3173b00`
- `opensearchproject/opensearch@sha256:cbca8e35fb333af938289ac0f370abdcbde46dbe7629acc1af0cd4219da85b62`
- `pgvector/pgvector@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337`
- `redis@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`
- `restic/restic@sha256:63e86f6726e2afcd49c882d2fc67ae483a38a1ffcb50cbf5f474bd11f5129217`
- `smallstep/step-ca@sha256:de5d0c3fa983b27a7ec09f1fa403b4fb90932f011840a191b1283b90d24edf11`
- `solidproject/community-server@sha256:a31b765631739ee20bed42829268a93c8dc698c343adba9130545e49551d1756`
- `solidproject/community-server@sha256:bffc8d4a9fdf122ae4c1b1a0558598216bb78d1fc75cb054dc5daaab10bcbd8a`
- `tecnativa/docker-socket-proxy@sha256:083bd0ed8783e366d745f332f0e4489816dd35d984bef8f16e6d89484a22c082`
- `traefik/whoami@sha256:200689790a0a0ea48ca45992e0450bc26ccab5307375b41c84dfc4f2475937ab`
- `traefik@sha256:05ff868caaf67ef937b3228d4fe734ef8a353eab2123ac54f2a7b622d1d4b270`
- `vectorim/element-web@sha256:827ae9ebea5ec0eeb487660f4f04e5789b666667f17a0d63b5c0e4ad8b9b9ca1`
- `wordpress@sha256:1e6215749283955d5c9ffea6c297651ed23cdfdbb91677ad7abd705b2682f2cf`

## Local Build Images

- `pmdl/dashboard:${DASHBOARD_IMAGE_TAG:-0.1.0}`
- `${COMPOSE_PROJECT_NAME:-pmdl}-webhook:${WEBHOOK_IMAGE_TAG:-0.1.0}`

## Refresh Procedure

1. Resolve new digest from a reviewed tag:

```bash
docker buildx imagetools inspect <image:tag> --format '{{json .Manifest.Digest}}'
```

2. Update compose files intentionally.
3. Run:

```bash
./scripts/security/validate-image-policy.sh --strict
./scripts/security/validate-supply-chain.sh --severity-threshold HIGH --strict
```

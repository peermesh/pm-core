# Multi-Domain Pattern

Docker Lab supports hosting multiple domains on one VPS via Compose override files.

## Baseline Decision

- First domain target: `distributedcreators.org`
- SSL strategy: HTTP challenge via existing Traefik resolver (`letsencrypt`)
- DNS challenge is deferred until wildcard/subdomain scaling requires it

## Files

- `docker-compose.yml` - foundation stack
- `docker-compose.dc.yml` - distributedcreators.org override
- `domains/distributedcreators.org/dist/` - static site content
- `domains/distributedcreators.org/nginx.conf` - nginx server config

## Run Locally

```bash
docker compose -f docker-compose.yml -f docker-compose.dc.yml config -q
docker compose -f docker-compose.yml -f docker-compose.dc.yml up -d
```

## `.env` Requirements

```dotenv
DOMAIN=example.com
DC_DOMAIN=distributedcreators.org
PM_DOMAIN=peermesh.org
```

## Adding Another Domain

1. Create `docker-compose.<domain>.yml` override
2. Add domain content/config directory under `domains/<domain>/`
3. Add host variable to `.env` and `.env.example`
4. Validate merged config:
```bash
docker compose -f docker-compose.yml -f docker-compose.<domain>.yml config -q
```

## Deployment Note

Keep multi-domain rollout behind the same validation path as base deploy:

```bash
./scripts/deploy.sh --validate -f docker-compose.dc.yml
```

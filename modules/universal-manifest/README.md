# Universal Manifest Module

Cross-cutting identity document infrastructure for the PeerMesh ecosystem.

## What It Does

The Universal Manifest (UM) module owns the complete lifecycle of Universal Manifests within a PeerMesh deployment. It provides:

- **Manifest CRUD API** -- create, read, update, revoke manifests
- **Facet Registry** -- register facet names with authorized writer modules
- **Signing Infrastructure** -- Ed25519 keypair management, JCS (RFC 8785) canonicalization, v0.2 signature profile
- **UMID Resolver** -- `um.${DOMAIN}/{UMID}` resolution (same contract as myum.net)
- **Service Discovery** -- `/.well-known/myum-resolver.json`

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env: set DOMAIN to your actual domain

# 2. Install (creates database, runs migrations, sets up secrets)
./hooks/install.sh

# 3. Start
./hooks/start.sh

# 4. Verify
./hooks/health.sh
```

## API Endpoints

### Manifest CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/um/manifest` | Create manifest for a subject |
| GET | `/api/um/manifest/:umid` | Get by UMID |
| GET | `/api/um/manifest/subject/:webid` | Get by subject WebID |
| PUT | `/api/um/manifest/:umid/facet/:name` | Write/update facet |
| DELETE | `/api/um/manifest/:umid` | Revoke |
| POST | `/api/um/manifest/:umid/sign` | Re-sign |
| POST | `/api/um/manifest/verify` | Verify signature |

### Facet Registry

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/um/facets/register` | Register facet + authorized writer |
| GET | `/api/um/facets` | List all registered facets |

### Resolver

| Method | Path | Description |
|--------|------|-------------|
| GET | `/:umid` | Resolve manifest by UMID |
| GET | `/.well-known/myum-resolver.json` | Service discovery |
| GET | `/health` | Health check |

## Facet Write Authorization

Each consuming module registers which facets it can write. Unauthorized writes are rejected with 403.

| Module | Authorized Facets |
|--------|-------------------|
| social-lab | publicProfile, socialIdentity, socialGraph, protocolStatus |
| did-wallet | credentials, verifiableCredentials |
| spatial-fabric | spatialAnchors, placeMembership, crossWorldProfile |

## Architecture

- **Port:** 4200 (internal)
- **Database:** PostgreSQL, schema `um`
- **Traefik domain:** `um.${DOMAIN}` (e.g., `um.peers.social`)
- **Signing:** Ed25519 + JCS (RFC 8785) -- UM v0.2 spec
- **Contract:** myum-resolver/v0.1

## Configuration

See `.env.example` for all configuration options.

## Related

- [Universal Manifest Spec](https://universalmanifest.net/spec/v02/)
- Blueprint: F-033
- Proposal: PROP-PMSL-2026-03-23-004

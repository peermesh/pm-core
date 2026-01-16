# PROPOSAL: Identity Provider Support in Docker Lab

**Requesting Project**: Peer Mesh Social Lab
**Priority**: High

## Objective
Enable a "Managed Identity System" (Community Solid Server) to run on top of the Docker Lab foundation.

## Requirements

### 1. Network Access
The Identity Provider needs to be accessible via:
- **Public Internet**: `https://id.domain.com` (via Traefik)
- **Private Network**: `http://identity-provider:3000` (for internal app access) -> `pmdl_app-internal`

### 2. Persistent Storage
We need robust volume management for:
- User Pods (`/data`)
- Config (`/config`)

### 3. Email/SMTP Service
Password reset functionality requires an SMTP relay (Mailhog in dev, external in prod).

## Requested Configuration
Please create a new **Service Profile** in Docker Lab: `profiles/identity/docker-compose.identity.yml`.

```yaml
services:
  identity-provider:
    image: solidproject/community-server:7.0
    container_name: pmdl_identity
    restart: unless-stopped
    command:
      - "-c"
      - "config/file.json"
      - "-f"
      - "/data"
    volumes:
      - pmdl_identity_data:/data
      - ./configs/identity:/config
    networks:
      - proxy-external  # For Traefik
      - app-internal    # For User Account Module
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.idp.rule=Host(`id.${DOMAIN}`)"
      - "traefik.http.routers.idp.entrypoints=websecure"
      - "traefik.http.routers.idp.tls.certresolver=letsencrypt"
```

## Action Items
1.  Create `profiles/identity/` directory.
2.  Add `docker-compose.identity.yml`.
3.  Add `configs/identity/` template.

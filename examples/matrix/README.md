# Matrix Synapse + Element Web Example

Matrix Synapse is the reference homeserver implementation for the Matrix decentralized communication protocol. This example demonstrates how to deploy Synapse with PostgreSQL, federation support, OIDC authentication via Authelia, and Element Web client for browser access.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | Matrix Synapse (latest) + Element Web (latest) |
| **Database** | PostgreSQL 16 (required for production) |
| **Authentication** | Native OIDC via Authelia |
| **Federation** | Enabled (requires port 8448 and DNS setup) |
| **Resource Usage** | Synapse: 512MB-2GB RAM, Element: 64-128MB RAM |
| **Subdomains** | `matrix.${DOMAIN}`, `element.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| PostgreSQL | User/room/event storage | Yes |
| Foundation | Traefik + Authelia | Yes |
| TURN server | Voice/video calls | Optional |

---

## Quick Start

### 1. Generate Secrets

```bash
# From project root
./scripts/generate-secrets.sh

# Verify Matrix-specific secrets exist
ls -la secrets/synapse_db_password
ls -la secrets/synapse_signing_key
ls -la secrets/synapse_registration_shared_secret
ls -la secrets/oidc_client_matrix
```

### 2. Generate Synapse Configuration

First-time setup requires generating the initial configuration:

```bash
# Generate homeserver.yaml
docker run --rm \
  -v $(pwd)/examples/matrix/config:/data \
  -e SYNAPSE_SERVER_NAME=matrix.yourdomain.com \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse@sha256:657cfa115c71701d188f227feb9d1c0fcd2213b26fcc1afd6c647ba333582634 generate

# Review and customize
nano examples/matrix/config/homeserver.yaml
```

### 3. Configure Environment

```bash
cp examples/matrix/.env.example examples/matrix/.env

# Edit with your values
nano examples/matrix/.env
```

### 4. Set Up Federation DNS

For federation to work, you need these DNS records:

```
# A record
matrix.yourdomain.com    A    your-server-ip

# SRV record (optional, for custom port)
_matrix._tcp.yourdomain.com    SRV    10 5 443 matrix.yourdomain.com
```

And a `.well-known` response at `https://yourdomain.com/.well-known/matrix/server`:

```json
{
  "m.server": "matrix.yourdomain.com:443"
}
```

### 5. Start Matrix

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f profiles/postgresql/docker-compose.postgresql.yml \
  -f examples/matrix/docker-compose.matrix.yml \
  --profile matrix \
  up -d
```

### 6. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_synapse     running (healthy)
# pmdl_postgres    running (healthy)

# View logs
docker compose logs synapse
```

### 7. Test Federation

```bash
# Federation tester
curl https://federationtester.matrix.org/api/report?server_name=matrix.yourdomain.com
```

### 8. Configure Element Web

Before starting, update the Element configuration with your domain:

```bash
# Edit the Element config
nano examples/matrix/config/element-config.json

# Update these values:
# "base_url": "https://matrix.yourdomain.com"
# "server_name": "matrix.yourdomain.com"
```

### 9. Access Matrix

- **Element Web**: `https://element.yourdomain.com` (self-hosted client)
- **External Client**: Use Element at `https://app.element.io` and configure homeserver as `https://matrix.yourdomain.com`
- **Admin**: Access Synapse Admin API at `https://matrix.yourdomain.com/_synapse/admin/`

---

## Architecture

```
Internet
    │
    ├──────────────────────────────────────┐
    ▼                                      ▼
┌─────────────┐                     ┌─────────────┐
│   Traefik   │ (HTTPS + WSS)       │ Federation  │
│   (443)     │                     │   (8448)    │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       ├───────────────────────────────────┤
       │                                   │
       ▼                                   ▼
┌─────────────┐                     ┌─────────────┐
│   Element   │ ────────────────────│   Synapse   │
│    Web      │    Client API       │ (homeserver)│
│ (element.)  │                     │  (matrix.)  │
└─────────────┘                     └──────┬──────┘
                                           │
                                    OIDC   │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                       ┌─────────────┐           ┌─────────────┐
                       │  Authelia   │           │ PostgreSQL  │
                       │   (IdP)     │           │             │
                       └─────────────┘           └─────────────┘
```

---

## Element Web Client

Element Web is the official Matrix web client, providing a full-featured messaging experience in the browser.

### Configuration

The Element configuration file at `examples/matrix/config/element-config.json` controls:

| Setting | Purpose |
|---------|---------|
| `default_server_config` | Points to your Synapse homeserver |
| `disable_guests` | Prevents anonymous access |
| `show_labs_settings` | Enables experimental features |
| `default_theme` | Sets light/dark theme |
| `jitsi.preferred_domain` | Jitsi server for video calls |

### Customizing Element

```json
{
    "default_server_config": {
        "m.homeserver": {
            "base_url": "https://matrix.yourdomain.com",
            "server_name": "matrix.yourdomain.com"
        }
    },
    "brand": "Your Organization",
    "default_theme": "dark",
    "disable_guests": true
}
```

### Resource Usage

Element Web is a static web application with minimal resource requirements:

| Limit | Value |
|-------|-------|
| Memory Limit | 128MB |
| Memory Reservation | 64MB |

---

## Authentication

Matrix Synapse uses **native OIDC** integration with Authelia:

### OIDC Configuration in homeserver.yaml

```yaml
oidc_providers:
  - idp_id: authelia
    idp_name: "Login with SSO"
    discover: true
    issuer: "https://auth.yourdomain.com"
    client_id: "matrix-synapse"
    client_secret_path: "/run/secrets/oidc_client_matrix"
    scopes: ["openid", "profile", "email"]
    user_mapping_provider:
      config:
        localpart_template: "{{ user.preferred_username }}"
        display_name_template: "{{ user.name }}"
        email_template: "{{ user.email }}"
```

### Authelia Configuration

```yaml
identity_providers:
  oidc:
    clients:
      - id: matrix-synapse
        description: Matrix Synapse Server
        secret: file:///run/secrets/oidc_client_matrix
        scopes: [openid, profile, email]
        redirect_uris:
          - https://matrix.yourdomain.com/_synapse/client/oidc/callback
```

---

## Federation

Matrix federation allows your server to communicate with other Matrix servers.

### Requirements

1. **Port 8448**: Must be reachable from the internet
2. **Valid TLS certificate**: Traefik handles this
3. **DNS records**: SRV record or .well-known delegation

### Federation Testing

```bash
# Test your server
curl https://federationtester.matrix.org/api/report?server_name=matrix.yourdomain.com

# Test against another server
docker compose exec synapse python -m synapse.util.check_dependencies
```

### Disabling Federation

If you want a private server without federation:

```yaml
# In homeserver.yaml
federation_domain_whitelist: []
```

---

## TURN Server (Voice/Video)

For voice and video calls to work behind NAT, you need a TURN server:

### Using coturn

```yaml
services:
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
```

### Synapse Configuration

```yaml
# In homeserver.yaml
turn_uris:
  - "turn:turn.yourdomain.com:3478?transport=udp"
  - "turn:turn.yourdomain.com:3478?transport=tcp"
turn_shared_secret: "your-turn-secret"
turn_user_lifetime: 86400000
turn_allow_guests: true
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |
| `SYNAPSE_SERVER_NAME` | Matrix server name | `matrix.example.com` |
| `SYNAPSE_REPORT_STATS` | Report anonymous stats | `no` |

---

## Secrets Required

| Secret File | Purpose |
|-------------|---------|
| `secrets/synapse_db_password` | PostgreSQL user password |
| `secrets/synapse_signing_key` | Server signing key |
| `secrets/synapse_registration_shared_secret` | Admin registration secret |
| `secrets/oidc_client_matrix` | OIDC client secret |

Generate with:

```bash
# Database password
openssl rand -base64 32 > secrets/synapse_db_password

# Signing key (generated by Synapse)
docker run --rm matrixdotorg/synapse@sha256:657cfa115c71701d188f227feb9d1c0fcd2213b26fcc1afd6c647ba333582634 generate_signing_key > secrets/synapse_signing_key

# Registration secret
openssl rand -base64 32 > secrets/synapse_registration_shared_secret

# OIDC client secret (also configure in Authelia)
openssl rand -base64 32 > secrets/oidc_client_matrix

# Set permissions
chmod 600 secrets/synapse_*
chmod 600 secrets/oidc_client_matrix
```

---

## Resource Limits

| Profile | Memory Limit | Reservation | Notes |
|---------|--------------|-------------|-------|
| Core | 512M | 256M | Small server (<50 users) |
| Full | 2G | 1G | Medium server (50-500 users) |

Matrix Synapse memory usage scales with:
- Number of users
- Number of rooms joined
- Federation traffic
- Media storage

---

## Storage

Synapse stores data in Docker volumes:

| Volume | Purpose | Backup Priority |
|--------|---------|-----------------|
| `pmdl_synapse_data` | Config, logs, media | High |
| PostgreSQL database | Users, rooms, events | Critical |

### Media Storage

Matrix stores uploaded media. For large deployments, configure external storage:

```yaml
# In homeserver.yaml
media_store_path: "/data/media_store"
max_upload_size: 50M
url_preview_enabled: true
```

### Backup Strategy

```bash
# Backup PostgreSQL
./profiles/postgresql/backup-scripts/backup.sh

# Backup Synapse data
docker run --rm -v pmdl_synapse_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/synapse-data-$(date +%Y%m%d).tar.gz -C /data .
```

---

## Admin Operations

### Create Admin User

```bash
docker compose exec synapse register_new_matrix_user \
  --config /data/homeserver.yaml \
  --admin \
  --user admin
```

### List Users

```bash
docker compose exec synapse curl -s \
  -H "Authorization: Bearer $(cat secrets/synapse_admin_token)" \
  http://localhost:8008/_synapse/admin/v2/users
```

### Deactivate User

```bash
docker compose exec synapse curl -X POST \
  -H "Authorization: Bearer $(cat secrets/synapse_admin_token)" \
  -H "Content-Type: application/json" \
  -d '{"erase": true}' \
  http://localhost:8008/_synapse/admin/v1/deactivate/@baduser:matrix.yourdomain.com
```

---

## Troubleshooting

### Synapse Won't Start

Check configuration syntax:

```bash
docker compose exec synapse python -m synapse.config homeserver \
  --config-path /data/homeserver.yaml
```

### Federation Not Working

1. Check port 8448 is open:
   ```bash
   nc -zv matrix.yourdomain.com 8448
   ```

2. Check DNS:
   ```bash
   dig _matrix._tcp.yourdomain.com SRV
   ```

3. Check .well-known:
   ```bash
   curl https://yourdomain.com/.well-known/matrix/server
   ```

### OIDC Login Fails

Check Authelia logs:

```bash
docker compose logs authelia | grep matrix
```

Verify OIDC discovery:

```bash
curl -s https://auth.yourdomain.com/.well-known/openid-configuration | jq .
```

### Database Connection Issues

Verify PostgreSQL is accessible:

```bash
docker compose exec postgres psql -U synapse -d synapse -c "SELECT 1;"
```

---

## Upgrade Path

Synapse releases frequently. For controlled upgrades:

```yaml
# Pin to specific version
image: matrixdotorg/synapse:v1.100.0

# Or use latest
image: matrixdotorg/synapse@sha256:657cfa115c71701d188f227feb9d1c0fcd2213b26fcc1afd6c647ba333582634
```

Upgrade procedure:

```bash
# 1. Backup database
./profiles/postgresql/backup-scripts/backup.sh

# 2. Check migration notes
curl https://github.com/matrix-org/synapse/releases

# 3. Pull new image
docker compose pull synapse

# 4. Restart
docker compose up -d synapse

# 5. Verify
docker compose logs synapse
```

---

## References

- Matrix Synapse GitHub: https://github.com/matrix-org/synapse
- Element Web GitHub: https://github.com/vector-im/element-web
- Matrix Specification: https://spec.matrix.org/
- Synapse Admin API: https://matrix-org.github.io/synapse/latest/admin_api/
- Element Configuration: https://github.com/vector-im/element-web/blob/develop/docs/config.md
- D2.1 Database Selection: PostgreSQL required for production Synapse
- D3.4 Authentication: Native OIDC integration
- PostgreSQL Profile: `../../profiles/postgresql/`

---

*Example Version: 1.1*
*Created: 2025-12-31*
*Updated: 2026-01-01 - Added Element Web client*

# LibreChat Example

LibreChat is an open-source AI assistant interface supporting multiple AI providers (OpenAI, Anthropic, Azure, Google, local models). This example demonstrates how to deploy LibreChat with MongoDB for conversations, PostgreSQL for vector embeddings (RAG), and native OIDC authentication via Authelia.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | LibreChat (latest) |
| **Databases** | MongoDB 7.0 (conversations) + PostgreSQL 16 with pgvector (RAG) |
| **Authentication** | Native OIDC via Authelia |
| **Resource Usage** | 512MB-1GB RAM |
| **Subdomain** | `chat.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| MongoDB | Conversation storage | Yes |
| PostgreSQL (with pgvector) | Vector embeddings for RAG | Yes (if using RAG) |
| Foundation | Traefik + Authelia | Yes |

---

## Quick Start

### 1. Generate Secrets

```bash
# From project root
./scripts/generate-secrets.sh

# Verify LibreChat-specific secrets exist
ls -la secrets/librechat_db_password
ls -la secrets/mongodb_root_password
ls -la secrets/oidc_client_librechat
```

### 2. Configure Environment

```bash
cp examples/librechat/.env.example examples/librechat/.env

# Edit with your values
nano examples/librechat/.env
```

### 3. Start LibreChat

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f profiles/mongodb/docker-compose.mongodb.yml \
  -f profiles/postgresql/docker-compose.postgresql.yml \
  -f examples/librechat/docker-compose.librechat.yml \
  --profile librechat \
  up -d
```

### 4. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_librechat  running (healthy)
# pmdl_mongodb    running (healthy)
# pmdl_postgres   running (healthy)

# View logs
docker compose logs librechat
```

### 5. Access LibreChat

- **Chat Interface**: `https://chat.yourdomain.com/`
- Login via Authelia SSO

---

## Architecture

```
Internet
    │
    ▼
┌─────────────┐
│   Traefik   │ (HTTPS termination)
└──────┬──────┘
       │
       ▼
┌─────────────┐      OIDC      ┌─────────────┐
│  LibreChat  │◄───────────────│  Authelia   │
│  (chat UI)  │                │   (IdP)     │
└──────┬──────┘                └─────────────┘
       │
       ├──────────────────────┐
       ▼                      ▼
┌─────────────┐        ┌─────────────┐
│   MongoDB   │        │ PostgreSQL  │
│(conversations)       │  (pgvector) │
└─────────────┘        └─────────────┘
```

---

## Authentication

LibreChat uses **native OIDC** integration with Authelia:

### How It Works

1. User visits `https://chat.yourdomain.com/`
2. LibreChat redirects to Authelia login
3. User authenticates (password + optional 2FA)
4. Authelia returns OIDC tokens to LibreChat
5. LibreChat creates/updates user profile from claims
6. User accesses the chat interface

### OIDC Configuration

LibreChat is configured as an OIDC client in Authelia:

```yaml
# In Authelia configuration
identity_providers:
  oidc:
    clients:
      - id: librechat
        description: LibreChat AI Interface
        secret: file:///run/secrets/oidc_client_librechat
        scopes: [openid, profile, email]
        redirect_uris:
          - https://chat.${DOMAIN}/oauth/callback
```

---

## AI Provider Configuration

LibreChat supports multiple AI providers. Configure via environment:

### OpenAI

```bash
OPENAI_API_KEY=sk-...
```

### Anthropic

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### Azure OpenAI

```bash
AZURE_API_KEY=...
AZURE_OPENAI_API_INSTANCE_NAME=your-instance
AZURE_OPENAI_API_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

### Local Models (Ollama)

```bash
OLLAMA_BASE_URL=http://ollama:11434
```

API keys should be stored in secret files, not environment variables in production.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |
| `LIBRECHAT_URL` | Full URL to LibreChat | `https://chat.example.com` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `LIBRECHAT_OIDC_SECRET` | OIDC client secret | (from secrets file) |

---

## Secrets Required

| Secret File | Purpose |
|-------------|---------|
| `secrets/librechat_db_password` | PostgreSQL user password |
| `secrets/mongodb_librechat_password` | MongoDB user password |
| `secrets/oidc_client_librechat` | OIDC client secret |
| `secrets/librechat_creds_key` | Encryption key for stored credentials |
| `secrets/librechat_creds_iv` | Encryption IV |
| `secrets/librechat_jwt_secret` | JWT signing secret |

Generate with:

```bash
# Database passwords
openssl rand -base64 32 > secrets/librechat_db_password
openssl rand -base64 32 > secrets/mongodb_librechat_password

# Encryption keys
openssl rand -hex 32 > secrets/librechat_creds_key
openssl rand -hex 16 > secrets/librechat_creds_iv
openssl rand -base64 64 > secrets/librechat_jwt_secret

# OIDC client secret (also configure in Authelia)
openssl rand -base64 32 > secrets/oidc_client_librechat

# Set permissions
chmod 600 secrets/librechat_*
chmod 600 secrets/mongodb_librechat_password
chmod 600 secrets/oidc_client_librechat
```

---

## Database Usage

### MongoDB (Conversations)

LibreChat stores all conversation data in MongoDB:
- Messages and threads
- User preferences
- Presets and templates
- File references

### PostgreSQL with pgvector (RAG)

LibreChat uses PostgreSQL for:
- Vector embeddings (pgvector extension)
- Document storage for RAG
- Semantic search capabilities

The pgvector extension is pre-installed in the `pgvector/pgvector:pg16` image specified in the PostgreSQL profile.

---

## Resource Limits

| Profile | Memory Limit | Reservation |
|---------|--------------|-------------|
| Core | 512M | 256M |
| Full | 1G | 512M |

LibreChat is a Node.js application. Memory usage scales with:
- Number of concurrent users
- Size of conversation context
- RAG document processing

---

## Storage

LibreChat stores files in Docker volumes:

| Volume | Purpose | Backup Priority |
|--------|---------|-----------------|
| `pmdl_librechat_images` | Uploaded images | Medium |
| `pmdl_librechat_logs` | Application logs | Low |
| MongoDB database | Conversations | Critical |
| PostgreSQL database | Vectors, documents | Critical |

### Backup Strategy

```bash
# Backup MongoDB
./profiles/mongodb/backup-scripts/backup.sh

# Backup PostgreSQL
./profiles/postgresql/backup-scripts/backup.sh

# Backup uploaded images
docker run --rm -v pmdl_librechat_images:/data -v $(pwd):/backup \
  alpine tar czf /backup/librechat-images-$(date +%Y%m%d).tar.gz -C /data .
```

---

## RAG Configuration

To enable Retrieval-Augmented Generation:

### 1. Ensure PostgreSQL with pgvector is running

```bash
docker compose exec postgres psql -U postgres -d librechat \
  -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### 2. Configure RAG in librechat.yaml

```yaml
# librechat.yaml
fileConfig:
  endpoints:
    custom:
      ragApi:
        serverless: false
        url: http://rag-api:8000/query
```

### 3. Add documents

Upload documents through the LibreChat interface or API.

---

## Troubleshooting

### LibreChat Returns 502 Bad Gateway

Check if LibreChat container is healthy:

```bash
docker compose logs librechat
docker inspect pmdl_librechat | grep -A5 Health
```

### OIDC Login Fails

Verify Authelia configuration:

```bash
# Check OIDC discovery
curl -s https://auth.yourdomain.com/.well-known/openid-configuration | jq .

# Check client configuration
docker compose logs authelia | grep librechat
```

### MongoDB Connection Errors

Verify MongoDB is accessible:

```bash
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

### pgvector Not Available

Verify extension is installed:

```bash
docker compose exec postgres psql -U postgres -d librechat \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

## Upgrade Path

LibreChat releases frequently. For controlled upgrades:

```yaml
# Pin to specific version
image: ghcr.io/danny-avila/librechat-dev:v0.7.5

# Or use latest (auto-update with Watchtower)
image: ghcr.io/danny-avila/librechat-dev@sha256:3db851096c0a7fbc3f2b3e41f7baed03203cd4a8c4cdde6e2c8ff0fa49efab9c
```

Upgrade procedure:

```bash
# 1. Backup databases
./profiles/mongodb/backup-scripts/backup.sh
./profiles/postgresql/backup-scripts/backup.sh

# 2. Pull new image
docker compose pull librechat

# 3. Restart
docker compose up -d librechat

# 4. Verify
docker compose logs librechat
```

---

## References

- LibreChat GitHub: https://github.com/danny-avila/LibreChat
- LibreChat Documentation: https://www.librechat.ai/docs
- D2.1 Database Selection: MongoDB + PostgreSQL with pgvector
- D3.4 Authentication: Native OIDC integration
- MongoDB Profile: `../../profiles/mongodb/`
- PostgreSQL Profile: `../../profiles/postgresql/`

---

*Example Version: 1.0*
*Created: 2025-12-31*

# Dashboard

The Peer Mesh Docker Lab dashboard provides a web-based interface for monitoring and managing your Docker infrastructure.

## Technology Stack

The dashboard is built with a carefully selected stack that aligns with project constraints: local-first, zero build dependencies, and commodity VPS deployment.

### Why Go?

| Consideration | Go | Alternatives |
|--------------|-----|--------------|
| **Single binary** | Compiles to one executable with no runtime dependencies | Node.js requires npm + node_modules |
| **Cross-compilation** | Easy ARM64/AMD64 builds (Mac M1 dev → Linux VPS) | Python/Node require platform-specific setup |
| **Memory footprint** | ~10-20MB typical | Node.js: 50-100MB+ |
| **Startup time** | Milliseconds | Interpreted languages: seconds |
| **Docker image size** | ~15MB (Alpine + binary) | Node.js: 100MB+ |
| **Concurrency** | Native goroutines for SSE/WebSocket | Requires async frameworks |

Go was chosen because **the dashboard must work identically on a $20 VPS and a developer's laptop** without requiring Node.js, npm, or any build toolchain.

### Why HTMX + Alpine.js + Tailwind?

This frontend stack requires **zero build step** - everything loads via CDN.

| Library | Purpose | Why Not React/Vue? |
|---------|---------|-------------------|
| **HTMX** | Server-driven UI updates | No build step, works offline after first load |
| **Alpine.js** | Lightweight interactivity (14KB) | No compilation, no virtual DOM overhead |
| **Tailwind CSS** | Utility-first styling via CDN | No PostCSS/webpack required in MVP |

**Key benefits:**
- Developer can edit HTML and see changes immediately (no `npm run build`)
- Works completely offline after initial CDN cache
- No Node.js required on development machine
- Static files can be served by any HTTP server

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────┐ │
│  │  HTMX   │  │ Alpine.js │  │ Tailwind  │  │ Custom JS   │ │
│  └────┬────┘  └─────┬────┘  └───────────┘  └──────┬──────┘ │
│       │             │                              │         │
│       └─────────────┴──────────────────────────────┘         │
│                              │                               │
│                         HTTP/SSE                             │
└──────────────────────────────┼───────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────┐
│                    Go Dashboard Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ REST API    │  │ SSE Events  │  │ Static File Server  │  │
│  │ /api/*      │  │ /api/events │  │ /static/*           │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘  │
│         │                │                                   │
│         └────────────────┴──────────────────┐                │
│                                             │                │
│  ┌──────────────────────────────────────────┴─────────────┐ │
│  │                   Docker Client                         │ │
│  │              (via socket-proxy:2375)                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system` | GET | Host system information |
| `/api/containers` | GET | Container list with resource usage |
| `/api/volumes` | GET | Docker volume inventory |
| `/api/alerts` | GET | System health alerts |
| `/api/events` | GET | Server-Sent Events stream |
| `/api/session` | GET | Current session info |
| `/api/login` | POST | Authenticate user |
| `/api/logout` | POST | End session |
| `/health` | GET | Liveness probe |

## Quick Start: Setting Up Credentials

> **Naming Convention**: This dashboard uses the `DOCKERLAB_` prefix.
> See [GLOSSARY.md](./GLOSSARY.md) for all naming conventions.

### Local Development

Add to your `.env` file:

```bash
# Docker Lab Dashboard credentials (REQUIRED for local dev with auth)
DOCKERLAB_USERNAME=admin
DOCKERLAB_PASSWORD=your-local-dev-password

# Or disable auth for local testing by leaving PASSWORD empty
# DOCKERLAB_PASSWORD=
```

Generate a secure password:

```bash
# Generate random password
openssl rand -base64 24
```

### Production Deployment

For VPS/production, set secure credentials:

```bash
# Generate and set password
export DOCKERLAB_PASSWORD=$(openssl rand -base64 24)
echo "DOCKERLAB_PASSWORD=$DOCKERLAB_PASSWORD" >> .env

# Save this password somewhere secure!
echo "Docker Lab Dashboard login: admin / $DOCKERLAB_PASSWORD"
```

### Current VPS Credentials (dockerlab.example.com)

See `AGENTS.md` for current production credentials. These are only documented in the private repo, not committed to the public repo.

## Features

- Real-time container monitoring and status
- Module registry with installation capabilities
- System resource usage tracking
- Container lifecycle management
- Event stream monitoring
- Health check status

## Demo Mode

The dashboard supports a demo mode for public showcases and demonstrations.

### Configuration

Set the following environment variable in your `.env` file:

```bash
DOCKERLAB_DEMO_MODE=true
```

For production deployment at dockerlab.example.com, this should be set to true to enable public access.

> **Backwards Compatibility**: `DEMO_MODE=true` still works but is deprecated.

### Guest Access

When demo mode is enabled:

- A "Guest Access" button appears on the login page
- Guests can view all dashboard features without credentials
- Write operations (container control, configuration changes) are blocked for guests
- A visual indicator shows when viewing as guest
- Full system visibility for demonstrations and evaluation

### Security

Demo mode is safe for public exposure:

- All write operations require authentication
- Guests can only view, not modify
- Container start/stop/restart operations are disabled for guest sessions
- Configuration changes require authenticated access
- Session info endpoint reveals only public information
- No sensitive credentials or secrets are exposed in guest mode

### Use Cases

Demo mode is ideal for:

- Public demonstrations and showcases
- Educational environments
- Evaluation by potential users
- Conference presentations
- Documentation and tutorials
- Open house events

### Disabling Demo Mode

For private deployments, leave `DEMO_MODE` unset or set it to `false`:

```bash
# .env
DEMO_MODE=false
```

This will remove the guest access button and require authentication for all dashboard access.

## Authentication

When demo mode is disabled, all access requires authentication:

- Username: Set via `DOCKERLAB_USERNAME` environment variable (default: admin)
- Password: Set via `DOCKERLAB_PASSWORD` environment variable
- Use `./scripts/generate-secrets.sh` to create secure credentials

> **Backwards Compatibility**: Old variable names (`DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`) still work but are deprecated.

## Access

The dashboard is accessible at your configured domain:

```
https://yourdomain.com
```

For local development:

```
http://localhost:8080
```

## Security Features

- Rate limiting: 10 requests/minute per IP
- Security headers: HSTS, X-Frame-Options, XSS protection
- Not indexed by search engines
- Session-based authentication
- Bcrypt password hashing
- No sensitive data exposure in logs or responses

## Multi-Instance Management (Phase 5)

The dashboard supports managing multiple PeerMesh deployments from a single interface, enabling cross-system management for distributed environments.

### Features

- **Instance Registry**: Register and track multiple remote PeerMesh dashboard instances
- **Health Monitoring**: Automatic health checks every 30 seconds with visual status indicators
- **Remote Actions**: Trigger sync operations on remote instances
- **Container Visibility**: View containers running on remote instances
- **Persistent Storage**: Instance registry survives dashboard restarts

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/instances` | GET | List all registered instances |
| `/api/instances` | POST | Register a new remote instance |
| `/api/instances/{id}` | GET | Get instance details |
| `/api/instances/{id}` | DELETE | Remove a registered instance |
| `/api/instances/{id}/health` | GET | Check instance health |
| `/api/instances/{id}/sync` | POST | Trigger sync on remote instance |
| `/api/instances/{id}/containers` | GET | Get containers from remote instance |

### Configuration

Configure the dashboard instance identity and inter-instance communication:

```bash
# .env or environment variables

# This instance's identity (optional - defaults to hostname)
INSTANCE_NAME=production-server
INSTANCE_ID=prod-01  # Optional: auto-generated from name if not set
INSTANCE_URL=https://dashboard.example.com  # URL other instances use to reach this one

# Shared secret for instance-to-instance authentication (recommended for production)
INSTANCE_SECRET=your-secure-shared-secret

# Data persistence path
INSTANCE_DATA_PATH=/data/instances.json  # Default: /data/instances.json
```

### Security Model

Multi-instance communication follows a trust model designed for internal networks:

#### Instance Token Authentication

1. **Shared Secret**: All instances in a cluster share the same `INSTANCE_SECRET`
2. **Header-Based Auth**: Remote requests include `X-Instance-Token` header
3. **Constant-Time Comparison**: Tokens are compared securely to prevent timing attacks

#### Recommended Setup

For production environments:

```bash
# Generate a strong shared secret (run once, share across all instances)
openssl rand -base64 32

# Set on all instances in the cluster
INSTANCE_SECRET=your-generated-secret
```

#### Permission Model

| User Type | View Instances | Register/Remove | Health Check | Trigger Sync | View Remote Containers |
|-----------|---------------|-----------------|--------------|--------------|----------------------|
| Authenticated | Yes | Yes | Yes | Yes | Yes |
| Guest | Yes | No | Yes | No | Yes |
| Unauthenticated | No | No | No | No | No |

#### Network Security Recommendations

1. **Internal Network**: Deploy instances on a private network or VPN
2. **HTTPS**: Always use TLS for instance-to-instance communication
3. **Firewall**: Restrict dashboard ports to known IP addresses
4. **Audit Logging**: Monitor `/api/instances/*` endpoints for unusual activity

### Usage Examples

#### Register a Remote Instance via API

```bash
curl -X POST https://dashboard.example.com/api/instances \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "name": "Staging Server",
    "url": "https://staging.example.com",
    "description": "Staging environment",
    "token": "optional-shared-secret"
  }'
```

#### Check Instance Health

```bash
curl https://dashboard.example.com/api/instances/abc123/health \
  -H "Cookie: session=your-session-cookie"
```

#### Trigger Remote Sync

```bash
curl -X POST https://dashboard.example.com/api/instances/abc123/sync \
  -H "Cookie: session=your-session-cookie"
```

### Data Persistence

Instance registrations are stored in a JSON file:

- **Default Location**: `/data/instances.json`
- **File Permissions**: `0600` (owner read/write only)
- **Format**: JSON array of instance objects
- **Automatic Backup**: Consider mounting the data directory as a Docker volume

Example instance data:

```json
[
  {
    "id": "a1b2c3d4",
    "name": "Production",
    "url": "https://prod.example.com",
    "description": "Main production cluster",
    "created_at": "2026-01-21T10:30:00Z",
    "last_seen": "2026-01-21T11:45:00Z",
    "health": "healthy",
    "version": "0.2.0",
    "environment": "production"
  }
]
```

### Troubleshooting

#### Instance Shows "Unhealthy"

1. Verify the remote instance is accessible from this instance
2. Check network connectivity: `curl -I https://remote-instance.com/health`
3. Verify firewall rules allow traffic between instances
4. Check if `INSTANCE_SECRET` matches on both ends

#### "Unauthorized" When Registering Instance

- Ensure you are logged in with a non-guest account
- Check that your session cookie is valid
- Guest users cannot register or remove instances

#### Remote Sync Fails

- Verify the remote instance has sync capability enabled
- Check that the remote user has permission to trigger sync
- Review remote instance logs for error details

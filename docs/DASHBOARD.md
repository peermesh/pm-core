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
DEMO_MODE=true
```

For production deployment at dockerlab.peermesh.org, this should be set to true to enable public access.

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

- Username: Set via `DASHBOARD_USERNAME` environment variable (default: admin)
- Password: Set via `DASHBOARD_PASSWORD` environment variable
- Use `./scripts/generate-secrets.sh` to create secure credentials

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

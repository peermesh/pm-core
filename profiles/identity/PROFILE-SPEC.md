# Identity Provider Profile Specification

**Profile Name**: identity
**Technology**: Community Solid Server (CSS)
**Version**: 7.0
**Category**: Authentication & Identity
**Priority**: High

---

## Overview

The Identity Provider profile deploys a Community Solid Server instance that serves as a managed identity system for the PeerMesh ecosystem. It provides WebID-based authentication, personal data pods, and OAuth 2.0/OpenID Connect support.

### Key Features

- **WebID Authentication**: Decentralized identity using W3C WebID specification
- **Personal Data Pods**: User-controlled data storage following Solid specification
- **OAuth 2.0 / OIDC**: Standard authentication protocols for app integration
- **Internal + External Access**: Available via Traefik (public) and app-internal network (private)

---

## Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     Traefik     │
                    │  (port 443)     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │    pmdl_proxy-external      │
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │     identity-provider        │
              │    (pmdl_identity:3000)      │
              └──────────────┬───────────────┘
                             │
              ┌──────────────┴──────────────┐
              │    pmdl_app-internal        │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │    Other Internal Apps       │
              │  (can reach identity-       │
              │   provider:3000 directly)   │
              └─────────────────────────────┘
```

### Access Points

| Access Type | URL | Network | Use Case |
|-------------|-----|---------|----------|
| Public (HTTPS) | `https://id.${DOMAIN}` | proxy-external | User login, WebID lookup |
| Internal (HTTP) | `http://identity-provider:3000` | app-internal | Service-to-service auth |

---

## Configuration

### Required Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DOMAIN` | Base domain (e.g., `example.com`) | - | Yes |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IDENTITY_LOG_LEVEL` | Logging level (info, debug, warn, error) | `info` |
| `IDENTITY_MEMORY_LIMIT` | Container memory limit | `512M` |
| `IDENTITY_MEMORY_RESERVATION` | Container memory reservation | `256M` |

### SMTP Configuration (Optional)

For password reset and email notifications:

| Variable | Description | Default |
|----------|-------------|---------|
| `IDENTITY_EMAIL_SENDER` | From address for emails | `noreply@${DOMAIN}` |
| `IDENTITY_SMTP_HOST` | SMTP server hostname | - |
| `IDENTITY_SMTP_PORT` | SMTP server port | `587` |
| `IDENTITY_SMTP_USER` | SMTP authentication user | - |
| `IDENTITY_SMTP_PASSWORD` | SMTP authentication password | - |

---

## File Structure

```
profiles/identity/
├── docker-compose.identity.yml   # Docker Compose fragment
├── PROFILE-SPEC.md               # This documentation
└── configs/
    └── file.json                 # CSS configuration template
```

---

## Usage

### Activation

```bash
# Add to COMPOSE_PROFILES in .env
COMPOSE_PROFILES=postgresql,redis,identity

# Or specify on command line
docker compose -f docker-compose.yml \
               -f profiles/identity/docker-compose.identity.yml \
               --profile identity up -d
```

### Prerequisites

1. Foundation must be running (Traefik)
2. DNS configured: `id.${DOMAIN}` pointing to server
3. Config files in `profiles/identity/configs/`

### First Run Setup

1. Copy config template:
   ```bash
   cp profiles/identity/configs/file.json.example profiles/identity/configs/file.json
   ```

2. Start the service:
   ```bash
   docker compose --profile identity up -d
   ```

3. Access the server at `https://id.${DOMAIN}`

4. Create first user/pod via the web interface

---

## Integration with Social Lab

### Internal Service Access

Other services in the Social Lab project can authenticate against the identity provider:

```yaml
# In your app's docker-compose fragment
services:
  your-app:
    environment:
      IDENTITY_PROVIDER_URL: http://identity-provider:3000
      IDENTITY_PUBLIC_URL: https://id.${DOMAIN}
    networks:
      - app-internal
      - proxy-external
```

### WebID Authentication Flow

1. User visits your app at `https://app.${DOMAIN}`
2. App redirects to `https://id.${DOMAIN}` for authentication
3. User authenticates with WebID
4. Identity provider redirects back with auth token
5. App verifies token via internal network (`http://identity-provider:3000`)

---

## Volumes

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `pmdl_identity_data` | `/data` | User pods, WebID profiles, resources |

### Backup Considerations

The `/data` volume contains:
- User account information
- Pod data (user files, preferences)
- WebID profiles
- Access control lists

**Backup Priority**: HIGH - Contains user identity data

---

## Health Check

The service uses a TCP port check:

```yaml
healthcheck:
  test: ["CMD-SHELL", "nc -z localhost 3000 || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 30s
```

**Note**: HTTP health check is not used because CSS rejects requests to `localhost` when `CSS_BASE_URL` is set to the public domain.

---

## Security Considerations

### Network Isolation

- Service is on `app-internal` for internal access
- Public access only through Traefik with TLS
- No direct port exposure to host

### HTTPS Enforcement

- Traefik handles TLS termination
- HSTS headers enabled (1 year, includeSubdomains, preload)
- All traffic redirected from HTTP to HTTPS

### Data Privacy

- User data stored in individual pods
- Access controlled by Solid ACL (Access Control Lists)
- Users own and control their data

---

## Troubleshooting

### Service Not Starting

```bash
# Check container logs
docker logs pmdl_identity

# Common issues:
# - Config file not found: Check ./profiles/identity/configs/file.json exists
# - Port conflict: Check if port 3000 is already in use
```

### Cannot Reach Service Internally

```bash
# Verify network membership
docker network inspect pmdl_app-internal | grep identity

# Test connectivity from another container
docker exec pmdl_your-app curl http://identity-provider:3000/.well-known/solid
```

### Authentication Errors

- Verify `CSS_BASE_URL` matches the Traefik host exactly
- Check that CORS is properly configured in CSS config
- Ensure client app is using the correct identity provider URL

---

## Related Resources

- [Community Solid Server Documentation](https://communitysolidserver.github.io/CommunitySolidServer/)
- [Solid Specification](https://solidproject.org/TR/protocol)
- [WebID Specification](https://www.w3.org/2005/Incubator/webid/spec/identity/)
- [Proposal: PROP-2026-01-15-identity-provider-support.md](../../../../.dev/ai/proposals/PROP-2026-01-15-identity-provider-support.md)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-16 | Initial profile implementation |

# Dashboard

The Peer Mesh Docker Lab dashboard provides a web-based interface for monitoring and managing your Docker infrastructure.

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

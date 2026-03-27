# Landing Page Example

A simple, static HTML landing page that serves as a dashboard for all deployed services in your Core instance. This example demonstrates the simplest possible integration pattern: foundation-only deployment with no database dependencies.

---

## Overview

| Property | Value |
|----------|-------|
| **Application** | Static HTML Dashboard |
| **Web Server** | nginx:alpine |
| **Database** | None (static content only) |
| **Authentication** | None (public landing page) |
| **Resource Usage** | 16-32MB RAM |
| **Subdomain** | `${DOMAIN}` or `landing.${DOMAIN}` |

---

## Profile Requirements

This example requires:

| Profile | Purpose | Required |
|---------|---------|----------|
| Foundation | Traefik | Yes |

No database profiles are needed. This is a foundation-only example.

---

## Quick Start

### 1. Configure Environment

```bash
cp examples/landing/.env.example examples/landing/.env

# Edit with your domain
nano examples/landing/.env
```

### 2. Customize Landing Page (Optional)

```bash
# Edit the HTML to match your services
nano examples/landing/html/index.html
```

### 3. Start Landing Page

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f examples/landing/docker-compose.landing.yml \
  up -d
```

### 4. Verify Deployment

```bash
# Check health
docker compose ps

# Should show:
# pmdl_landing     running (healthy)

# View logs
docker compose logs landing
```

### 5. Access Landing Page

- **Root Domain**: `https://yourdomain.com/`
- **Subdomain**: `https://landing.yourdomain.com/`

Both routes are configured by default.

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
┌─────────────┐
│    nginx    │ (static HTML)
│   (port 80) │
└─────────────┘
```

This is the simplest possible deployment pattern:
- No database
- No secrets
- No backend processing
- Just static HTML/CSS/JS served via nginx

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain | `example.com` |

That's it. No other configuration needed.

---

## Secrets Required

None. This example has no secrets.

---

## Traefik Integration

The compose file includes Traefik labels for dual-route access:

### Root Domain + Subdomain

```yaml
labels:
  - "traefik.http.routers.landing.rule=Host(`${DOMAIN}`) || Host(`landing.${DOMAIN}`)"
  - "traefik.http.routers.landing.entrypoints=websecure"
  - "traefik.http.routers.landing.tls.certresolver=letsencrypt"
```

This allows users to access the landing page at either:
- `https://yourdomain.com/` (root domain)
- `https://landing.yourdomain.com/` (subdomain)

---

## Resource Limits

| Component | Memory Limit | Reservation |
|-----------|--------------|-------------|
| nginx | 32M | 16M |

Static content requires minimal resources. These limits are intentionally conservative.

---

## Storage

No persistent volumes are used. The landing page content is mounted read-only from:

```
examples/landing/html/
```

Any changes to the HTML are immediately visible (nginx serves from the mounted directory).

---

## Customization

### Update Service Cards

Edit `examples/landing/html/index.html` to add, remove, or modify service cards:

```html
<div class="card">
    <div class="card-header">
        <div class="icon communication">💬</div>
        <div>
            <h2>Your Service</h2>
            <span class="card-type">Category</span>
        </div>
        <span class="status"><span class="status-dot"></span> Live</span>
    </div>
    <p>Description of your service.</p>
    <a href="https://yourservice.yourdomain.com" class="card-link" target="_blank">
        Open Service →
    </a>
    <div class="tech-stack">
        <span class="tech-tag">Tech1</span>
        <span class="tech-tag">Tech2</span>
    </div>
</div>
```

### Update Domain Reference

The landing page includes a domain reference in the header. Update it to match your domain:

```html
<p class="subtitle">Services running on <span class="domain">yourdomain.com</span></p>
```

### Custom Styling

The landing page uses CSS custom properties (variables) for easy theming. Edit the `:root` section in the HTML file:

```css
:root {
    --bg: #0f172a;          /* Background color */
    --card-bg: #1e293b;     /* Card background */
    --accent: #38bdf8;      /* Accent/link color */
    --text: #f1f5f9;        /* Primary text */
    /* ... */
}
```

---

## Use Cases

### 1. Public Dashboard

Display all publicly accessible services with status indicators and direct links.

### 2. Internal Service Directory

List internal-only services for team members (combine with Authelia protection).

### 3. Marketing/Demo Page

Showcase your Core deployment to prospective users or clients.

### 4. Status Page Alternative

Simple alternative to heavyweight status page tools for small deployments.

---

## Known Limitations

1. **Static Content Only**: The landing page cannot dynamically query service health. Status indicators are decorative (always show "Live").

2. **Manual Updates Required**: Adding or removing services requires manual HTML editing. There is no automatic service discovery.

3. **No Authentication**: The landing page is public by default. If you need to protect it, add Authelia middleware to the Traefik router.

4. **No Search or Filtering**: The grid layout is simple. For large deployments with many services, consider implementing JavaScript-based search/filter functionality.

---

## Troubleshooting

### Landing Page Shows 404

Traefik might not be routing correctly. Check Traefik logs:

```bash
docker compose logs traefik
```

Verify the landing container is running:

```bash
docker compose ps landing
```

### Styles Not Loading

Check that the HTML file has correct `<style>` tags and is not being cached:

```bash
# Force browser to bypass cache: Ctrl+Shift+R or Cmd+Shift+R
```

### Changes Not Visible

nginx caches static content. Restart the container to force reload:

```bash
docker compose restart landing
```

---

## Extending This Example

### Add Authentication with Authelia

Protect the landing page with Authelia (when configured):

```yaml
labels:
  - "traefik.http.routers.landing.middlewares=authelia@file"
```

### Add JavaScript Interactivity

Mount additional JS files alongside the HTML:

```yaml
volumes:
  - ./examples/landing/html:/usr/share/nginx/html:ro
  - ./examples/landing/js:/usr/share/nginx/html/js:ro
```

### Use as Template for Other Static Sites

Copy this pattern for other static HTML applications:
- Documentation sites
- Portfolio pages
- SPA applications (React/Vue/etc built output)

---

## References

- nginx Docker Hub: https://hub.docker.com/_/nginx
- Traefik Routing Documentation: https://doc.traefik.io/traefik/routing/routers/
- Foundation Pattern: `../../docs/ARCHITECTURE.md`

---

*Example Version: 1.0*
*Created: 2026-02-22*

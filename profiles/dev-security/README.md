# Dev Security Profile: mitmproxy

## What It Does

[mitmproxy](https://mitmproxy.org/) is an interactive HTTPS proxy that intercepts, inspects, modifies, and replays HTTP/HTTPS traffic. This profile adds a mitmproxy container to the Core stack for development-time security testing.

Use it to:
- Inspect every request and response between Traefik and backend services
- Check for token leakage in headers, cookies, or response bodies
- Validate session handling (cookie flags, expiration, rotation)
- Test how services behave when requests are modified in transit

> **WARNING: Development only. Never deploy mitmproxy to production.** It intercepts and decrypts traffic, which would compromise the security of a live system.

## Enabling the Profile

Start the stack with the dev-security overlay:

```bash
docker compose \
  -f docker-compose.yml \
  -f profiles/dev-security/docker-compose.dev-security.yml \
  --profile dev-security \
  up -d
```

Or set `COMPOSE_PROFILES=dev-security` in your `.env` file and use the overlay flag only:

```bash
docker compose \
  -f docker-compose.yml \
  -f profiles/dev-security/docker-compose.dev-security.yml \
  up -d
```

## Ports

| Port | Binding | Purpose |
|------|---------|---------|
| 8081 | 127.0.0.1 only | mitmproxy web UI |
| 8082 | 127.0.0.1 only | Proxy listener |

Both ports are bound to localhost only -- they are not accessible from the network.

## Routing Services Through the Proxy

To inspect traffic from a specific service, configure that service to use mitmproxy as its HTTP proxy. Add these environment variables to the service you want to inspect:

```yaml
services:
  my-app:
    environment:
      - HTTP_PROXY=http://mitmproxy:8082
      - HTTPS_PROXY=http://mitmproxy:8082
      - NO_PROXY=localhost,127.0.0.1
```

The service must be on a network shared with mitmproxy (`proxy-external` or `app-internal`).

For services that do not honor `HTTP_PROXY` environment variables, you can configure Traefik to forward specific routes through mitmproxy by adding it as an upstream service.

## Using the Web UI

1. Open `http://localhost:8081` in your browser.
2. You will see a live stream of intercepted requests.
3. Click any request to inspect headers, body, and response details.
4. Use the filter bar to narrow results (e.g., `~d api.example.com` to filter by domain).
5. Use the intercept feature to pause and modify requests before they reach the backend.

Key mitmproxy web UI features:
- **Flow list**: All captured request/response pairs
- **Flow detail**: Headers, content, timing for a selected flow
- **Intercept**: Set patterns to pause matching requests for manual inspection
- **Replay**: Re-send captured requests

## Security Testing Workflow

This is the reviewer's pattern for security verification:

### 1. Token Leakage Check

1. Start the proxy and configure your service to route through it.
2. Authenticate to the application.
3. In the mitmproxy web UI, search for tokens/secrets:
   - Filter: `~s "token"` or `~s "Bearer"` to find tokens in responses
   - Filter: `~h "Authorization"` to see auth headers
4. Verify tokens are not leaked in URLs, query parameters, or response bodies where they should not appear.

### 2. Session Handling Validation

1. Log in and inspect the `Set-Cookie` response header.
2. Verify cookie flags: `HttpOnly`, `Secure`, `SameSite`.
3. Log out and verify session cookies are invalidated.
4. Attempt to replay a captured authenticated request after logout -- it should fail.

### 3. Request Tampering

1. Enable intercept mode in the web UI.
2. Modify request headers (e.g., change `Authorization` values, inject headers).
3. Verify the backend rejects tampered requests with appropriate error codes (401/403).

### 4. Input Validation

1. Intercept API requests and modify payloads with injection patterns.
2. Check that the backend sanitizes or rejects malicious input.
3. Inspect responses for reflected content that could indicate XSS vulnerabilities.

## Cleanup

Stop and remove the mitmproxy container:

```bash
docker compose \
  -f docker-compose.yml \
  -f profiles/dev-security/docker-compose.dev-security.yml \
  --profile dev-security \
  down
```

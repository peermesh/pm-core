# Apps Behind Reverse Proxy (Traefik)

Pattern guide for configuring applications that receive traffic through Traefik reverse proxy.

**Priority**: P1 (causes rate limiting and federation issues)
**Discovered in**: GoToSocial, Mastodon, FreshRSS, Matrix Authentication Service

---

## How to Identify

An app needs trusted proxy configuration when:

- App has Traefik labels (`traefik.enable=true`)
- App receives traffic through Traefik instead of direct access
- App has rate limiting features
- App uses client IP for authentication/logging
- App participates in federation (ActivityPub, Matrix)
- App validates request signatures

Quick check in compose file:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`app.example.com`)"
```

---

## What to Check

- [ ] Trusted proxy headers configured for app
- [ ] Docker network CIDR in allowed proxy list
- [ ] X-Forwarded-For handling enabled
- [ ] X-Forwarded-Proto respected (for HTTPS detection)
- [ ] Rate limiting uses real client IP, not proxy IP
- [ ] Logs show real client IPs

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Rate limiting own users | App sees Traefik IP (172.x.x.x), not client | Add Docker CIDR to trusted proxies |
| Federation fails | HTTP signatures fail on proxied requests | Configure proxy trust for header forwarding |
| Wrong IP in logs | Not trusting X-Forwarded-For header | Add network range to trusted list |
| HTTPS redirect loops | App sees HTTP from proxy, redirects | Trust X-Forwarded-Proto header |
| Geo-blocking fails | Geo lookup uses proxy IP | Enable real IP extraction |
| OAuth callbacks fail | Wrong protocol in redirect URLs | Trust X-Forwarded-Proto |

---

## Correct Patterns

### Environment Variables (Common Pattern)

```yaml
environment:
  # Generic pattern - Add Docker network CIDRs
  TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"
```

### Common App Configurations

#### GoToSocial
```yaml
environment:
  GTS_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8"
```

#### Mastodon
```yaml
environment:
  TRUSTED_PROXY_IP: "172.16.0.0/12"
```

#### FreshRSS
```yaml
environment:
  TRUSTED_PROXY: "172.16.0.1/12 192.168.0.1/16"
```

#### Matrix Authentication Service
```yaml
# In config.yaml
http:
  trusted_proxies:
    - 192.168.0.0/16
    - 172.16.0.0/12
    - 10.0.0.0/10
```

#### Express.js Apps (Node.js)
```yaml
environment:
  # Number of proxy hops to trust (1 = trust first proxy)
  TRUST_PROXY: "1"
```

#### Laravel/PHP Apps
```yaml
environment:
  TRUSTED_PROXIES: "*"  # Or specific CIDR
```

#### Django Apps
```python
# settings.py
USE_X_FORWARDED_HOST = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
```

---

## Docker Network CIDRs

Default Docker networks use these private IP ranges:

| Range | CIDR | Notes |
|-------|------|-------|
| 172.16.0.0 - 172.31.255.255 | `172.16.0.0/12` | Default Docker bridge networks |
| 10.0.0.0 - 10.255.255.255 | `10.0.0.0/8` | Docker Swarm overlay networks |
| 192.168.0.0 - 192.168.255.255 | `192.168.0.0/16` | Custom networks, host networks |

**Recommended trusted proxy config**: `172.16.0.0/12,10.0.0.0/8`

Find your actual Docker network CIDR:
```bash
# List Docker networks
docker network ls

# Inspect specific network for CIDR
docker network inspect pmdl_proxy-external | grep -A 5 IPAM
```

---

## Headers Traefik Forwards

Traefik automatically sets these headers when proxying:

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `X-Forwarded-For` | Original client IP | `203.0.113.50` |
| `X-Forwarded-Proto` | Original protocol | `https` |
| `X-Forwarded-Host` | Original hostname | `app.example.com` |
| `X-Forwarded-Port` | Original port | `443` |
| `X-Real-IP` | Client IP (single value) | `203.0.113.50` |

---

## Test Commands

### Verify Proxy Trust is Working

**1. Check what IP the app sees:**
```bash
# Inside the container
docker exec -it pmdl_gotosocial wget -qO- http://ifconfig.me

# Check app logs for client IPs
docker logs pmdl_gotosocial 2>&1 | grep -i "ip\|client\|remote"
```

**2. Make a request and check headers:**
```bash
# From outside, check what headers arrive
curl -v https://app.example.com/health 2>&1 | grep -i forward
```

**3. Verify real IP in application logs:**
```bash
# Should show external IP (e.g., 203.0.113.x), NOT 172.x.x.x
docker logs pmdl_myapp 2>&1 | tail -20
```

**4. Test rate limiting with real vs proxy IP:**
```bash
# If rate limiting works correctly, this should rate limit based on YOUR IP
# not based on the Traefik container IP
for i in {1..100}; do curl -s https://app.example.com/api/endpoint > /dev/null; done
```

**5. Check container network for CIDR:**
```bash
# Find the IP range used by your proxy network
docker network inspect pmdl_proxy-external --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

---

## Federation-Specific Issues

### ActivityPub (GoToSocial, Mastodon, Pixelfed)

Federation uses HTTP signatures that validate the request origin. If proxy trust is misconfigured:

- Signature validation fails (request appears to come from proxy)
- Remote servers reject follow requests
- Posts don't federate to other instances

**Fix**: Ensure `X-Forwarded-*` headers are trusted so the app reconstructs the original request correctly.

### Matrix Federation

Matrix servers validate homeserver identity. Without proxy trust:

- Server-to-server (S2S) connections fail
- Federation traffic gets rejected
- Room joins from remote servers fail

---

## References

- [Pattern 7: Trusted Proxy Configuration](../.dev/ai/research/2026-01-03-universal-patterns-from-app-testing.md)
- [Traefik Forwarded Headers](https://doc.traefik.io/traefik/routing/entrypoints/#forwarded-headers)
- [GoToSocial Proxy Docs](https://docs.gotosocial.org/en/latest/advanced/proxy/)

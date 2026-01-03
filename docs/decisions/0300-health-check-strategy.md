# ADR-0300: Health Check Strategy

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Docker health checks serve multiple purposes:

- **Dependency ordering**: Start services only after dependencies are ready
- **Load balancer decisions**: Route traffic only to healthy instances
- **Monitoring signals**: Detect degraded services
- **Restart triggers**: Automatically restart unhealthy containers

Health check design involves trade-offs:

- **Shallow checks** (is the process running?) are fast but may miss issues
- **Deep checks** (can the app reach its database?) are thorough but can cause cascading failures

The project needs a health check strategy that:

- Enables proper startup ordering via `depends_on: condition: service_healthy`
- Provides meaningful health signals for debugging
- Avoids cascading unhealthy states
- Works within VPS resource constraints

---

## Decision

**We will use shallow health checks at the container level** with native tools (pg_isready, redis-cli, wget) and conservative timing defaults.

- **Databases**: Check if accepting connections, not application queries
- **Applications**: HTTP check to `/health` endpoint, not dependency verification
- **Deep checks**: Available at load balancer level (Traefik), not container level

Automatic restart on unhealthy is NOT enabled initially. The `restart: unless-stopped` policy handles process crashes.

---

## Alternatives Considered

### Option A: Deep Checks at Container Level

**Description**: Application health checks verify database connectivity and other dependencies.

**Pros**:
- Single health signal reflects total system state
- Immediate notification of any issue

**Cons**:
- Database outage marks all apps unhealthy
- Obscures root cause (which component failed?)
- Cascading failures during maintenance

**Why not chosen**: When the database is down, only the database container should report unhealthy. Deep checks at the container level cause cascading unhealthy states that obscure root cause.

### Option B: No Health Checks

**Description**: Rely on process exit for health signals.

**Pros**:
- Zero configuration
- No overhead

**Cons**:
- Cannot use `depends_on: condition: service_healthy`
- No visibility into hung processes
- Load balancers cannot make routing decisions

**Why not chosen**: Proper startup ordering requires health checks. Without them, applications may try to connect to databases before they are ready.

### Option C: Autoheal with Docker Socket

**Description**: Deploy autoheal sidecar to restart unhealthy containers.

**Pros**:
- Automatic recovery from stuck states
- Reduces manual intervention

**Cons**:
- Requires Docker socket access (security concern)
- Can cause restart storms if checks are too sensitive
- Masks underlying issues that should be investigated

**Why not chosen**: Conservative approach for initial release. `restart: unless-stopped` handles crashes. Autoheal can be added later if operational experience justifies it.

---

## Consequences

### Positive

- Clear root cause identification (only failed component is unhealthy)
- Proper startup ordering with `depends_on: condition: service_healthy`
- Minimal CPU overhead from lightweight checks
- Native tools available in official images (no curl installation needed)

### Negative

- Application may appear healthy when its database is down
- Manual investigation needed for hung (not crashed) processes
- Deep health information requires application-level endpoints

### Neutral

- Traefik can use deep health endpoints for routing (separate from container health)

---

## Implementation Notes

### YAML Anchor Defaults

```yaml
x-healthcheck-defaults: &healthcheck-defaults
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s

x-healthcheck-db: &healthcheck-db
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 60s
```

### Database Health Checks

```yaml
# PostgreSQL
postgres:
  healthcheck:
    <<: *healthcheck-db
    test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]

# MySQL
mysql:
  healthcheck:
    <<: *healthcheck-db
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]

# MongoDB
mongodb:
  healthcheck:
    <<: *healthcheck-db
    test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
    start_period: 90s

# Redis
redis:
  healthcheck:
    <<: *healthcheck-defaults
    test: ["CMD", "redis-cli", "ping"]
    start_period: 5s
```

### Application Health Checks

```yaml
# Node.js/Python with /health endpoint
app:
  healthcheck:
    <<: *healthcheck-defaults
    test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
    start_period: 60s
```

### Application Health Endpoint (Shallow)

```javascript
// Shallow - just confirms process is running
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

### Deep Health Endpoint (For Traefik)

```javascript
// Deep - for load balancer routing decisions
app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'degraded' });
  }
});
```

### Traefik Deep Health Check

```yaml
labels:
  - "traefik.http.services.app.loadbalancer.healthcheck.path=/health/ready"
  - "traefik.http.services.app.loadbalancer.healthcheck.interval=10s"
```

### Dependency Ordering

```yaml
services:
  postgres:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]

  app:
    depends_on:
      postgres:
        condition: service_healthy
```

### Timing Parameters

| Service | Interval | Timeout | Retries | Start Period |
|---------|----------|---------|---------|--------------|
| PostgreSQL | 10s | 5s | 5 | 60s |
| MySQL | 10s | 5s | 5 | 60s |
| MongoDB | 10s | 5s | 5 | 90s |
| Redis | 10s | 3s | 3 | 5s |
| Traefik | 15s | 5s | 3 | 10s |
| Applications | 30s | 10s | 3 | 60s |

---

## References

### Documentation

- [Docker Compose Health Checks](https://docs.docker.com/compose/compose-file/05-services/#healthcheck) - Official documentation

### Related ADRs

- [ADR-0201: Security Anchors](./0201-security-anchors.md) - Health check YAML anchors

### Internal Reference

- D4.1-HEALTH-CHECKS.md - Original decision document with timing formulas and full analysis

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |

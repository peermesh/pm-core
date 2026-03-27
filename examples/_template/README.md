# Add Your Own Application

This template provides everything you need to integrate a new application with the PeerMesh Docker Lab foundation. Follow this guide to deploy any Docker-based application with proper Traefik routing, Authelia protection, database integration, and resource limits.

---

## Before You Start

### Checklist

- [ ] Application has a Docker image (official or custom)
- [ ] Foundation is running (Traefik, Authelia)
- [ ] You know which database(s) the application needs
- [ ] You have a subdomain allocated (e.g., `myapp.yourdomain.com`)

---

## Step 1: Create Your Example Directory

```bash
# From project root
mkdir -p examples/myapp

# Copy template files
cp examples/_template/docker-compose.template.yml examples/myapp/docker-compose.myapp.yml
cp examples/_template/.env.example examples/myapp/.env.example
```

---

## Step 2: Choose Your Database Profile

Determine which database(s) your application needs:

| Application Type | Common Databases | Profile |
|------------------|------------------|---------|
| WordPress, Ghost, Drupal | MySQL | `profiles/mysql/` |
| Django, Rails, Node.js | PostgreSQL | `profiles/postgresql/` |
| AI/ML, Chat apps | MongoDB | `profiles/mongodb/` |
| Laravel, CMS platforms | MySQL + Redis | Both profiles |
| Modern SaaS | PostgreSQL + Redis | Both profiles |

If your application supports multiple databases, prefer **PostgreSQL** (better for commodity VPS, more features).

---

## Step 3: Configure Docker Compose

Edit `docker-compose.myapp.yml`:

### 3.1 Image Selection

```yaml
services:
  myapp:
    # Use official image
    image: organization/myapp:1.0.0

    # Or use specific version (recommended for production)
    image: organization/myapp:1.2.3
```

### 3.2 Database Dependency

```yaml
services:
  myapp:
    depends_on:
      # For PostgreSQL
      postgres:
        condition: service_healthy

      # For MySQL
      mysql:
        condition: service_healthy

      # For MongoDB
      mongodb:
        condition: service_healthy
```

### 3.3 Network Configuration

```yaml
services:
  myapp:
    networks:
      # Required: Traefik can reach your app
      - proxy-external

      # Required: App can reach database
      - db-internal

      # Optional: App can reach Authelia (for OIDC)
      - auth-internal
```

### 3.4 Environment Variables

```yaml
services:
  myapp:
    environment:
      # Database connection
      DATABASE_URL: postgresql://myapp:${MYAPP_DB_PASSWORD}@postgres:5432/myapp

      # Or for MySQL
      DATABASE_HOST: mysql
      DATABASE_PORT: 3306
      DATABASE_NAME: myapp
      DATABASE_USER: myapp
      # Password from secret file (see next section)
      DATABASE_PASSWORD_FILE: /run/secrets/myapp_db_password
```

### 3.5 Secrets

```yaml
services:
  myapp:
    secrets:
      - myapp_db_password

secrets:
  myapp_db_password:
    file: ./secrets/myapp_db_password
```

### 3.6 Resource Limits

Reference the D4.2 Resource Constraints decision:

| Application Type | Memory Limit | Reservation |
|------------------|--------------|-------------|
| Static site (Hugo, Jekyll) | 128M | 64M |
| Node.js app | 256-512M | 128-256M |
| Python/Django | 256-512M | 128-256M |
| Java/Kotlin | 512M-2G | 256M-1G |
| PHP (WordPress, Laravel) | 256-512M | 128-256M |

```yaml
services:
  myapp:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 3.7 Health Check

Choose the appropriate health check for your application:

```yaml
# HTTP health endpoint
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 60s

# TCP port check (if no HTTP endpoint)
healthcheck:
  test: ["CMD-SHELL", "nc -z localhost 8080 || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 5
  start_period: 30s
```

---

## Step 4: Configure Traefik Routing

### 4.1 Basic Routing (No Auth)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`myapp.${DOMAIN}`)"
  - "traefik.http.routers.myapp.entrypoints=websecure"
  - "traefik.http.routers.myapp.tls=true"
  - "traefik.http.routers.myapp.tls.certresolver=letsencrypt"
  - "traefik.http.services.myapp.loadbalancer.server.port=8080"
```

### 4.2 Protected by Authelia (All Routes)

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`myapp.${DOMAIN}`)"
  - "traefik.http.routers.myapp.entrypoints=websecure"
  - "traefik.http.routers.myapp.tls=true"
  - "traefik.http.routers.myapp.tls.certresolver=letsencrypt"
  - "traefik.http.routers.myapp.middlewares=authelia@file"
  - "traefik.http.services.myapp.loadbalancer.server.port=8080"
```

### 4.3 Mixed: Public + Protected Admin

```yaml
labels:
  - "traefik.enable=true"

  # Public routes
  - "traefik.http.routers.myapp.rule=Host(`myapp.${DOMAIN}`)"
  - "traefik.http.routers.myapp.entrypoints=websecure"
  - "traefik.http.routers.myapp.tls=true"
  - "traefik.http.routers.myapp.tls.certresolver=letsencrypt"
  - "traefik.http.routers.myapp.service=myapp"
  - "traefik.http.routers.myapp.priority=10"

  # Protected admin routes
  - "traefik.http.routers.myapp-admin.rule=Host(`myapp.${DOMAIN}`) && PathPrefix(`/admin`)"
  - "traefik.http.routers.myapp-admin.entrypoints=websecure"
  - "traefik.http.routers.myapp-admin.tls=true"
  - "traefik.http.routers.myapp-admin.tls.certresolver=letsencrypt"
  - "traefik.http.routers.myapp-admin.middlewares=authelia@file"
  - "traefik.http.routers.myapp-admin.service=myapp"
  - "traefik.http.routers.myapp-admin.priority=100"

  # Service
  - "traefik.http.services.myapp.loadbalancer.server.port=8080"
```

### 4.4 Native OIDC Integration

If your application supports OIDC natively:

```yaml
environment:
  OIDC_ISSUER: https://auth.${DOMAIN}
  OIDC_CLIENT_ID: myapp
  OIDC_CLIENT_SECRET_FILE: /run/secrets/oidc_client_myapp
  OIDC_CALLBACK_URL: https://myapp.${DOMAIN}/oauth/callback
  OIDC_SCOPE: openid profile email
```

You'll also need to configure the client in Authelia.

---

## Step 5: Generate Secrets

```bash
# Database password
openssl rand -base64 32 > secrets/myapp_db_password
chmod 600 secrets/myapp_db_password

# If using OIDC
openssl rand -base64 32 > secrets/oidc_client_myapp
chmod 600 secrets/oidc_client_myapp
```

---

## Step 6: Configure Environment

Edit `examples/myapp/.env.example`:

```bash
# ==============================================================
# MyApp Environment Configuration
# ==============================================================

# Domain
DOMAIN=example.com

# Database password (must match secret file)
MYAPP_DB_PASSWORD=

# Application-specific settings
MYAPP_SETTING_1=value
MYAPP_SETTING_2=value
```

---

## Step 7: Initialize Database

If your application needs database initialization, add to the database profile's init script:

### PostgreSQL

```bash
# Add to profiles/postgresql/init-scripts/01-init-databases.sh
MYAPP_PASSWORD=$(cat /run/secrets/myapp_db_password 2>/dev/null || echo "")
if [ -n "$MYAPP_PASSWORD" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        CREATE DATABASE myapp;
        CREATE USER myapp WITH PASSWORD '$MYAPP_PASSWORD';
        GRANT ALL PRIVILEGES ON DATABASE myapp TO myapp;
    EOSQL
fi
```

### MySQL

```bash
# Add to profiles/mysql/init-scripts/01-init-databases.sh
MYAPP_PASSWORD=$(cat /run/secrets/myapp_db_password 2>/dev/null || echo "")
if [ -n "$MYAPP_PASSWORD" ]; then
    mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
        CREATE DATABASE IF NOT EXISTS myapp;
        CREATE USER IF NOT EXISTS 'myapp'@'%' IDENTIFIED BY '$MYAPP_PASSWORD';
        GRANT ALL PRIVILEGES ON myapp.* TO 'myapp'@'%';
        FLUSH PRIVILEGES;
    EOSQL
fi
```

---

## Step 8: Deploy

```bash
# From project root
docker compose \
  -f docker-compose.yml \
  -f profiles/postgresql/docker-compose.postgresql.yml \
  -f examples/myapp/docker-compose.myapp.yml \
  --profile myapp \
  up -d
```

---

## Step 9: Validate

### Health Check

```bash
docker compose ps
# Should show: pmdl_myapp  running (healthy)
```

### Logs

```bash
docker compose logs myapp
```

### Resource Limits

```bash
docker stats --no-stream pmdl_myapp
# Verify MEM LIMIT shows your configured limit
```

### Traefik Routing

```bash
curl -I https://myapp.yourdomain.com
# Should return 200 OK (or 302 if Authelia protected)
```

### Authelia Protection

```bash
curl -I https://myapp.yourdomain.com/admin
# Should redirect to auth.yourdomain.com
```

---

## Production Readiness Checklist

- [ ] **Secrets**: All passwords/keys in secret files, not environment
- [ ] **Health check**: Application reports healthy correctly
- [ ] **Resource limits**: Memory limits set and verified
- [ ] **Logging**: JSON logging with rotation configured
- [ ] **Restart policy**: `unless-stopped` set
- [ ] **Network isolation**: Only necessary networks joined
- [ ] **Backup**: Data volumes identified and backup script working
- [ ] **TLS**: HTTPS working via Traefik
- [ ] **Authentication**: Authelia protection working (if applicable)
- [ ] **Database**: Connection working, initialization complete
- [ ] **Documentation**: README.md explains setup and maintenance

---

## Common Patterns

### WebSocket Support

```yaml
labels:
  - "traefik.http.middlewares.myapp-headers.headers.customrequestheaders.X-Forwarded-Proto=https"
  - "traefik.http.routers.myapp.middlewares=myapp-headers"
```

### Rate Limiting

```yaml
labels:
  - "traefik.http.middlewares.myapp-ratelimit.ratelimit.average=100"
  - "traefik.http.middlewares.myapp-ratelimit.ratelimit.burst=50"
  - "traefik.http.routers.myapp.middlewares=myapp-ratelimit"
```

### Custom Headers

```yaml
labels:
  - "traefik.http.middlewares.myapp-headers.headers.framedeny=true"
  - "traefik.http.middlewares.myapp-headers.headers.browserxssfilter=true"
```

### Sticky Sessions

```yaml
labels:
  - "traefik.http.services.myapp.loadbalancer.sticky.cookie=true"
  - "traefik.http.services.myapp.loadbalancer.sticky.cookie.name=myapp_session"
```

---

## Troubleshooting

### Container Won't Start

```bash
docker compose logs myapp
docker inspect pmdl_myapp
```

### Can't Connect to Database

```bash
# Test connection from app container
docker compose exec myapp nc -zv postgres 5432
docker compose exec myapp nc -zv mysql 3306
```

### Traefik Not Routing

```bash
# Check Traefik dashboard
docker compose logs traefik
# Verify labels are applied
docker inspect pmdl_myapp | grep -A50 Labels
```

### Authelia Not Protecting

```bash
docker compose logs authelia
# Verify access_control rules in authelia/configuration.yml
```

---

## References

- D1.1 Reverse Proxy: Traefik configuration patterns
- D3.4 Authentication: Authelia OIDC and ForwardAuth
- D4.2 Resource Constraints: Memory limits and profiles
- Foundation Compose: Core network and service definitions
- Database Profiles: `../../profiles/`

---

*Template Version: 1.0*
*Created: 2025-12-31*

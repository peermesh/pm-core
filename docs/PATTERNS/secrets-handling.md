# Secrets Handling Patterns

## The Problem

Different apps expect secrets in different ways. Using the wrong method causes auth failures or security issues.

This was discovered during testing of Manyfold, ActivityPods, Webhook, and other applications on the Docker Lab infrastructure. Each app had different expectations for how secrets should be provided, leading to silent authentication failures.

---

## Three Patterns

### Pattern A: File Path (_FILE suffix)

App reads secret from a file path. The app itself opens and reads the file.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

**How it works:**
1. Docker mounts the secret file at `/run/secrets/db_password`
2. App reads the `_FILE` environment variable to get the path
3. App opens the file and reads the secret value

**Advantages:**
- Secret never appears in environment variable listings
- Memory-only (tmpfs) by default in Docker
- Supports automatic rotation without restart

---

### Pattern B: Direct Environment Variable

App reads secret directly from environment variable.

```yaml
services:
  myapp:
    image: myapp:latest
    environment:
      DATABASE_PASSWORD: ${DB_PASSWORD}
```

**With docker-compose and .env file:**
```bash
# .env file (gitignored)
DB_PASSWORD=supersecret123
```

**How it works:**
1. Docker Compose interpolates `${DB_PASSWORD}` from `.env` or shell environment
2. Value is passed directly to container's environment
3. App reads standard environment variable

**Advantages:**
- Simple, works with any app
- No special app support needed
- Easy local development

**Disadvantages:**
- Secret visible in `docker inspect`
- Secret visible in `/proc/<pid>/environ`
- May appear in logs

---

### Pattern C: Docker Secrets Native

App has native Docker Secrets support (reads directly from `/run/secrets/`).

```yaml
services:
  postgres:
    image: postgres:16
    secrets:
      - source: db_password
        target: postgres_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

**How it works:**
1. Docker mounts secret at `/run/secrets/postgres_password`
2. App automatically looks for secrets in `/run/secrets/` directory
3. No environment variable needed

**Advantages:**
- Most secure method
- Native to Docker Swarm
- Clean separation of secrets from config

**Disadvantages:**
- Requires app support
- Primarily designed for Swarm (works in Compose with file: source)

---

## How to Identify Which Pattern

### Step 1: Check App Documentation

Search for "secrets", "environment variables", or "configuration" in the app's docs.

Look for:
- References to `_FILE` suffix support
- Mentions of `/run/secrets/` directory
- Environment variable reference tables

### Step 2: Look for _FILE Suffix Support

Many database images support the `_FILE` convention:

```bash
# Check if app supports _FILE by looking at entrypoint
docker run --rm postgres:16 cat /docker-entrypoint.sh | grep "_FILE"
```

### Step 3: Check Source Code

For open source apps, search the codebase:

```bash
# Look for secret file reading patterns
grep -r "run/secrets" .
grep -r "_FILE" . | grep -i env
```

### Step 4: Trial and Error

If documentation is unclear:

```yaml
# Test Pattern A first (most secure)
environment:
  SECRET_KEY_FILE: /run/secrets/secret_key

# If that fails, try Pattern B
environment:
  SECRET_KEY: ${SECRET_KEY}
```

---

## Common Apps and Their Patterns

| App | Pattern | Environment Variable | Notes |
|-----|---------|---------------------|-------|
| **PostgreSQL** | A or B | `POSTGRES_PASSWORD_FILE` or `POSTGRES_PASSWORD` | Official image supports _FILE |
| **MySQL** | A or B | `MYSQL_ROOT_PASSWORD_FILE` or `MYSQL_ROOT_PASSWORD` | Official image supports _FILE |
| **MariaDB** | A or B | `MARIADB_ROOT_PASSWORD_FILE` or `MARIADB_ROOT_PASSWORD` | Official image supports _FILE |
| **Redis** | B | `REDIS_PASSWORD` | No _FILE support |
| **MongoDB** | A or B | `MONGO_INITDB_ROOT_PASSWORD_FILE` or `MONGO_INITDB_ROOT_PASSWORD` | Official image supports _FILE |
| **Node.js apps** | B | Varies | Typically direct env vars |
| **Go apps** | B | Varies | Typically direct env vars |
| **Rails/Ruby** | B | `SECRET_KEY_BASE` | Typically direct env vars |
| **Django** | B | `DJANGO_SECRET_KEY` | Typically direct env vars |
| **Manyfold** | B | `SECRET_KEY_BASE` | Tested - direct env only |
| **ActivityPods** | B | Various app-specific | Uses `SEMAPPS_*` variables |
| **GoToSocial** | B | `GTS_DB_PASSWORD`, etc. | Direct env vars |
| **PeerTube** | B | `POSTGRES_PASSWORD` | Direct env vars |

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Auth fails silently | Wrong secret pattern | Check app docs for expected format |
| Empty password error | File not mounted | Verify `secrets:` block in service |
| "file not found" | Wrong path in `_FILE` var | Use `/run/secrets/<name>` |
| Secret visible in logs | Using Pattern B | Switch to Pattern A if supported |
| App ignores secret | Wrong env var name | Check app-specific variable names |
| Connection refused | Database secret mismatch | Ensure app and DB use same secret |
| "Authentication failed" | Whitespace in secret file | Remove trailing newline from secret |

### Debugging Whitespace Issues

Secret files often have trailing newlines that cause auth failures:

```bash
# Check for trailing whitespace
xxd secrets/db_password.txt | tail -5

# Create secret without trailing newline
echo -n "mysecret" > secrets/db_password.txt

# Verify no newline
wc -c secrets/db_password.txt  # Should match string length exactly
```

---

## Test Commands

### Verify Secret is Mounted

```bash
# Check if secret file exists in container
docker exec <container> ls -la /run/secrets/

# Read secret value (careful with logs!)
docker exec <container> cat /run/secrets/db_password
```

### Verify Environment Variable

```bash
# List all env vars (will show secrets - use carefully)
docker exec <container> env | grep -i password

# Check specific variable
docker exec <container> sh -c 'echo $DATABASE_PASSWORD'
```

### Test Database Connection

```bash
# PostgreSQL
docker exec <db_container> psql -U postgres -c "SELECT 1"

# MySQL
docker exec <db_container> mysql -u root -p"$(cat secrets/db_password.txt)" -e "SELECT 1"
```

### Verify Secret File Content Matches

```bash
# Compare secret in file with what container sees
diff <(cat secrets/db_password.txt) <(docker exec <container> cat /run/secrets/db_password)
```

---

## Best Practices

### 1. Prefer Pattern A When Supported

If the app supports `_FILE` suffix, use it:

```yaml
# Preferred
environment:
  POSTGRES_PASSWORD_FILE: /run/secrets/db_password
secrets:
  - db_password

# Fallback only when _FILE not supported
environment:
  DATABASE_PASSWORD: ${DB_PASSWORD}
```

### 2. Never Commit Secrets

```gitignore
# .gitignore
secrets/
*.env
.env.*
!.env.example
```

### 3. Use Encrypted Secrets in Git

For team environments, use SOPS + age:

```bash
# Encrypt secrets file
sops -e secrets.yaml > secrets.enc.yaml

# Decrypt at deploy time
sops -d secrets.enc.yaml > secrets.yaml
```

See: `docs/SECRETS-MANAGEMENT.md` for full runbook.

### 4. Document App-Specific Requirements

Create per-app documentation:

```markdown
# MyApp Required Secrets

| Variable | Pattern | Secret Name | Notes |
|----------|---------|-------------|-------|
| `DB_PASSWORD` | B | - | Direct env var |
| `REDIS_URL` | B | - | Include password in URL |
```

### 5. Use Separate Secrets Per Environment

```yaml
secrets:
  db_password_prod:
    file: ./secrets/production/db_password.txt
  db_password_staging:
    file: ./secrets/staging/db_password.txt
```

---

## Migration Guide

### From Pattern B to Pattern A

When upgrading an app to use file-based secrets:

1. Create the secret file:
   ```bash
   echo -n "$CURRENT_PASSWORD" > secrets/db_password.txt
   ```

2. Update docker-compose.yaml:
   ```yaml
   services:
     app:
       environment:
         # Remove: DATABASE_PASSWORD: ${DB_PASSWORD}
         DATABASE_PASSWORD_FILE: /run/secrets/db_password
       secrets:
         - db_password

   secrets:
     db_password:
       file: ./secrets/db_password.txt
   ```

3. Redeploy:
   ```bash
   docker compose down && docker compose up -d
   ```

4. Remove old environment variable from `.env`

---

## References

- Universal Patterns Research: `../../.dev/ai/research/2026-01-03-universal-patterns-from-app-testing.md`
- Secrets Management Runbook: `docs/SECRETS-MANAGEMENT.md`
- Docker Secrets Documentation: https://docs.docker.com/compose/compose-file/09-secrets/

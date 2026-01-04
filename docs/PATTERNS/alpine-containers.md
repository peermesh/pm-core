# Alpine-Based Containers

Pattern guide for deploying and configuring Alpine Linux-based containers in Docker Lab.

---

## How to Identify

Alpine-based containers are common in the FOSS ecosystem due to their minimal footprint.

### Image Indicators

- **Tag keywords**: `alpine`, `slim`, `minimal`, `scratch`
- **Base image**: Alpine Linux (typically 5-10MB)
- **Common examples in Docker Lab**:
  - `almir/webhook` - Webhook automation
  - `gotosocial` - ActivityPub server
  - Many Node.js apps using `node:alpine`
  - Many Go applications (often scratch-based)

### Quick Check

```bash
# Inspect base image
docker inspect <image> | jq '.[0].Config.Cmd'

# Check available shells
docker run --rm <image> cat /etc/shells

# Check if curl or wget exists
docker run --rm <image> which curl wget
```

---

## What to Check

Before deploying an Alpine-based container, verify these items:

- [ ] Healthchecks use `wget` not `curl`
- [ ] Healthchecks use `127.0.0.1` not `localhost`
- [ ] Scripts use `#!/bin/sh` not `#!/bin/bash`
- [ ] No bash-specific syntax (pipefail, arrays, `[[ ]]`)
- [ ] Required tools are available or added via custom Dockerfile

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `curl: not found` | Alpine only has wget | Use `wget` instead of `curl` |
| `bash: not found` | Alpine only has ash/sh | Use `#!/bin/sh` shebang |
| `set: Illegal option -o pipefail` | bash-specific option | Remove `set -o pipefail` |
| `[[: not found` | bash-specific syntax | Use `[ ]` instead of `[[ ]]` |
| Connection refused on localhost | IPv6 resolution issue | Use `127.0.0.1` explicitly |
| `git: not found` | Tool not in minimal image | Add via `apk add git` |
| `jq: not found` | JSON tool not included | Add via `apk add jq` |

---

## Correct Patterns

### Healthcheck - Docker Compose

```yaml
# WRONG - curl not available in Alpine
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s

# CORRECT - wget with explicit IPv4
healthcheck:
  test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:3000/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

### Healthcheck - Variations

```yaml
# Basic health endpoint check
test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:3000/health || exit 1"]

# With timeout (useful for slow services)
test: ["CMD-SHELL", "wget -q --spider --timeout=5 http://127.0.0.1:3000/health || exit 1"]

# Check HTTP status code explicitly
test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1"]

# Fallback pattern (try health endpoint, then root)
test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:3000/health || wget -q --spider http://127.0.0.1:3000/ || exit 1"]

# ActivityPub nodeinfo endpoint
test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8080/.well-known/nodeinfo || exit 1"]
```

### Shell Script - POSIX Compliant

```sh
#!/bin/sh
# POSIX-compliant shell script for Alpine containers
# Passes: shellcheck -s sh script.sh

set -eu

# Logging function (no bash-isms)
log() {
    level="$1"
    shift
    printf '[%s] [%s] %s\n' "$(date -Iseconds)" "$level" "$*"
}

# Error handling (POSIX style, not bash trap ERR)
cleanup() {
    log "INFO" "Cleanup triggered"
}
trap cleanup EXIT

# Variable checks (use [ ] not [[ ]])
if [ -z "${APP_PORT:-}" ]; then
    APP_PORT=3000
fi

# Command existence check
if ! command -v wget >/dev/null 2>&1; then
    log "ERROR" "wget is required but not installed"
    exit 1
fi

# Main logic
log "INFO" "Starting application on port $APP_PORT"
exec /app/server --port "$APP_PORT"
```

### Custom Dockerfile - Adding Tools

```dockerfile
# When you need additional tools in a minimal image
FROM almir/webhook:latest

# Add commonly needed tools
RUN apk add --no-cache \
    git \
    docker-cli \
    docker-cli-compose \
    jq \
    curl

# If you need bash specifically (rare, prefer sh)
# RUN apk add --no-cache bash
```

### Environment Variable with Default

```sh
#!/bin/sh
# POSIX-compliant default value syntax

# CORRECT - works in sh
: "${DATABASE_URL:=postgres://localhost:5432/app}"
: "${LOG_LEVEL:=info}"

# Also correct
DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/app}"

# WRONG - bash-only syntax
# DATABASE_URL=${DATABASE_URL:="default"}  # Error in sh
```

---

## Test Commands

Verify your Alpine container setup is correct:

### Before Deployment

```bash
# 1. Check if image is Alpine-based
docker run --rm <image> cat /etc/os-release | grep -i alpine

# 2. Verify wget is available
docker run --rm <image> which wget

# 3. Check what shells are available
docker run --rm <image> ls -la /bin/sh /bin/bash 2>/dev/null || echo "bash not available"

# 4. Test healthcheck command manually
docker run --rm <image> wget -q --spider http://127.0.0.1:3000/health
```

### After Deployment

```bash
# 1. Check container health status
docker inspect --format='{{.State.Health.Status}}' <container>

# 2. View healthcheck logs
docker inspect --format='{{json .State.Health}}' <container> | jq .

# 3. Execute healthcheck manually inside running container
docker exec <container> wget -q --spider http://127.0.0.1:3000/health

# 4. Check for common issues in logs
docker logs <container> 2>&1 | grep -E "(curl|bash|not found|connection refused)"
```

### Script Validation

```bash
# Validate shell scripts are POSIX compliant
shellcheck -s sh scripts/*.sh

# Check for bash-isms in scripts
grep -rn '#!/.*bash\|set -o pipefail\|\[\[.*\]\]' scripts/
```

---

## Migration Checklist

When converting an existing deployment to work with Alpine:

1. [ ] Replace all `curl` with `wget` in healthchecks
2. [ ] Replace `localhost` with `127.0.0.1` in healthchecks
3. [ ] Change script shebangs from `#!/bin/bash` to `#!/bin/sh`
4. [ ] Remove `set -o pipefail` from scripts
5. [ ] Replace `[[ ]]` with `[ ]` in conditionals
6. [ ] Replace bash arrays with space-separated strings
7. [ ] Test scripts with `shellcheck -s sh`
8. [ ] Create custom Dockerfile if additional tools needed

---

## Related Patterns

- [Healthcheck Patterns](../HEALTHCHECK-PATTERNS.md) - General healthcheck guidelines
- [Secrets Management](../SECRETS-MANAGEMENT.md) - Secrets handling in containers
- [Troubleshooting](../TROUBLESHOOTING.md) - Debug failing containers

---

## References

- Pattern source: `2026-01-03-universal-patterns-from-app-testing.md` (Patterns 2, 3, 4, 6)
- Alpine Linux packages: https://pkgs.alpinelinux.org/packages
- ShellCheck: https://www.shellcheck.net/

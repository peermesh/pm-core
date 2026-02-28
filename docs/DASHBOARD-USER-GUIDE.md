# Docker Lab Dashboard - User Guide

## Overview

The Docker Lab Dashboard is a web-based monitoring and management interface for your Docker Compose infrastructure. It provides real-time visibility into container health, resource usage, volumes, and system metrics through a modern, responsive UI.

**Key Features:**

- Real-time container monitoring with CPU and memory metrics
- Multi-instance management for centralized monitoring across servers
- Volume and system information tracking
- Smart alerting for container health and resource thresholds
- Live event streaming via Server-Sent Events (SSE)
- Optional demo mode with read-only guest access

## Accessing the Dashboard

### Login

Navigate to your dashboard URL (typically `https://dockerlab.yourdomain.org/` or `http://localhost:8080/` for local development).

**Authentication:**

The dashboard uses simple username/password authentication configured via environment variables:

- **Username**: Set via `DOCKERLAB_USERNAME` (defaults to `admin`)
- **Password**: Set via `DOCKERLAB_PASSWORD` (required)

Enter your credentials and click "Sign In" to access the dashboard.

**Demo Mode (Optional):**

If your instance has demo mode enabled (`DOCKERLAB_DEMO_MODE=true`), you'll see an additional "Enter as Guest (View Only)" button on the login page. This allows visitors to explore the dashboard without credentials, but all write operations (like triggering syncs or managing instances) are disabled for guest users.

## Dashboard Home

After logging in, you'll see the main dashboard with several key sections:

### Container Status Overview

The top section displays aggregate container statistics:

- **Total Containers**: Number of all containers (running + stopped)
- **Running**: Number of active containers
- **Stopped**: Number of stopped containers
- **Unhealthy**: Number of containers failing health checks

Each metric is color-coded with status indicators (green for healthy, yellow for warnings, red for critical).

### Resource Overview

Real-time resource usage charts for each running container:

- **CPU Usage**: Percentage of CPU per container (updates every 10 seconds)
- **Memory Usage**: Memory consumed vs. limit per container (in MB)

The charts use Server-Sent Events (SSE) to stream live data without page refreshes. If you see empty charts initially, data will populate within 10 seconds of the first poll.

### Recent Events Feed

A live stream of container events including:

- Container starts/stops
- Health check changes
- Resource threshold warnings
- System events

Events are displayed with timestamps and color-coded severity (info, warning, critical).

## Containers Page

The Containers page provides detailed information about all Docker containers on your system.

**Information Displayed:**

For each container, you'll see:

- **Name**: Container name (from Docker Compose service name or container name)
- **Image**: Docker image and tag
- **Status**: Running state (running, exited, dead, etc.)
- **Health**: Health check status (healthy, unhealthy, none)
- **Uptime**: How long the container has been running
- **Profile**: Detected profile/project from Docker Compose labels
- **Ports**: Exposed ports (private port/protocol)
- **Networks**: Connected Docker networks
- **Resources**:
  - CPU usage percentage
  - Memory usage (current MB / limit MB)

**Features:**

- Containers are sorted alphabetically by name
- Running containers show live resource metrics
- Stopped containers show cached uptime from last run
- Health status is automatically detected from Docker health checks or inferred from running state

**Profile Detection:**

The dashboard intelligently detects which Docker Lab profile or project each container belongs to by examining Docker Compose labels:

- `com.docker.compose.service`
- `com.docker.compose.project`
- `pmdl.profile` (custom Docker Lab label)

## Volumes Page

The Volumes page lists all Docker volumes with usage information.

**Information Displayed:**

- **Name**: Volume name
- **Driver**: Volume driver (usually `local`)
- **Size**: Volume size in human-readable format (KB/MB/GB/TB)
- **In Use**: Whether the volume is currently mounted by any container
- **Used By**: List of container names using the volume
- **Mount Point**: Host filesystem path where volume is stored
- **Created**: Volume creation timestamp
- **Labels**: Docker labels attached to the volume

**Features:**

- Volumes are sorted alphabetically by name
- In-use status is determined by inspecting running containers' mounts
- Size information is displayed when available from Docker API
- Total volume count and cumulative size shown at top

**Use Cases:**

- Identify orphaned volumes (not in use by any container)
- Track storage consumption per volume
- Verify which containers are using shared volumes

## Images Page

The Images page shows Docker images currently present on your system.

**Information Displayed:**

- Image repository and tag
- Image ID (short hash)
- Size on disk
- Creation date

**Note**: This page provides read-only visibility. Image management (pulling, removing) should be done via the command line or deployment sync feature.

## System Info Page

The System Info page displays host system details and Docker environment information.

**Information Displayed:**

- **Hostname**: System hostname
- **Operating System**: Host OS (linux, darwin, etc.)
- **Architecture**: CPU architecture (amd64, arm64, etc.)
- **Docker Version**: Docker Engine version (when available)
- **Dashboard Uptime**: How long the dashboard service has been running
- **CPU Count**: Number of CPU cores available
- **Total Memory**: Total system RAM in MB

**Use Cases:**

- Verify system resources available for containers
- Check Docker environment configuration
- Troubleshoot platform-specific issues

## Multi-Instance Management

The Multi-Instance Management feature allows you to monitor multiple Docker Lab deployments from a single dashboard.

### What is an "Instance"?

An **instance** is a remote Docker Lab deployment running its own dashboard. When you register an instance, your primary dashboard can:

- View remote container lists
- Check health status of the remote deployment
- Trigger remote sync operations
- Aggregate monitoring across multiple servers

**Common Use Case**: You have Docker Lab running on multiple VPS servers (e.g., production, staging, development). Instead of logging into each dashboard separately, you can register all instances with your primary dashboard and monitor them centrally.

### The "This Instance" Card

When you open the Instances page, you'll see a card labeled **"This Instance"** at the top. This represents the local server you're currently viewing - the one running the dashboard you're logged into.

**Why isn't it clickable?** You're already viewing this instance. All the container, volume, and system pages show data from this instance.

**What it shows:**

- Instance name (from `DOCKERLAB_INSTANCE_NAME` or hostname)
- Instance ID (unique identifier)
- URL (the dashboard's own URL)
- Health status (always "healthy" since you can access it)
- Environment label (production, staging, development, local)

### How to Add a Remote Instance

To monitor another Docker Lab deployment from your primary dashboard:

**Step 1: Prepare the Remote Dashboard**

The remote server must:

1. Have Docker Lab Dashboard running and accessible via URL
2. Use the **same password** as your primary dashboard (via `DOCKERLAB_PASSWORD`)

The password acts as a shared secret for secure instance-to-instance communication.

**Step 2: Register the Instance**

1. Click the **"Add Instance"** button on the Instances page
2. Fill in the registration form:
   - **Name**: A friendly name (e.g., "Production Server", "Staging VPS")
   - **URL**: The full URL of the remote dashboard (e.g., `https://dockerlab-staging.example.com`)
   - **Description** (optional): Notes about this instance
   - **Token**: Leave blank to use the default shared password, or provide a custom token

3. Click **"Register"**

The system will:

- Generate a unique instance ID based on the URL
- Store the registration locally
- Perform an initial health check
- Add a card to the instances list

**Step 3: Verify Connection**

After registration, the new instance card will show:

- Health status (healthy/unhealthy/unknown)
- Last seen timestamp
- Version information (if available)
- Environment label

If the health check fails, verify:

- The remote dashboard URL is accessible from your primary server
- Both dashboards use the same `DOCKERLAB_PASSWORD`
- No firewall rules are blocking the connection

### Managing Connected Instances

Each registered instance card provides several actions:

**View Containers**

Click the "View Containers" button to see a list of all containers running on that remote instance. This opens a modal showing the same container details as the local Containers page.

**Trigger Sync**

Click "Trigger Sync" to tell the remote instance to pull latest Docker images and restart services. This is useful for:

- Deploying updates to remote servers
- Ensuring all instances run the same image versions
- Triggering manual deployments without SSH access

**Note**: Only authenticated (non-guest) users can trigger sync operations.

**Check Health**

Click "Check Health" to manually force a health check. The dashboard automatically checks all instances every 30 seconds, but you can trigger an immediate check if you suspect an issue.

**Remove Instance**

Click "Remove" to unregister the instance from your dashboard. This only removes the registration - it does not affect the remote server itself.

**Note**: Only authenticated (non-guest) users can remove instances.

### Instance Authentication

**Shared Secret Model:**

Multi-instance communication uses a shared secret approach. When you register an instance, the dashboard:

1. Hashes the token (or default password) and stores the hash
2. When communicating with the remote instance, sends the token in an `X-Instance-Token` header
3. The remote instance validates the token against its configured password

**Security Considerations:**

- Both instances must use HTTPS in production
- Use strong, unique passwords for `DOCKERLAB_PASSWORD`
- Consider network-level restrictions (VPN, IP allowlisting) for instance-to-instance traffic
- Guest users cannot register or modify instances

### Troubleshooting Multi-Instance

**Instance shows "unhealthy":**

- Verify the remote dashboard is running (`docker compose ps dashboard`)
- Check network connectivity (`curl -I <remote-url>/health`)
- Verify the shared password matches on both instances
- Check firewall rules on both servers

**"Invalid instance token" errors:**

- Passwords don't match between primary and remote dashboards
- Token was changed after registration (remove and re-register the instance)

**Containers view shows empty:**

- Remote instance may be blocking API requests
- Check that `DOCKERLAB_PASSWORD` is set on the remote instance
- Verify the remote dashboard has proper Docker socket access

## API Events / Live Updates

The dashboard uses Server-Sent Events (SSE) to stream real-time updates without polling.

**Event Types:**

- **containers**: Updated container list with resource metrics (every 10 seconds)
- **system**: System resource statistics (every 10 seconds)
- **error**: Errors fetching data from Docker API

**How It Works:**

When you load the dashboard, your browser opens a persistent SSE connection to `/api/events`. The server streams updates at regular intervals, and your browser updates the UI automatically.

**Keepalive**: The server sends keepalive comments every 30 seconds to prevent connection timeouts.

**Benefits:**

- No page refreshes needed
- Lower bandwidth than polling
- Near-instant updates when changes occur

## Deployment Sync

The Deployment page (under System Info or accessed via `/api/deployment`) shows deployment metadata and allows triggering image updates.

**Information Displayed:**

- **Environment**: Detected environment (production, staging, development, local)
- **Version**: Application version from `APP_VERSION` environment variable
- **Git Commit**: Current git commit SHA (short and full)
- **Deployed At**: Timestamp of last deployment
- **Sync Status**: Status of last sync operation

**Trigger Sync:**

Click the **"Trigger Sync"** button to:

1. Pull latest Docker images for all services
2. Optionally restart containers to apply updates (depends on configuration)

The sync operation executes a predefined script (via `SYNC_SCRIPT` env var) or runs `docker compose pull` by default.

**Note**: Only authenticated (non-guest) users can trigger sync.

**Use Cases:**

- Deploy updates without SSH access
- Coordinate deployments across multiple instances
- Verify deployed version matches expected commit

## Alerts

The Alerts page monitors system health and surfaces issues automatically.

**Alert Types:**

- **Container Stopped**: A container is in `exited` or `dead` state
- **Container Unhealthy**: Health check is failing
- **High CPU Usage**: Container exceeds CPU threshold (80% warning, 95% critical)
- **High Memory Usage**: Container exceeds memory threshold (80% warning, 90% critical)
- **High Disk Usage**: Disk space on key mount points exceeds threshold (80% warning, 90% critical)
- **Volume Orphan**: Volume not in use by any container (future feature)

**Severity Levels:**

- **Info** (blue): Informational notices
- **Warning** (yellow): Issues requiring attention
- **Critical** (red): Urgent problems affecting service availability

**Alert Details:**

Each alert shows:

- Title and description
- Affected resource (container or mount point)
- Timestamp
- Detailed metrics (e.g., CPU percent, memory usage)

**Use Cases:**

- Proactive monitoring without external tools
- Identify resource bottlenecks before they cause outages
- Track container health trends over time

## Troubleshooting

### Empty Resource Charts

**Symptom**: Container CPU/Memory charts show no data.

**Cause**: SSE connection not established or containers just started.

**Solution**:

1. Wait 10-15 seconds for the first data poll
2. Check browser console for SSE errors
3. Verify `/api/events` endpoint is accessible
4. Check that containers are actually running

### SSE Connection Errors

**Symptom**: Browser console shows repeated SSE errors or 401 Unauthorized.

**Cause**: Session expired or SSE not supported by reverse proxy.

**Solution**:

1. Refresh the page to re-authenticate
2. If using a reverse proxy (like Traefik), ensure it supports SSE:
   - Disable buffering for `/api/events` path
   - Set appropriate timeout values
   - Example Traefik config: `X-Accel-Buffering: no`

### Authentication Issues

**Symptom**: Repeatedly redirected to login page after entering correct credentials.

**Cause**: Session cookies not being set or cleared.

**Solution**:

1. Check that dashboard is served over HTTPS (cookies require `Secure` flag)
2. Verify browser allows cookies for the dashboard domain
3. Check for browser extensions blocking cookies
4. If testing locally without HTTPS, temporarily modify auth.go to disable `Secure` flag

### Instance Health Check Fails

**Symptom**: Remote instance shows "unhealthy" even though it's running.

**Cause**: Network connectivity or password mismatch.

**Solution**:

1. Test connectivity: `curl -I https://remote-instance/health`
2. Verify passwords match on both instances
3. Check firewall rules allow traffic between instances
4. Review dashboard logs on both primary and remote servers

### Volume Sizes Show as 0

**Symptom**: Volumes page shows 0 bytes for size.

**Cause**: Docker API doesn't always report volume size (depends on driver).

**Solution**:

This is expected behavior. Volume size is only available when Docker's `UsageData` API returns it, which varies by storage driver. The "In Use" status and mount information are still accurate.

## Configuration Reference

Key environment variables for the dashboard:

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKERLAB_USERNAME` | Login username | `admin` |
| `DOCKERLAB_PASSWORD` | Login password (required) | (none) |
| `DOCKERLAB_DEMO_MODE` | Enable demo mode with guest access | `false` |
| `DOCKERLAB_INSTANCE_NAME` | Name for this instance | hostname |
| `DOCKERLAB_INSTANCE_ID` | Unique instance identifier | auto-generated |
| `DOCKERLAB_INSTANCE_URL` | Public URL of this dashboard | (auto-detected) |
| `DOCKERLAB_INSTANCE_SECRET` | Shared secret for instance-to-instance auth | (same as password) |
| `DOCKER_HOST` | Docker socket proxy URL | `http://socket-proxy:2375` |
| `PORT` | Dashboard HTTP port | `8080` |
| `ENVIRONMENT` | Environment label (production/staging/dev) | (auto-detected) |
| `APP_VERSION` | Application version string | `0.1.0-mvp` |
| `SYNC_SCRIPT` | Custom sync script path | (uses `docker compose pull`) |

**Deprecated Variables** (still supported but prefer `DOCKERLAB_*`):

- `DASHBOARD_USERNAME` → Use `DOCKERLAB_USERNAME`
- `DASHBOARD_PASSWORD` → Use `DOCKERLAB_PASSWORD`
- `DEMO_MODE` → Use `DOCKERLAB_DEMO_MODE`
- `INSTANCE_NAME` → Use `DOCKERLAB_INSTANCE_NAME`

## Security Considerations

**Authentication:**

- Always use a strong, unique password for `DOCKERLAB_PASSWORD`
- Never commit passwords to version control
- Use Docker secrets or encrypted .env files for production

**Demo Mode:**

- Guest users have read-only access to all monitoring endpoints
- Write operations (sync, instance management) are blocked for guests
- Consider disabling demo mode in production (`DOCKERLAB_DEMO_MODE=false`)

**Multi-Instance:**

- Use HTTPS for all instance-to-instance communication
- Consider VPN or IP allowlisting for instance traffic
- Rotate passwords periodically across all instances

**Docker Socket Access:**

- Dashboard communicates with Docker via socket-proxy service
- Never expose Docker socket directly to untrusted networks
- socket-proxy provides read-only access with minimal capabilities

## Advanced Topics

### Custom Sync Scripts

To implement custom deployment logic, set the `SYNC_SCRIPT` environment variable to point to an executable script:

```bash
SYNC_SCRIPT=/usr/local/bin/deploy.sh
```

Your script should:

- Be executable (`chmod +x`)
- Exit 0 on success, non-zero on failure
- Print meaningful output (captured and shown to user)

Example script:

```bash
#!/bin/bash
set -e

echo "Pulling latest images..."
docker compose pull

echo "Restarting updated services..."
docker compose up -d

echo "Deployment complete!"
```

### Embedding in Traefik

The dashboard is designed to work behind Traefik reverse proxy. Key configuration:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dashboard.rule=Host(`dockerlab.example.com`)"
  - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
  - "traefik.http.services.dashboard.loadbalancer.server.port=8080"

  # Important for SSE support
  - "traefik.http.middlewares.sse-headers.headers.customresponseheaders.X-Accel-Buffering=no"
  - "traefik.http.routers.dashboard.middlewares=sse-headers"
```

### Persistent Instance Storage

Instance registrations are stored in `/data/instances.json` inside the dashboard container. To persist across container restarts, mount a volume:

```yaml
volumes:
  - dashboard_data:/data
```

Without persistence, you'll need to re-register instances after each container restart.

## Getting Help

**Documentation:**

- Main docs: `/Users/grig/work/peermesh/repo/peer-mesh-docker-lab/sub-repos/docker-lab/docs/`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Security guide: `docs/SECURITY.md`

**Logs:**

View dashboard logs:

```bash
docker compose logs -f dashboard
```

**Health Check:**

Test basic connectivity:

```bash
curl -I http://localhost:8080/health
# Should return: {"status":"healthy"}
```

**Important Note on Health Endpoint Authentication:**

The `/api/health` endpoint is **protected by authentication** by design. This is a secure-by-default boilerplate decision. External monitoring tools (like Uptime Kuma) that expect a public health endpoint will receive a 401 Unauthorized response.

**Why is the health endpoint authenticated?**

- **Security-first design**: All endpoints are auth-protected to prevent information disclosure
- **Consistent security model**: No exceptions to authentication policy in the default configuration
- **Intentional trade-off**: Security over convenience

**If you need a public health endpoint:**

Users who want to expose `/api/health` for external monitoring can modify the auth middleware to exempt it:

1. Edit `services/dashboard/handlers/auth.go`
2. Add a conditional check to skip authentication for `/api/health`
3. Example modification:
   ```go
   if r.URL.Path == "/api/health" {
       next.ServeHTTP(w, r)
       return
   }
   ```

This is a conscious architectural choice. If you need unauthenticated monitoring, you must explicitly opt-in by modifying the code.

**Common Issues:**

1. Containers not showing → Check Docker socket proxy is running
2. Charts empty → Wait 10 seconds for first poll, check SSE connection
3. Can't login → Verify `DOCKERLAB_PASSWORD` is set correctly
4. Instance registration fails → Check URL accessibility and password match

---

**Version**: 0.1.0-mvp
**Last Updated**: 2026-02-25

# Deploying Your Project on Docker Lab

## Overview

Docker Lab is a foundation -- you build your project on top of it. The recommended pattern is **fork + upstream remote**: you fork Docker Lab into your own repo, add your modules and configuration, and periodically pull upstream improvements.

This document covers the full setup from fork to first deploy. If you have not built a module yet, read this first, then follow the [Module Authoring Guide](module-authoring-guide.md) to create your application module.

## Why This Pattern

- **Your repo, your commits** -- All project-specific configuration lives in your repo
- **Absorb upstream changes** -- When Docker Lab improves security, adds features, or fixes bugs, you merge them in
- **Clean separation** -- Foundation code (Docker Lab) vs. your code (modules, .env, domain config) never mix
- **No submodules** -- Submodules are fragile, confusing, and break CI. Fork + remote is simpler

### Why Not Other Approaches

| Approach | Problem |
|----------|---------|
| Git submodule | Breaks CI, confuses contributors, requires manual sync, detached HEAD foot-guns |
| Copy-paste | No upgrade path -- you never get upstream fixes |
| Docker image of Docker Lab | Docker Lab is not a single container; it is a Compose orchestration layer. Packaging it as an image does not work |
| npm/binary package | Docker Lab is configuration files and shell scripts, not an installable binary |

The fork + upstream remote pattern avoids all of these problems. It is standard Git, requires no special tooling, and every developer already knows how to use it.

## Step-by-Step Setup

### 1. Fork or Clone Docker Lab

**Option A: Fork on GitHub (recommended for public projects)**

Fork `https://github.com/peermesh/docker-lab` via the GitHub UI, then clone your fork:

```bash
git clone https://github.com/YOUR-ORG/your-project-deploy.git
cd your-project-deploy
```

**Option B: Clone directly (for private projects)**

```bash
git clone https://github.com/peermesh/docker-lab.git your-project-deploy
cd your-project-deploy
git remote rename origin upstream
git remote add origin https://github.com/YOUR-ORG/your-project-deploy.git
git push -u origin main
```

Both options produce the same result: a repo you own with Docker Lab's code as the starting point.

### 2. Add Docker Lab as Upstream Remote

If you used Option A (GitHub fork), add the upstream remote manually:

```bash
git remote add upstream https://github.com/peermesh/docker-lab.git
git fetch upstream
```

If you used Option B, this is already done.

Verify your remotes:

```bash
git remote -v
# origin    https://github.com/YOUR-ORG/your-project-deploy.git (fetch)
# origin    https://github.com/YOUR-ORG/your-project-deploy.git (push)
# upstream  https://github.com/peermesh/docker-lab.git (fetch)
# upstream  https://github.com/peermesh/docker-lab.git (push)
```

### 3. Configure Your Project

```bash
# Copy and customize environment
cp .env.example .env

# Edit .env -- set these at minimum:
#   DOMAIN=yourdomain.com
#   ADMIN_EMAIL=you@example.com
#   ENVIRONMENT=production

# Generate secrets (database passwords, API keys, etc.)
./scripts/generate-secrets.sh

# Build the dashboard (it is not published to any registry)
docker compose build dashboard
```

### 4. Add Your Modules

Create your application module using the scaffold tool:

```bash
./launch_docker_lab_core.sh module create my-app
```

This generates the module structure under `modules/my-app/` with:
- `module.json` -- Module manifest (dependencies, version, lifecycle hooks)
- `docker-compose.yml` -- Service definitions
- `hooks/` -- Lifecycle scripts (install, start, stop, health, etc.)
- `.env.example` -- Module-specific environment variables
- `secrets-required.txt` -- Required secret files

Edit these files for your application. See the [Module Authoring Guide](module-authoring-guide.md) for detailed instructions on each file.

Validate your module before deploying:

```bash
./launch_docker_lab_core.sh module validate my-app
```

### 5. Commit Your Customizations

```bash
git add modules/my-app/
git commit -m "feat: add my-app module for project deployment"
```

Note: `.env` and `secrets/` are gitignored by default -- they contain secrets and should never be committed. Your module code, compose files, and hook scripts are safe to commit.

### 6. Deploy

```bash
# Start foundation services
./launch_docker_lab_core.sh up

# Enable your module
./launch_docker_lab_core.sh module enable my-app

# Verify everything is healthy
docker compose ps
./launch_docker_lab_core.sh module health my-app
```

### 7. Pull Upstream Updates

When Docker Lab releases improvements:

```bash
git fetch upstream
git merge upstream/main
```

Resolve conflicts if any occur (rare -- your work is in `modules/` and upstream does not touch that directory). After merging:

```bash
# Verify compose config is still valid
docker compose config --quiet

# Validate your modules
./launch_docker_lab_core.sh module validate my-app

# Rebuild dashboard if upstream changed it
docker compose build dashboard

# Restart services
./launch_docker_lab_core.sh down
./launch_docker_lab_core.sh up
./launch_docker_lab_core.sh module enable my-app
```

## What Lives Where

| Content | Location | Who Owns It |
|---------|----------|-------------|
| Foundation (Traefik, socket-proxy, networks) | `docker-compose.yml`, `foundation/` | Docker Lab upstream |
| Profiles (PostgreSQL, Redis, etc.) | `profiles/` | Docker Lab upstream |
| Scripts and tooling | `scripts/`, `launch_docker_lab_core.sh` | Docker Lab upstream |
| Your modules | `modules/your-app/` | You |
| Your environment config | `.env` | You (gitignored) |
| Your secrets | `secrets/` | You (gitignored) |
| Your domain/DNS config | `.env` + Traefik labels in your module | You |

The key insight: **your code lives exclusively in `modules/`**. Everything else belongs to upstream and should not be modified. This is what makes conflict-free merges possible.

## Conflict Avoidance Rules

1. **Never modify foundation files** -- If you need different Traefik config, use labels in your module's compose file
2. **Never modify profile files** -- If you need different PostgreSQL settings, use environment variables
3. **Never modify scripts** -- If you need custom scripts, put them in `modules/your-app/scripts/`
4. **Your .env is yours** -- It is gitignored, so it never conflicts
5. **Your modules are yours** -- Upstream will never add files to `modules/your-app/`

If you follow these rules, `git merge upstream/main` will succeed without conflicts in the vast majority of cases.

## When Conflicts Happen

If `git merge upstream/main` produces conflicts despite following the rules above:

| Conflicting File | Resolution |
|-----------------|------------|
| `docker-compose.yml` | Take upstream's version, re-apply your changes via module labels |
| `foundation/` | Take upstream's version (your modules use interfaces, not internals) |
| `scripts/` | Take upstream's version |
| `modules/your-app/` | Should never happen (upstream does not touch your modules) |

```bash
# Accept upstream's version for a specific file
git checkout --theirs docker-compose.yml
git add docker-compose.yml

# Or accept upstream for an entire directory
git checkout --theirs foundation/
git add foundation/
```

After resolving conflicts, always re-validate:

```bash
docker compose config --quiet
./launch_docker_lab_core.sh module validate my-app
```

## Example: peers.social

This is a real-world example of the fork + upstream remote pattern. The `peers.social` project is a social networking platform built as a Docker Lab module.

```bash
# 1. Fork docker-lab on GitHub → peers-social-deploy
git clone https://github.com/peermesh/peers-social-deploy.git
cd peers-social-deploy
git remote add upstream https://github.com/peermesh/docker-lab.git
git fetch upstream

# 2. Configure for peers.social production
cp .env.example .env
# Edit .env:
#   DOMAIN=peers.social
#   ADMIN_EMAIL=admin@peers.social
#   ENVIRONMENT=production
./scripts/generate-secrets.sh

# 3. Create the social-lab module
./launch_docker_lab_core.sh module create social-lab
# Edit modules/social-lab/module.json -- set dependencies, version, etc.
# Edit modules/social-lab/docker-compose.yml -- define services
# Implement hooks in modules/social-lab/hooks/

# 4. Validate and commit
./launch_docker_lab_core.sh module validate social-lab
git add modules/social-lab/
git commit -m "feat: add social-lab module for peers.social deployment"

# 5. Deploy
docker compose build dashboard
./launch_docker_lab_core.sh up
./launch_docker_lab_core.sh module enable social-lab

# 6. Later -- pull Docker Lab improvements
git fetch upstream
git merge upstream/main
# Test, rebuild, redeploy
```

The peers.social deployment uses:
- Domain: `peers.social` (main site), `ap.peers.social` (ActivityPub federation)
- DNS: Cloudflare
- Infrastructure: Hetzner VPS (2 vCPU, 4 GB RAM, 80 GB SSD)
- Module: `social-lab` under `modules/social-lab/`

## Lessons from First Deployment (peers.social)

The peers.social deployment was the first real-world project built on Docker Lab using the fork + upstream remote pattern. These lessons are now baked into the templates and guides, but they are documented here for context.

### Don't SCP node_modules (or any build artifacts)

The initial deployment attempt SCP'd the entire module directory to the VPS, including `node_modules/`. This broke the deployment because native bindings (compiled on macOS) are incompatible with the Linux VPS. The Dockerfile already runs `npm install` (or equivalent) during the build step, so build artifacts should never be transferred.

**Fix:** The module template now includes a `.gitignore` that excludes `node_modules/`, `dist/`, `build/`, and other build artifacts. This keeps both git repos and SCP transfers clean. Let the Dockerfile handle dependency installation on the target platform.

### Secret file permissions for non-root containers

Docker secrets (the `secrets:` directive in Compose) handle permissions via the `mode:` field. But if you bind-mount config or secret files from the host instead, the container inherits the host file's permissions. A non-root container process cannot read a file owned by root with `0600` permissions.

**Fix:** Set `chmod 644` or `0444` on host-side secret/config files before starting the container. The module template's secrets section now documents this distinction. For Docker-managed secrets, use `mode: 0444` in the service-level secret declaration.

### Root domain vs. subdomain routing

The module template defaulted to subdomain routing (`mymodule.${DOMAIN}`), which assumes the module is one of several services under a shared domain. But peers.social IS the domain -- the social-lab module serves `peers.social` directly, not `social-lab.peers.social`.

**Fix:** The module template now documents both patterns side by side:
- **Pattern A (subdomain):** `Host(\`${MY_MODULE_SUBDOMAIN:-mymodule}.${DOMAIN}\`)` -- for modules that are one service among many.
- **Pattern B (root domain):** `Host(\`${DOMAIN}\`)` -- for modules that ARE the primary app for the domain.

### Connection resolver profile limitation

The connection resolver (`launch_docker_lab_core.sh module enable`) currently does not discover services defined in profile compose files (e.g., `profiles/database/docker-compose.yml`). If your module declares a dependency on a profile-provided service, the resolver will not find it.

**Status:** Known issue, being addressed separately. Workaround: manually start profile services before enabling your module, and omit the profile service from `module.json` dependency declarations until resolver support is added.

## Multiple Environments

If you deploy to multiple environments (dev, staging, production), use separate `.env` files per environment and select the appropriate one at deploy time:

```bash
# Create per-environment configs
cp .env.example .env.development
cp .env.example .env.staging
cp .env.example .env.production

# Edit each with environment-specific values (DOMAIN, ENVIRONMENT, etc.)

# Deploy to a specific environment
cp .env.staging .env
./launch_docker_lab_core.sh up
```

Keep `.env.development`, `.env.staging`, and `.env.production` gitignored (they contain secrets). Document the required variables in `.env.example` so new team members know what to configure.

## Backward Compatibility

The fork + upstream remote pattern is fully backward compatible with the existing single-repo deployment model (clone Docker Lab, add modules, deploy). If you are already running Docker Lab from a direct clone, you can adopt this pattern by adding an upstream remote:

```bash
cd /opt/docker-lab  # or wherever your existing install lives
git remote add upstream https://github.com/peermesh/docker-lab.git
git remote rename origin upstream-old  # if you cloned directly
# You now have the upstream remote and can start merging
```

## Summary

1. Fork Docker Lab into your own repo
2. Add `upstream` remote pointing to Docker Lab
3. Configure `.env` and generate secrets
4. Build your modules in `modules/`
5. Deploy with `launch_docker_lab_core.sh`
6. Periodically `git fetch upstream && git merge upstream/main` for updates
7. Never modify foundation files -- keep your code in `modules/`

# Module Rubric -- Quality and Compatibility Checklist

**Version:** 0.2.0
**Last Updated:** 2026-02-26

---

## Purpose

Every module in the Docker Lab ecosystem must meet these requirements to be considered well-formed and compatible with the foundation layer. A "module" here means a **Docker Lab infrastructure extension** (Tier 4 in the four-tier architecture) -- a self-contained directory under `modules/` with a manifest, compose file, lifecycle hooks, and documentation. This rubric does not apply to foundation services, profiles, or examples, which are separate architectural layers with different requirements.

For the full architectural context -- including why the foundation is not a module, how modules differ from profiles and examples, and how the naming works across the PeerMesh ecosystem -- see [MODULE-ARCHITECTURE.md](MODULE-ARCHITECTURE.md).

This rubric defines the quality bar for modules and serves as a validation checklist during:
- Module development
- Code review
- Integration testing
- Release approval

**Status:** This rubric is based on existing module patterns and the architecture analysis completed 2026-02-25. It will be finalized after [ADR-0500](decisions/0500-module-architecture.md) is formally accepted.

---

## Required Files

Every module MUST have the following files:

### Core Files
- [ ] `module.json` - Module manifest with all required fields
- [ ] `docker-compose.yml` - Docker Compose fragment for service definition
- [ ] `README.md` - User-facing documentation

### Lifecycle Hooks
- [ ] `hooks/install.sh` - Installation script
- [ ] `hooks/start.sh` - Start script (optional if service starts via compose)
- [ ] `hooks/stop.sh` - Stop script (optional if service stops via compose)
- [ ] `hooks/uninstall.sh` - Cleanup script
- [ ] `hooks/health.sh` - Health check script

### Optional Files
- [ ] `.env.example` - Example environment variables (if module uses env vars)
- [ ] `configs/` - Directory for configuration templates
- [ ] `dashboard/` - Dashboard integration components (if module has UI)
- [ ] `tests/` - Module-level test scripts (smoke tests, integration tests)

**Convention:** The standard directory for lifecycle scripts is `hooks/`. Some older modules (notably test-module) use `scripts/` instead. New modules should use `hooks/` for consistency with the dominant convention in production modules (backup, pki, mastodon, federation-adapter). The `module.json` `lifecycle` section must reference whichever path the scripts actually live at.

---

## Manifest Requirements (module.json)

### Required Top-Level Fields

```json
{
  "$schema": "../../foundation/schemas/module.schema.json",
  "id": "module-identifier",           // kebab-case, unique
  "version": "X.Y.Z",                   // semver format
  "name": "Human Readable Name",
  "description": "Brief description",
  "author": {
    "name": "Author Name"               // email optional
  },
  "license": "MIT",                     // or other SPDX identifier
  "tags": []                            // array of descriptive tags
}
```

### Foundation Compatibility

```json
{
  "foundation": {
    "minVersion": "1.0.0"               // minimum foundation version required
  }
}
```

### Dependencies

```json
{
  "requires": {
    "connections": [],                  // network connections needed
    "modules": []                       // other modules this depends on
  },
  "provides": {
    "connections": [],                  // connections this module offers
    "events": []                        // events this module emits
  }
}
```

**Pattern for events:** Use namespaced event names like `module-id.action.result`
- Examples: `backup.postgres.started`, `pki.certificate.issued`

### Dashboard Integration (if applicable)

```json
{
  "dashboard": {
    "displayName": "Display Name",
    "icon": "icon-name",                // icon identifier
    "routes": [
      {
        "path": "/module-path",
        "nav": {
          "label": "Nav Label",
          "order": 100                  // navigation order
        }
      }
    ]
  }
}
```

Optional dashboard elements:
- `statusWidget` - Widget shown on dashboard home
- `configPanel` - Configuration UI component

### Lifecycle Hooks

```json
{
  "lifecycle": {
    "install": "./hooks/install.sh",
    "start": "./hooks/start.sh",        // can be null
    "stop": "./hooks/stop.sh",          // can be null
    "uninstall": "./hooks/uninstall.sh",
    "health": "./hooks/health.sh"
  }
}
```

Install hook can include advanced options:
```json
{
  "install": {
    "script": "./hooks/install.sh",
    "timeout": 120,                     // seconds
    "retries": 2,
    "retryDelay": 5
  }
}
```

### Configuration Schema

```json
{
  "config": {
    "version": "1.0",
    "properties": {
      "settingName": {
        "type": "string|number|boolean",
        "description": "Human-readable description",
        "default": "default-value",     // optional
        "env": "ENV_VAR_NAME"           // environment variable mapping
      }
    },
    "required": []                      // array of required property names
  }
}
```

**Secret handling:** Mark sensitive values with `"secret": true`
```json
{
  "apiKey": {
    "type": "string",
    "description": "API key (use secrets file)",
    "secret": true,
    "env": "MODULE_API_KEY"
  }
}
```

---

## Docker Compose Requirements

### Service Definition

- [ ] Service name follows convention: `pmdl_<module-id>`
- [ ] Uses specific image version (no `:latest` tag)
- [ ] Includes health check (unless service has none)
- [ ] Properly configured restart policy

### Security Configuration

- [ ] Non-root user execution (see ADR-0200)
- [ ] Drop unnecessary capabilities with `cap_drop`
- [ ] Set `no-new-privileges: true`
- [ ] Read-only root filesystem where possible (see GOTCHAS.md #12 for exceptions)

### Network Configuration

- [ ] Connected to appropriate networks (see ADR-0002 four-network topology)
- [ ] No unnecessary network access
- [ ] Uses internal networks for inter-service communication

### Traefik Integration (for web-facing services)

Required labels for HTTP services:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.<module-id>.rule=Host(`<subdomain>.${DOMAIN}`)"
  - "traefik.http.routers.<module-id>.entrypoints=websecure"
  - "traefik.http.routers.<module-id>.tls.certresolver=letsencrypt"
  - "traefik.http.services.<module-id>.loadbalancer.server.port=<port>"
```

### Volume Management

- [ ] Uses named volumes (not bind mounts for data)
- [ ] Volume names prefixed with `pmdl_`
- [ ] Volumes declared in `volumes:` section

---

## README Requirements

### Sections

Every module README MUST include:

1. **Title and Description**
   - Clear explanation of what the module does
   - Key features and capabilities

2. **Prerequisites**
   - Foundation version required
   - Any dependent modules
   - External requirements (API keys, etc.)

3. **Installation**
   - Step-by-step installation instructions
   - Configuration requirements
   - Environment variables needed

4. **Usage**
   - How to access/use the module
   - Common operations
   - Examples

5. **Configuration**
   - All configurable options
   - Default values
   - Secret management instructions

6. **Troubleshooting**
   - Common issues and solutions
   - Health check interpretation
   - Logs location

7. **Architecture**
   - How the module integrates with foundation
   - Network topology
   - Data flow

### Documentation Quality

- [ ] Clear, concise writing
- [ ] Code examples where appropriate
- [ ] Links to related documentation
- [ ] Version compatibility noted

---

## Integration Requirements

### Dashboard Registration

If module has web UI:
- [ ] Dashboard route defined in module.json
- [ ] Dashboard components exist in `dashboard/` directory
- [ ] Health status exposed via API endpoint

### Health Check Endpoint

- [ ] Health check script returns proper exit codes (0 = healthy)
- [ ] Health check is shallow (see ADR-0300)
- [ ] Health check timeout is reasonable (< 30 seconds)
- [ ] Health check provides clear failure messages

### Secret Management

- [ ] Follows file-based secrets pattern (see ADR-0003)
- [ ] No hardcoded secrets in any files
- [ ] `.env.example` provided if module uses environment variables
- [ ] Secrets file path follows convention: `secrets/<module-id>/`

### Event Emission

If module emits events:
- [ ] Events documented in module.json `provides.events`
- [ ] Event names follow namespacing convention
- [ ] Event format documented in README or docs/

---

## Testing Requirements

### Smoke Test

- [ ] Module installs without errors
- [ ] Module starts successfully
- [ ] Health check passes after startup
- [ ] Services are accessible on expected ports/paths

### Integration Test

- [ ] Module integrates with foundation services
- [ ] Traefik routing works (if applicable)
- [ ] Dashboard integration works (if applicable)
- [ ] Dependencies are satisfied

### Lifecycle Test

- [ ] Install hook succeeds
- [ ] Start hook succeeds (if present)
- [ ] Health check passes
- [ ] Stop hook succeeds (if present)
- [ ] Uninstall hook cleans up properly

---

## Naming Conventions

### Files and Directories

- Module directory: `modules/<module-id>/` (kebab-case)
- Hooks: `hooks/<action>.sh` or `scripts/<action>.sh`
- Configs: `configs/<config-name>`
- Dashboard: `dashboard/<ComponentName>.html`

### Services and Containers

- Container name: `pmdl_<module-id>` or `pmdl_<module-id>_<service-name>`
- Network names: Use foundation networks (web-public, web-internal, data, admin)
- Volume names: `pmdl_<module-id>_<volume-purpose>`

### Environment Variables

- Prefix: `<MODULE_ID>_` (uppercase with underscores)
- Example: `BACKUP_LOCAL_PATH`, `PKI_CA_NAME`

---

## Security Requirements

### Image Selection

- [ ] Use official images or well-maintained alternatives
- [ ] Pin specific version tags (not `:latest`)
- [ ] Document image provenance in README
- [ ] Consider supply chain security (see SUPPLY-CHAIN-SECURITY.md)

### Container Hardening

- [ ] Non-root user (UID > 1000)
- [ ] Minimal capabilities (`cap_drop: ["ALL"]`)
- [ ] `no-new-privileges: true`
- [ ] Read-only root filesystem (where possible)
- [ ] No privileged mode

### Network Security

- [ ] Minimal network exposure
- [ ] Use internal networks for inter-service communication
- [ ] TLS for external endpoints
- [ ] No host network mode

### Secret Handling

- [ ] No secrets in environment variables
- [ ] Use file-based secrets (ADR-0003)
- [ ] Secrets mounted read-only
- [ ] Secret files have restrictive permissions (0400)

---

## Quality Standards

### Code Quality

- [ ] Shell scripts use `set -euo pipefail`
- [ ] Scripts have error handling
- [ ] Scripts log actions clearly
- [ ] Scripts are idempotent (can run multiple times safely)

### Documentation Quality

- [ ] README is complete and accurate
- [ ] Configuration options documented
- [ ] Examples provided
- [ ] Version compatibility noted

### Maintainability

- [ ] Clear, self-documenting code
- [ ] Consistent with other modules
- [ ] Follows foundation patterns
- [ ] No technical debt notes without issues

---

## Compatibility Matrix

### Foundation Versions

| Module Version | Foundation Min Version | Notes |
|----------------|------------------------|-------|
| 0.x.x | 1.0.0 | Experimental |
| 1.x.x | 1.0.0 | Stable |

### Dependencies

Document module dependencies:
- Required modules
- Optional enhancements
- Conflicting modules (if any)

---

## Validation Process

### Pre-Integration Checklist

Before submitting a module for integration:

1. **Files**: All required files present
2. **Manifest**: module.json validates against schema
3. **Compose**: docker-compose.yml is valid YAML
4. **Scripts**: All hooks are executable and work
5. **Docs**: README is complete
6. **Security**: Security requirements met
7. **Testing**: Smoke tests pass

### Integration Testing

1. Install module on clean foundation
2. Verify health check passes
3. Test basic functionality
4. Verify dashboard integration (if applicable)
5. Test lifecycle operations (start, stop, restart)
6. Test uninstall (verify cleanup)

### Review Criteria

Reviewers should check:
- Adherence to this rubric
- Security best practices
- Documentation quality
- Code quality and style
- Integration with foundation

---

## Notes for Module Developers

### Getting Started

1. Copy `foundation/templates/module-template/` as starting point
2. Review existing modules (backup, pki) for patterns
3. Read foundation documentation in `docs/`
4. Test thoroughly on local foundation instance

### Common Gotchas

- **Socket-proxy read_only**: Don't set read_only on docker-socket-proxy (see GOTCHAS.md #12)
- **Network topology**: Understand the four-network model (see ADR-0002)
- **Health checks**: Keep them shallow and fast (see ADR-0300)
- **Secrets**: Never use environment variables for secrets (see ADR-0003)

### Resources

- [MODULE-ARCHITECTURE.md](./MODULE-ARCHITECTURE.md) - Module architecture deep-dive (four tiers, naming, implementation status)
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview
- [SECURITY.md](./SECURITY.md) - Security guidelines
- [GOTCHAS.md](./GOTCHAS.md) - Known issues and workarounds
- [ADR-0500](./decisions/0500-module-architecture.md) - Module architecture decision record
- [docs/decisions/](./decisions/) - Architecture Decision Records

---

## Pending Decisions

The architecture analysis (2026-02-25) resolved several open questions. The following are now documented:

- [x] **Foundation services are NOT modules** -- they are a separate architectural layer (Tier 1). This rubric applies only to Tier 4 modules. See [MODULE-ARCHITECTURE.md](MODULE-ARCHITECTURE.md).
- [x] **Different quality bars DO apply** -- foundation services have higher availability requirements; modules are optional extensions with lifecycle management.
- [x] **Naming conventions** -- "Module" refers to Docker Lab infrastructure extensions. Parent-project components should be called "services" or "components." See [ADR-0500](decisions/0500-module-architecture.md).

Still pending formal decision via ADR-0500:

- [ ] Template scope -- whether `foundation/templates/module-template/` should be updated or replaced by the hello-module (WO-104)
- [ ] Hook directory standardization -- formal decision to standardize on `hooks/` over `scripts/`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-02-26 | Initial draft based on existing module patterns |
| 0.2.0 | 2026-02-26 | Refined with architecture analysis findings; clarified scope to Tier 4 modules only; standardized hooks/ convention; updated pending decisions |

---

## Feedback

This is a living document. If you find issues or have suggestions, please:
- Open an issue in the project repository
- Discuss in the developer community channels
- Submit a PR with proposed changes

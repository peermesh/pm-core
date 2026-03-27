# ADR-0501: Container Naming Convention

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-27 |
| **Status** | accepted |
| **Authors** | AI-assisted (WO-108) |
| **Reviewers** | Owner review pending |

---

## Context

An audit of all `container_name` values across the project (WO-PMDL-2026-02-27-108) revealed significant inconsistency:

- **Foundation services** use `pmdl_` prefix with underscore: `pmdl_traefik`, `pmdl_postgres`, `pmdl_socket-proxy`
- **Examples** consistently use `pmdl_` prefix: `pmdl_ghost`, `pmdl_castopod`, `pmdl_listmonk`
- **Profiles** mostly use `pmdl_` prefix: `pmdl_redis`, `pmdl_minio`
- **One exception**: MongoDB profile uses `pmdl-mongodb` (hyphen instead of underscore)
- **Modules** are inconsistent: `pmdl_backup` (prefixed), `hello-module` (bare), `test-module-app` (bare with suffix)
- **Multi-container apps** use either `_role` suffix (`pmdl_pixelfed_worker`) or component names (`pmdl_synapse`)

The lack of a documented convention causes confusion when creating new modules and makes container identification harder in `docker ps` output.

**Constraints:**
- Renaming existing containers is a breaking change (data volumes, scripts, monitoring all reference names)
- Docker container names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]*`
- Names should be unique across the entire Docker host
- Names should be recognizable in `docker ps` output

---

## Decision

**We will adopt the `pmdl_` prefix convention for all new containers in the project.**

The naming pattern is:

```
pmdl_{component}[_{role}]
```

Where:
- `pmdl_` is the project prefix (PeerMesh Core), using underscore as separator
- `{component}` is the application or service name (lowercase, hyphens allowed within)
- `{role}` is an optional suffix for multi-container deployments (e.g., `_worker`, `_db`, `_redis`)

### Examples

| Type | Single Container | Multi-Container |
|------|-----------------|-----------------|
| Foundation | `pmdl_traefik` | N/A |
| Module | `pmdl_hello-module` | `pmdl_hello-module_db` |
| Example | `pmdl_ghost` | `pmdl_pixelfed`, `pmdl_pixelfed_worker` |
| Profile | `pmdl_redis` | `pmdl_redis`, `pmdl_redis_exporter` |

### Why underscore for prefix separator

The `pmdl_` prefix uses underscore (`_`) because:
1. Docker Compose's default `COMPOSE_PROJECT_NAME` uses underscore separation
2. The majority (>90%) of existing containers already use this pattern
3. Underscore visually separates the project prefix from the component name
4. Hyphens within component names remain valid (`pmdl_hello-module`)

### Existing containers: NO RENAME

Existing containers will NOT be renamed. This includes the inconsistencies:
- `pmdl-mongodb` (should be `pmdl_mongodb` -- but renaming would break volume mounts)
- `hello-module` (should be `pmdl_hello-module` -- but this is a separate public repo example)
- `test-module-app` (should be `pmdl_test-module` -- but renaming would break test scripts)

These legacy names are grandfathered. New containers must follow the convention.

---

## Alternatives Considered

### Option A: No prefix (bare names)

**Description**: Use plain names like `traefik`, `postgres`, `ghost`.

**Pros**:
- Shorter, simpler
- Less typing

**Cons**:
- High collision risk on shared hosts
- Impossible to identify Core containers in `docker ps`
- Already rejected by existing practice (>90% use `pmdl_`)

**Why not chosen**: Collision risk and identification problems.

### Option B: Hyphen prefix (`pmdl-`)

**Description**: Use `pmdl-traefik`, `pmdl-postgres`, etc.

**Pros**:
- Slightly more readable than underscore
- Consistent separator character

**Cons**:
- Conflicts with hyphens in component names (`pmdl-hello-module` is ambiguous)
- Only one existing container uses this pattern (`pmdl-mongodb`)
- Breaks from >90% existing convention

**Why not chosen**: Ambiguity with component-name hyphens and conflicts with existing convention.

### Option C: Dynamic prefix (`${COMPOSE_PROJECT_NAME}_`)

**Description**: Use Docker Compose's project name variable for the prefix.

**Pros**:
- Allows running multiple Core instances on one host
- More flexible

**Cons**:
- Harder to predict container names
- Breaks static references in scripts and monitoring
- Only one existing container uses this pattern (`${COMPOSE_PROJECT_NAME:-pmdl}_webhook`)
- Adds complexity for minimal benefit (single-VPS deployment model)

**Why not chosen**: Added complexity not justified for the single-VPS deployment model. Can be revisited if multi-instance becomes a requirement.

---

## Consequences

### Positive

- Clear, documented standard for new module and example contributors
- Easy container identification in `docker ps` output
- Reduced collision risk on shared Docker hosts
- Consistent with >90% of existing containers

### Negative

- Existing inconsistencies (3 containers) are grandfathered and not corrected
- Module template and hello-module example should be updated to show the `pmdl_` pattern

### Neutral

- The convention is a recommendation, not enforced by tooling (no CI check yet)
- Future work could add a linting rule to verify container names in compose files

---

## Implementation Notes

- **Module template** (`foundation/templates/module-template/docker-compose.yml`): Update the placeholder `container_name` to show the `pmdl_` prefix pattern
- **Hello module**: The hello-module is a separate public repo designed to be customizable; its `container_name: hello-module` is acceptable as-is (users will rename)
- **New modules**: Should use `pmdl_{module-name}` format
- **New examples**: Should use `pmdl_{app-name}` format
- **CI enforcement**: Consider adding a shellcheck-style linter for compose files that warns on unprefixed container names (future WO)

---

## References

### Related ADRs

- [ADR-0500: Module Architecture](./0500-module-architecture.md) - Module layer definitions
- [ADR-0400: Docker Compose Profile System](./0400-profile-system.md) - Profile organization

### External Discussions

- [Docker container naming rules](https://docs.docker.com/reference/cli/docker/container/run/#name) - Official Docker naming constraints

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-27 | Initial draft from WO-108 audit | AI-assisted |

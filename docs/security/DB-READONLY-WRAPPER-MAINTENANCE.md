# DB Read-Only Wrapper Maintenance

## Purpose
Document maintenance requirements for database read-only hardening wrappers introduced for WO-071.

## Wrapper Inventory

- PostgreSQL: `profiles/postgresql/init-scripts/00-readonly-wrapper.sh`
- MySQL: `profiles/mysql/init-scripts/00-readonly-wrapper.sh`
- MongoDB: `profiles/mongodb/init-scripts/00-readonly-wrapper.sh`

Each wrapper prepares tmpfs-backed runtime write paths, then `exec`s the upstream image entrypoint.

## Coupling Risks

1. Upstream entrypoint path changes can break startup.
2. Upstream runtime write-path changes can require tmpfs updates.
3. Image user/group changes can require `chown` updates.

## Required Validation On Image Upgrades

1. Run `docker compose -f docker-compose.yml -f docker-compose.hardening.yml config -q`.
2. Start each DB profile with hardening overlay and verify health:
   - `postgres`
   - `mysql`
   - `mongodb`
3. Verify initialization path on empty volumes.
4. Verify graceful stop/start and data persistence.

## Rollback Plan

If wrapper behavior regresses after image upgrade:

1. Revert the affected wrapper and hardening change.
2. Temporarily disable `read_only: true` for that DB service in hardening overlay.
3. Open a remediation WO with exact upstream image change evidence.

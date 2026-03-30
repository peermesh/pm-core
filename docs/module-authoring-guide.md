# Module Authoring Guide

This guide is self-contained for the Core sub-repo and does not require parent-repo docs.

## Scope

Use this guide when creating or updating a Core module under `modules/<module-id>/`.

## Module baseline

Every module must include:

- `module.json` (identity, compatibility, lifecycle contract)
- `docker-compose.yml` (service definition and runtime labels)
- `hooks/` scripts (`install`, `start`, `stop`, `health`, optional `uninstall`)
- `.env.example` (documented module config)
- `secrets-required.txt` (file-based secret contract)

## Lifecycle requirements

Module lifecycle hooks must be safe, idempotent, and script-portable:

- use POSIX shell compatible scripting
- fail fast on invalid prerequisites
- avoid non-deterministic side effects
- report health clearly for `module health`

## Runtime contract

Module runtime must:

- consume file-based secrets (no hardcoded credentials)
- use explicit env vars for config discovery
- avoid reliance on undocumented host paths
- avoid production dependency on `process.cwd()` fallback discovery

## Validation workflow

Before merge:

1. `./launch_pm-core.sh module validate <module-id>`
2. `./launch_pm-core.sh module enable <module-id>`
3. `./launch_pm-core.sh module health <module-id>`
4. Confirm container status and logs

## Networking and routing

For web modules:

- attach to the expected Core proxy network
- define Traefik labels with explicit host rules
- keep domain behavior configurable via env vars

## Ownership boundary

- Core owns platform/runtime contract and orchestration behavior.
- Module owns feature semantics and module-specific behavior.

If a required behavior change affects shared runtime contract, update Core docs and tooling before adding module-only workarounds.

## Related docs (self-contained links)

- [DEPLOYMENT-REPO-PATTERN.md](DEPLOYMENT-REPO-PATTERN.md)
- [DEPLOYMENT-PROMOTION-RUNBOOK.md](DEPLOYMENT-PROMOTION-RUNBOOK.md)
- [WEBHOOK-DEPLOYMENT.md](WEBHOOK-DEPLOYMENT.md)
- [MULTI-ENVIRONMENT.md](MULTI-ENVIRONMENT.md)

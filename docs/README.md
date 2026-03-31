# Core Docs README (Agent Onboarding)

This README is the canonical onboarding entrypoint for agents working on a module that runs on PeerMesh Core.

Use this file when asked to make changes that must become part of Core, or when coordinating changes between:

- a module project repository (for example `peermesh-social`)
- the Core repository (`peermesh-core`)

## Who this is for

- Agents building or maintaining a module in a separate project repo.
- Agents asked to upstream shared runtime behavior into Core.
- Operators who need a deterministic "what belongs where" contract.

## Read this first (in order)

1. `docs/README.md` (root docs boundary and map)
2. `sub-repos/core/docs/DEPLOYMENT-REPO-PATTERN.md` (fork + upstream workflow)
3. `sub-repos/core/docs/module-authoring-guide.md` (module structure and lifecycle)
4. this file (`sub-repos/core/docs/README.md`) for Core-owned contract details

## Documentation management model (GAS-aligned)

This docs area follows the GAS "core + extensions" pattern:

- keep a small set of entrypoint docs that route to deeper guides
- place detailed, topic-specific guidance in dedicated docs files
- avoid hidden or orphaned docs; every new doc must be linked from an index/entrypoint
- keep ownership boundaries explicit (platform contract vs module semantics)

For Core docs changes, apply these rules:

1. Update links in `docs/README.md` and relevant `sub-repos/core/docs/*.md` entrypoints in the same change.
2. Keep this file as the primary onboarding route for agents working across module + Core repos.
3. Put planning/session artifacts in `.dev/ai/` (parent tree), not in `docs/`.
4. Use deterministic filenames and clear purpose so external agents can discover context quickly.

## Core-Module Ownership Contract (v1)

This is the approved split:

- **Core owns platform contract**
  - runtime discovery contract (paths, env vars, precedence)
  - instance layout and mount policy
  - orchestration semantics (restart/reload boundary)
  - structural validation in Core tooling
- **Module owns semantics**
  - module-specific schema meaning and business rules
  - module registries and API behavior
  - module-specific migrations and runtime logic

### Contract v1: discovery, paths, env injection

Core must provide the following environment contract to module runtime:

- `PEERMESH_INSTANCE_ROOT` (required in orchestrated deployments)
  - absolute path to instance root
- `PEERMESH_EXTENSIONS_CONFIG_PATH` (optional override)
  - absolute file path, highest precedence
- `PEERMESH_PLATFORM_CONFIG_PATH` (optional transition support)
  - absolute file path for platform config during migration windows

Default discovery path under instance root:

- `$PEERMESH_INSTANCE_ROOT/config/extensions.yaml` (current default for extension manifest)

Precedence order:

1. `PEERMESH_EXTENSIONS_CONFIG_PATH`
2. `PEERMESH_PLATFORM_CONFIG_PATH`
3. `$PEERMESH_INSTANCE_ROOT/config/extensions.yaml`
4. module local-dev fallback (non-production only, must be documented by module)

### Contract v1: mount/layout policy

Core-managed instance layout must include:

- `config/` (read-only in module runtime unless explicitly justified)
- optional extension handler subtree if applicable to module design
- clear separation of writable runtime state from configuration files

### Contract v1: validation boundary

Core validates structure and safety:

- required paths exist when extension feature is enabled
- file is readable
- file size within policy limits
- no path traversal outside allowed subtree

Module validates semantics:

- schema semantics, compatibility, and domain rules
- module-specific reload side effects and degraded behavior policy

### Contract v1: reload semantics

Core default rule:

- configuration changes are **restart-required** unless module explicitly documents and implements safe hot reload.

If module supports hot reload endpoint:

- operator may call module reload API for non-breaking config changes
- Core docs must state when restart is still required
- module health/readiness must reflect reload failures

## Cross-repo workflow for agents

When a change is "part of Core":

1. Implement contract/tooling/docs updates in `peermesh-core`.
2. Commit and merge to Core upstream first.
3. In module project repo, pull/update from Core upstream.
4. Remove module-side temporary discovery hacks once Core contract is available.
5. Re-run module validate + deploy smoke checks.

When a change is "part of Module":

1. Keep Core unchanged.
2. Implement semantics in module repo only.
3. If blocked by missing Core contract, open Core work item and stop local platform hacks.

## Fast decision checklist

Use this checklist before coding:

- Does this change define where config files live at runtime?
  - yes -> Core
- Does this change define module-specific schema meaning?
  - yes -> Module
- Does this change affect lifecycle/reload orchestration?
  - yes -> Core
- Does this change affect only module API behavior/business logic?
  - yes -> Module

## Files agents should check frequently

- `sub-repos/core/docs/DEPLOYMENT-REPO-PATTERN.md`
- `sub-repos/core/docs/module-authoring-guide.md`
- `sub-repos/core/docs/DATA-LAYER-OPERATIONS.md`
- `sub-repos/core/docs/SCHEMA-MAPPING-REFERENCE.md`
- `sub-repos/core/docs/MODULE-DATA-COMPOSITION-CONSUMER-GUIDE.md`
- `sub-repos/core/docs/DEPLOYMENT-PROMOTION-RUNBOOK.md`
- `sub-repos/core/docs/MULTI-ENVIRONMENT.md`
- `sub-repos/core/docs/WEBHOOK-DEPLOYMENT.md`

## Event bus noop visibility (operators)

CI runs `scripts/validation/run-event-bus-noop-visibility-gate.sh`, which prints a deterministic JSON report about foundation noop artifacts, schema registration, and which modules declare eventbus requirements versus in-tree non-noop provider modules. The job does not fail by default.

For production or promotion pipelines that must not rely on a noop-only event bus snapshot, run the same validator with strict mode:

- `EVENT_BUS_NOOP_VISIBILITY_STRICT=1` (or `true` / `yes` / `required`): exit non-zero when any **required** `eventbus` connection in `modules/*/module.json` has no matching in-tree provider module for its preferred providers list.
- `EVENT_BUS_NOOP_VISIBILITY_STRICT=all`: exit non-zero when any module declares an eventbus requirement but **no** in-tree module provides a real eventbus (`redis`, `nats`, `kafka`, or `memory`).

CLI equivalents: `python3 scripts/validation/validate_event_bus_noop_visibility.py --strict` and `--strict-all`.

## Notes for module teams

- Do not depend on `process.cwd()` for production config discovery.
- Do not require undocumented host paths.
- Prefer env-injected absolute paths from this contract.
- Keep local-dev fallback behavior explicit and non-production scoped.


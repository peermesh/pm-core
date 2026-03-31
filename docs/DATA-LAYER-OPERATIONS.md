# Data Layer Operations Guide

This guide is the ARCH-008 operator and adapter baseline for the current data-layer implementation in `modules/social/app`.

## Runtime architecture baseline

Current runtime components:

- `lib/data-layer/adapter-contract.js`
- `lib/data-layer/adapter-registry.js`
- `lib/data-layer/data-orchestrator.js`
- `lib/data-layer/event-bus.js`

Execution model:

1. Adapters register with `AdapterRegistry`.
2. A primary adapter is selected via `setPrimary()`.
3. `DataOrchestrator` writes to primary first, then replicates to active secondaries.
4. `DataEventBus` publishes mutation events to subscribers.

## Operator workflow

Run baseline data-layer checks from `sub-repos/core`:

```bash
./scripts/validation/run-adapter-boundary-gate.sh
./scripts/validation/run-arch008-data-sovereignty-workflow.sh
```

Run ARCH-008 social app tests from `sub-repos/core/modules/social/app`:

```bash
node --test test/data-layer.adapter-conformance.test.js
node --test test/data-layer.runtime-hotplug-integration.test.js
node --test test/data-layer.sovereignty-workflow.test.js
```

## Primary backend selection

Selection policy is registry-driven:

- call `setPrimary(adapterId)` for explicit primary selection.
- keep at least one secondary active for fallback-read and replication.
- keep adapter boundaries strict: backend imports stay inside adapter modules (enforced by validator).

## Adapter development checklist

When adding a new backend adapter:

1. Implement contract behavior expected by `assertAdapterContract` in `adapter-contract.js`.
2. Declare capability flags and semantics clearly (query/subscribe/export/import/delete behavior).
3. Add adapter coverage to `test/data-layer.adapter-conformance.test.js`.
4. If adapter is append-only, document delete semantics as `tombstone_or_noop`.
5. Keep backend-specific imports in adapter files only.

## Migration and sovereignty workflow

Sovereignty workflow validates export/import integrity and delete semantics:

- workflow lib: `lib/data-layer/sovereignty-workflow.js`
- runner: `scripts/run-data-sovereignty-workflow.mjs`
- validation wrapper: `sub-repos/core/scripts/validation/run-arch008-data-sovereignty-workflow.sh`

Expected output classes:

- migration integrity (solid -> sql baseline path)
- per-backend delete behavior (`true_delete` vs `tombstone_or_noop`)
- structured report (`json`) and operator summary (`md`)

## CI mapping

Current validate workflow coverage includes:

- adapter boundary gate (`adapter-import-boundary-gate`)
- conformance tests (`social-data-layer-conformance-tests`)
- runtime hot-plug/event integration test
- sovereignty workflow test and report generation step

# Schema Mapping Reference (ARCH-008)

This reference describes the current canonical-to-native mapping baseline used by the social app data-layer adapters.

## Canonical model baseline

Canonical records are treated as ActivityStreams-style objects with stable identity and actor/object linkage fields.

Core canonical expectations:

- deterministic id
- object type
- actor attribution
- created/updated timestamps
- content payload and metadata

## Adapter mapping snapshot

### Solid pathway (RDF-oriented)

- canonical id -> resource URI
- actor/object relations -> RDF predicates
- timestamps -> typed RDF datetime literals
- content map -> RDF properties

Round-trip note:

- expected to preserve semantic identity and core relations.
- RDF graph ordering is non-deterministic and not treated as semantic drift.

### SQL pathway

- canonical id -> primary key / unique column
- type/actor/object -> typed relational columns
- timestamps -> normalized datetime columns
- metadata -> structured columns or JSON payload column

Round-trip note:

- preserves key fields and queryable attributes used by conformance and sovereignty flows.
- SQL-normalization may reorder/normalize optional fields during serialization.

### P2P append-feed pathway

- canonical object -> append-only message entry
- canonical id -> message key or deterministic payload field
- timestamps -> feed event timestamp

Round-trip note:

- delete semantics are `tombstone_or_noop` for append-only history.
- historical entries remain readable; deletion is represented by later state markers.

## Lossy mapping baseline

Known lossy or normalized behavior in current baseline:

- feed ordering/transport metadata are adapter-specific and not canonicalized.
- optional nested fields may be normalized during SQL serialization.
- append-only adapters do not provide true physical deletion semantics.

## Validation hooks

Run these from `sub-repos/core`:

```bash
./scripts/validation/run-adapter-boundary-gate.sh
./scripts/validation/run-arch008-data-sovereignty-workflow.sh
```

Run these from `sub-repos/core/modules/social/app`:

```bash
node --test test/data-layer.adapter-conformance.test.js
node --test test/data-layer.sovereignty-workflow.test.js
```

These checks provide the current executable baseline for mapping integrity and cross-adapter migration behavior.

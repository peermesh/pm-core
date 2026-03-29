# PeerMesh Module Foundation

The Foundation defines the contracts, schemas, and validation helpers that keep Core modules consistent. The canonical module-authoring guide lives in the parent repository at [`../../../docs/module-authoring-guide.md`](../../../docs/module-authoring-guide.md). From here you can open the nested-repo landing notice at [`../docs/module-authoring-guide.md`](../docs/module-authoring-guide.md) to reach that canonical document. This README summarizes the foundation touchpoints around the guide but defers to the canonical document for workflow and template details.

## Module Authoring at a Glance

- **Template-first workflow**: Copy `foundation/templates/module-template/` into `modules/<your-module>/`. That template already points at the foundation schema (`../../foundation/schemas/module.schema.json`), base Compose (`../../foundation/docker-compose.base.yml`), and empty hook scripts. Do not start from `hello-module`; it is reference-only.
- **Runtime behavior**: `launch_core.sh module enable` resolves dependencies via `foundation/lib/dependency-resolve.sh` and then runs `docker compose -f modules/<module>/docker-compose.yml up -d` for each module. Hook scripts are not invoked by the launcher, so implement or invoke them manually as needed.
- **Hook lifecycle**: Follow the lifecycle definitions in the canonical guide and `foundation/docs/LIFECYCLE-HOOKS.md`. The scripts (`install`, `start`, `stop`, `health`, `upgrade`, `validate`, `uninstall`) should stay within `hooks/`, be idempotent, and report structured status.
- **Validation scope**: `module.json` is validated against `foundation/schemas/module.schema.json`, and dependency resolution enforces declared requirements and versions. Compose files, hook content, and dashboard assets remain the author’s responsibility; exercise them locally (e.g., `docker compose config`, `hooks/health.sh`) before enabling the module.

## Foundation Reference Links

- Manifest schema: [`schemas/module.schema.json`](schemas/module.schema.json)
- Lifecycle schema: [`schemas/lifecycle.schema.json`](schemas/lifecycle.schema.json)
- Event bus interface: [`schemas/event.schema.json`](schemas/event.schema.json)
- Connection schema: [`schemas/connection.schema.json`](schemas/connection.schema.json)
- Dashboard schema: [`schemas/dashboard.schema.json`](schemas/dashboard.schema.json)
- Version compatibility: [`docs/VERSION-COMPATIBILITY.md`](docs/VERSION-COMPATIBILITY.md)
- Compose patterns: [`docs/COMPOSE-PATTERNS.md`](docs/COMPOSE-PATTERNS.md)
- Migration guide: [`docs/MIGRATION-GUIDE.md`](docs/MIGRATION-GUIDE.md)
- Lifecycle hooks details: [`docs/LIFECYCLE-HOOKS.md`](docs/LIFECYCLE-HOOKS.md)

## Foundation Structure

```
foundation/
├── README.md
├── VERSION
├── docker-compose.base.yml
├── bin/
│   ├── foundation
│   └── migrate
├── schemas/
│   ├── module.schema.json
│   ├── lifecycle.schema.json
│   ├── event.schema.json
│   ├── connection.schema.json
│   ├── dashboard.schema.json
│   ├── config.schema.json
│   ├── version.schema.json
│   ├── security.schema.json
│   ├── security-event.schema.json
│   └── contract-manifest.schema.json
├── lib/
│   ├── version-check.sh
│   ├── connection-resolve.sh
│   ├── dashboard-register.sh
│   ├── env-generate.sh
│   └── eventbus-noop.sh
├── interfaces/
│   ├── eventbus.ts
│   ├── eventbus.py
│   ├── connection.ts
│   ├── connection.py
│   ├── dashboard.ts
│   ├── dashboard.py
│   ├── contract.ts
│   ├── contract.py
│   ├── identity.ts
│   ├── identity.py
│   ├── encryption.ts
│   └── encryption.py
├── docs/
│   ├── decisions/
│   │   └── README.md
│   ├── MODULE-MANIFEST.md
│   ├── LIFECYCLE-HOOKS.md
│   ├── COMPOSE-PATTERNS.md
│   ├── EVENT-BUS-INTERFACE.md
│   ├── CONNECTION-ABSTRACTION.md
│   ├── DASHBOARD-REGISTRATION.md
│   ├── CONFIGURATION-SCHEMA.md
│   ├── MIGRATION-GUIDE.md
│   └── VERSION-COMPATIBILITY.md
└── templates/
    └── module-template/
        ├── module.json
        ├── docker-compose.yml
        └── README.md
```

## Design Principles

1. **Zero Runtime Dependencies** – The foundation validates contracts without assuming implementations.
2. **Interfaces Not Implementations** – Extension points ship as schemas and scripts; implementations live in modules.
3. **BYOK (Bring Your Own Keys)** – Secrets are mounted via `secrets-required.txt` and `/run/secrets/`.
4. **Swappable Connections** – Declare `requires.connections` and let the dependency resolver match providers.
5. **Optional Dashboard** – UI wiring is declarative; a missing dashboard runtime is acceptable.
6. **Semantic Versioning** – Modules declare `foundation.minVersion`/`maxVersion` and rely on validation scripts.

## Related Documentation

- [`../docs/module-authoring-guide.md`](../docs/module-authoring-guide.md) – Local landing notice pointing to the authoritative guide.
- [`../../../docs/module-authoring-guide.md`](../../../docs/module-authoring-guide.md) – Source-of-truth module authoring guide in the parent repo.
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) – System overview.
- [`docs/decisions/INDEX.md`](../docs/decisions/INDEX.md) – ADR archive.

## License

See repository root `LICENSE` file.

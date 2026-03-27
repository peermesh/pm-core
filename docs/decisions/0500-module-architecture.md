# ADR-0500: Module Architecture -- Layer Definitions and Naming

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-26 |
| **Status** | ACCEPTED (2026-02-26) |
| **Superseded By** | - |
| **Supersedes** | - |
| **Authors** | AI-assisted |
| **Reviewers** | Project Owner |

---

## Context

The PeerMesh ecosystem uses the term "module" at two different levels:

1. **Docker Lab itself** is a "module" within the parent peermesh-docker-lab ecosystem
2. **Extensions inside Docker Lab** (backup, mastodon, pki, etc.) are also called "modules"

This creates confusion about:
- What a "PeerMesh Module" template should be
- Whether the foundation layer and extension layer share the same architecture
- How to name and document these different concepts clearly
- What the relationship is between the foundation services (socket-proxy, traefik, dashboard) and modules

The foundation layer includes core services that are required for the system to function:
- `foundation/services/socket-proxy/` - Docker socket access control
- `foundation/services/traefik/` - Reverse proxy and TLS termination
- `foundation/services/dashboard/` - Web UI for management

The module layer includes optional extensions that provide additional functionality:
- `modules/backup/` - Backup and restore capabilities
- `modules/pki/` - Internal certificate authority
- `modules/mastodon/` - Federation protocol support
- `modules/federation-adapter/` - Protocol translation layer

Questions to resolve:
- Are foundation services a type of module, or a separate architectural layer?
- Should there be different templates for foundation services vs modules?
- What terminology should we use to distinguish these layers?
- Should the module.json schema be shared between foundation services and modules?
- What does "PeerMesh Module" mean in the context of the parent ecosystem?

---

## Analysis

Analysis completed 2026-02-25. Full findings documented in the architecture analysis report and codified in [MODULE-ARCHITECTURE.md](../MODULE-ARCHITECTURE.md).

### Finding 1: Two Completely Different Concepts Share the Name "Module"

The parent project (peermesh-docker-lab) uses "module" to mean **application services** -- full-stack components like backend APIs, frontend UIs, AI services, and publishing pipelines. These live at `peermesh-docker-lab/modules/standalone/` and are governed by compliance specifications ("Standalone Module Requirements" and "PeerMesh Module Requirements").

The Docker Lab uses "module" to mean **infrastructure extensions** -- operational capabilities like backup, PKI, and federation that plug into the foundation via `module.json` manifests, lifecycle hooks, and CLI management.

These share nothing but the name. A parent-project "module" is an application with business logic and database migrations. A Docker Lab "module" is an infrastructure extension with lifecycle hooks and compose patterns. The confusion is not theoretical -- it directly affects what a "PeerMesh Module template" should contain, whether the foundation should be modularized, and how documentation should be structured.

### Finding 2: The Foundation Is the Platform, Not a Participant

The foundation (`foundation/`) is the contract layer that defines what a module IS. It contains the JSON schemas, interface definitions, shell libraries, and base compose patterns that modules implement and consume. The foundation does not have a `module.json`, does not go through lifecycle hooks, and does not register with a dashboard. It IS the dashboard. It IS what lifecycle hooks are called by.

This is the kernel-vs-application distinction. Making the foundation a module would collapse the abstraction boundary between the contract definer and the contract implementor.

The codebase already implements this correctly. The `foundation/` directory contains schemas and interfaces; the `modules/` directory contains implementations. No change is needed here -- only documentation clarity.

### Finding 3: Four-Tier Architecture Is Well-Defined

The Docker Lab has a clear, well-implemented four-tier architecture:

| Tier | Directory | Purpose | Has module.json | Managed by CLI |
|------|-----------|---------|----------------|----------------|
| 1. Foundation | `foundation/` | The platform itself | No | No |
| 2. Profiles | `profiles/` | Infrastructure services (databases, caches) | No | No |
| 3. Examples | `examples/` | Application deployments | No | No |
| 4. Modules | `modules/` | Infrastructure extensions with lifecycle management | Yes | Yes |

Each tier has a distinct integration method: the foundation is always-on, profiles use compose file stacking, examples use compose profiles, and modules use the CLI with manifest-driven dependency resolution.

### Finding 4: Module System Is ~60% Implemented

The manifest specification, JSON schemas, compose patterns, and basic CLI operations are solid. Five modules have valid manifests. Dependency resolution with topological sort works. Dashboard registration works.

The biggest gap is lifecycle hook orchestration. The `module enable` command runs `docker compose up -d` but does not invoke install, validate, or health hooks. The hooks exist as scripts inside each module, but the CLI does not call them. This means the module system functions as a compose management layer today, with lifecycle automation defined but not connected.

Other gaps: no `module validate` command, no `module create` scaffolding command, no event bus implementation, and no integration test suite for the module lifecycle.

### Finding 5: The Template Should Be a Docker Lab Module (Type 2)

The "PeerMesh Module template" that the project needs is a Type 2 module -- a Docker Lab infrastructure extension. The Docker Lab module system has a formal, implemented architecture with schemas, CLI integration, and clear patterns from existing modules. It can be meaningfully templated.

A Type 1 template (parent-project application service) is premature. The parent project's compliance spec system is not mature enough, and the four existing services are too different from each other to extract a common template.

### Finding 6: Naming Must Be Disambiguated

The recommended resolution is to keep "module" for the Docker Lab extension system (which earned the name through implementation) and rename the parent project's components to "services" or "components." This is less disruptive because:

1. The Docker Lab has `module.json`, `module.schema.json`, `module enable/disable`, and extensive documentation using "module"
2. The parent project's system is primarily specification documents, not runtime code
3. "Module" is the correct term for a formal plugin with lifecycle management

Alternative terms considered for Docker Lab modules -- "plugins," "extensions," "add-ons" -- were rejected because "plugins" implies runtime code injection (which these are not), and "extensions"/"add-ons" are vaguer than the existing, well-established terminology.

---

## Decision

**Options B + D accepted by project owner on 2026-02-26.**

Parent-level components are renamed from "modules" to "services." Docker Lab retains "module" for its formal extension system.

Specific decisions:

- **Layer terminology:** The four-tier architecture (Foundation, Profiles, Examples, Modules) is confirmed. The foundation is the platform, not a participant. Modules are the formal extension layer.
- **Naming conventions:** "Module" now exclusively means a Docker Lab infrastructure extension (Tier 4). Parent-level components (Docker Lab, Social Lab, backend, frontend, etc.) are "services." Historical documents before 2026-02-26 retain old terminology.
- **Template scope:** The "PeerMesh Module template" (WO-104 hello-module) will be a Docker Lab inner module (Type 2). No parent-project service template at this time.
- **Architectural patterns:** Module schemas remain in `foundation/schemas/`. No changes to the schema layer.
- **Filesystem paths:** The parent project directory `.dev/modules/` is NOT renamed on disk at this time. That is a separate operational decision.

---

## Alternatives Considered

### Option A: Foundation Services Are a Special Type of Module

Under this approach, the foundation services (traefik, socket-proxy, dashboard) would each have a `module.json` and participate in the module lifecycle. The foundation would be "Tier 0 modules" or "core modules" with a higher privilege level.

**Rejected because:** This collapses the abstraction boundary between the contract definer and the contract implementor. The foundation contains the schemas that define what a module IS. Making the foundation a module creates a circular dependency: the module schema would need to validate itself. It also conflates "always required" services with "optional extensions," which are fundamentally different operational categories. The codebase already correctly separates these concerns.

### Option B: Foundation and Modules Are Separate Architectural Layers (Recommended)

The foundation is the platform. Modules are extensions that plug into it. They have different lifecycles, different management patterns, and different quality bars. The `module.json` manifest is the contract between the two layers.

**This is the recommended approach** because it matches what is already implemented, preserves clean separation of concerns, and makes the architecture legible to new contributors. The four-tier model (Foundation, Profiles, Examples, Modules) is already well-documented in ARCHITECTURE.md and works correctly.

### Option C: Rename Docker Lab Modules to "Extensions" or "Plugins"

Under this approach, the Docker Lab would use different terminology to avoid collision with the parent project.

**Rejected because:** The Docker Lab module system is the one with the formal implementation -- `module.json`, `module.schema.json`, `module enable/disable`, five existing modules with manifests. Renaming the established, implemented system is more disruptive than renaming the less-implemented parent spec. Additionally, "plugins" implies runtime code injection (not what these are), and "extensions" is vaguer than "modules."

### Option D: Rename Parent Project Components to "Services"

Under this approach, the parent project's application components would be called "services" instead of "modules," and the Docker Lab would keep "module."

**This is the recommended naming resolution** because it is less disruptive (the parent system is primarily documentation, not runtime code), more accurate (the parent components ARE application services), and preserves the well-established Docker Lab terminology.

---

## Consequences

### With Option B + D Accepted

**Module template design:**
- The "PeerMesh Module template" (WO-104 hello-module) will be a Docker Lab inner module (Type 2)
- It will demonstrate `module.json`, lifecycle hooks, dashboard registration, and compose patterns
- No template will be created for parent-project services at this time

**Documentation structure:**
- [MODULE-ARCHITECTURE.md](../MODULE-ARCHITECTURE.md) has been created as the central architecture document
- Documentation consistently uses "module" for Docker Lab extensions and "service" for parent-project application components
- Cross-references link the new architecture doc to ARCHITECTURE.md, the Module Rubric, and the CLI reference

**Developer onboarding:**
- New contributors will be directed to MODULE-ARCHITECTURE.md first for the conceptual map
- The naming disambiguation section prevents the most common source of confusion
- The implementation status section sets honest expectations about what works today

**Hello Module (WO-104):**
- Scoped as a Docker Lab inner module with all module system features demonstrated
- Uses Nginx as a minimal, working service
- Includes annotated manifest, lifecycle hooks, dashboard widget, smoke test
- Provides `# CUSTOMIZE:` markers for clone-and-customize workflow

**Future module development:**
- Module Rubric provides the quality checklist
- Foundation template and hello-module provide starting points at different detail levels
- CLI gaps (lifecycle hook orchestration, validation, scaffolding) are documented as known gaps with clear descriptions of what needs to be built

---

## Implementation Notes

Once the decision is made, the following will need to be updated:
- Module template at `foundation/templates/module-template/`
- Module rubric at `docs/MODULE-RUBRIC.md`
- Documentation references to "modules" throughout the codebase
- WO-104 (Hello Module) scope and design

---

## References

### Documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Current system architecture overview
- [Module Template](../../foundation/templates/module-template/) - Existing template structure

### Analysis Documents

- `.dev/ai/subtask-comms/module-architecture-analysis.md` - Research findings (completed 2026-02-25)
- `.dev/ai/subtask-comms/example-module-template-research.md` - Module template research (completed 2026-02-25)

### Architecture Documentation

- [MODULE-ARCHITECTURE.md](../MODULE-ARCHITECTURE.md) - Comprehensive module architecture document
- [MODULE-RUBRIC.md](../MODULE-RUBRIC.md) - Module quality and compatibility checklist

### Work Orders

- WO-104: Hello Module - Depends on this decision

### Existing Modules

- [Backup Module](../../modules/backup/) - Example of well-formed module
- [PKI Module](../../modules/pki/) - Example of well-formed module
- [Test Module](../../modules/test-module/) - Validation test module

### Related ADRs

- [ADR-0400: Docker Compose Profile System](./0400-profile-system.md) - Profiles vs modules
- [ADR-0401: Example Application Pattern](./0401-example-application-pattern.md) - Application structure

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-26 | Initial draft - scaffolding for analysis | AI-assisted |
| 2026-02-26 | Analysis section filled from completed research; alternatives and consequences drafted | AI-assisted |
| 2026-02-26 | Decision ACCEPTED: Options B + D. Parent "modules" renamed to "services"; Docker Lab retains "module" | Owner decision |

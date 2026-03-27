# ADR-0203: Security Framework Core Interfaces

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-23 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

The Core module system needs security capabilities -- identity verification, encryption, and capability-based access control -- but the foundation cannot mandate specific security providers. Modules run on commodity VPS hardware where heavyweight solutions like HashiCorp Vault or full SPIFFE/SPIRE deployments are impractical. At the same time, modules need a consistent way to declare and consume security services regardless of which provider (if any) is installed.

The existing foundation already uses an "interfaces over implementations" pattern successfully:

- `eventbus.py` defines communication contracts; `eventbus-redis` and `eventbus-nats` provide implementations
- `connection.py` defines data contracts; `provider-postgres` and `provider-redis` provide implementations

Security needs the same decoupling. Modules should declare **what** they need (identity, encryption, contracts) without being locked to **how** those needs are met.

Work orders WO-082 through WO-086 drove the design and implementation of this framework during Phase 1A.

---

## Decision

**We will adopt interface-based security contracts (identity, encryption, contract) in the foundation, allowing modules to declare security needs without mandating specific providers.**

The foundation defines three core security interfaces:

- **Identity** (`identity.py`, `identity.ts`): Credential issuance, verification, revocation, and rotation
- **Encryption** (`encryption.py`, `encryption.ts`): Key management, encrypt/decrypt operations, and storage encryption
- **Contract** (`contract.py`, `contract.ts`): Capability-based security with policy evaluation and enforcement

Modules declare their security requirements in the `security` section of `module.json`. The foundation orchestrates provisioning through whatever security modules are installed. If no providers exist, no-op fallbacks are used (see ADR-0204).

---

## Alternatives Considered

### Option A: Mandate Vault/OpenBao

**Description**: Require HashiCorp Vault or OpenBao as the single security provider for all modules.

**Pros**:
- Battle-tested, comprehensive security solution
- Single integration point for all security needs
- Rich ecosystem of plugins and backends

**Cons**:
- Heavy resource footprint (~200 MiB+ RAM) on commodity VPS
- Operational complexity (unsealing, HA, backup of secrets)
- Locks every module to one vendor's API

**Why not chosen**: Too heavy for the target deployment environment (single-node commodity VPS). Forces all modules into one provider's abstraction regardless of their actual needs.

### Option B: No Security Framework

**Description**: Let each module handle its own security independently without any foundation-level coordination.

**Pros**:
- Zero foundation complexity
- Modules have full autonomy over security choices

**Cons**:
- No way for modules to communicate security needs to the platform
- No consistent security posture across modules
- Each module reinvents credential management, key handling, and access control
- No foundation-level audit or enforcement possible

**Why not chosen**: Modules need to declare security requirements so the foundation can orchestrate provisioning, enforce policies, and provide consistent audit trails.

### Option C: Library-Based Approach

**Description**: Ship security as importable libraries (npm packages, Python packages) that modules link against.

**Pros**:
- Familiar developer experience
- Strong typing and compile-time checks within a language

**Cons**:
- Doesn't work across language boundaries (Python modules can't use TypeScript libraries)
- Tight coupling between library version and module version
- No runtime provider swapping without recompilation/reinstallation

**Why not chosen**: Core modules are containerized and polyglot. Security contracts must work across container boundaries and language runtimes, which requires protocol-level interfaces, not library imports.

---

## Consequences

### Positive

- Modules declare security needs declaratively in `module.json`
- Security providers can be swapped without any module changes
- Foundation can validate security declarations at module install time
- Consistent security patterns across all modules regardless of language
- Mirrors proven `eventbus`/`connection` interface pattern

### Negative

- Interface definitions add complexity to the foundation
- No-op fallbacks mean security is not enforced until real providers are installed
- Two implementations required per interface (no-op + at least one real provider)

### Neutral

- Four new lifecycle hooks added: `security-provision`, `security-deprovision`, `security-rotate`, `security-lock`
- Module manifest schema extended with `security` section
- Real provider implementations deferred to Phase 2

---

## Implementation Notes

- Interface files live at `foundation/interfaces/{identity,encryption,contract}.{py,ts}`
- Module manifest schema extended at `foundation/schemas/security.schema.json`
- Security lifecycle hooks defined in updated `lifecycle.schema.json`
- Modules can declare `provides.securityServices` to register as a security provider
- Modules can declare `requires.securityServices` to depend on a security provider

---

## References

### Documentation

- [SECURITY-FRAMEWORK.md](../../foundation/docs/SECURITY-FRAMEWORK.md) - Comprehensive framework documentation
- [IDENTITY-INTERFACE.md](../../foundation/docs/IDENTITY-INTERFACE.md) - Identity credential lifecycle
- [ENCRYPTION-INTERFACE.md](../../foundation/docs/ENCRYPTION-INTERFACE.md) - Key management and storage encryption
- [CONTRACT-SYSTEM.md](../../foundation/docs/CONTRACT-SYSTEM.md) - Capability-based security model

### Related ADRs

- [ADR-0200: Non-Root Containers](./0200-non-root-containers.md) - Security baseline for container execution
- [ADR-0201: Security Anchors](./0201-security-anchors.md) - YAML anchor pattern for security settings
- [ADR-0204: No-Op Security Fallback](./0204-noop-security-fallback.md) - Graceful degradation strategy

### Work Orders

- WO-082 through WO-086: Phase 1A Security Framework design and implementation

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-23 | Initial draft | AI-assisted |
| 2026-02-23 | Status changed to accepted | AI-assisted |

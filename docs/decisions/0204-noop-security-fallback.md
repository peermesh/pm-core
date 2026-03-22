# ADR-0204: No-Op Security Fallback Strategy

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-02-23 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Phase 1A of the Security Framework (ADR-0203) establishes interface contracts for identity, encryption, and contract evaluation. However, real security provider implementations (SPIFFE, OpenBao, OPA) are deferred to Phase 2. Modules need to work **now** -- both during development and in deployments where no security providers are installed.

This creates a gap: modules declare security needs in `module.json`, but the foundation has nothing to fulfill those declarations with until real providers ship. Without a fallback strategy, modules would either fail to start or require complex conditional logic to handle the "no provider" case.

The framework needs a strategy that:

- Allows module development to proceed immediately
- Makes the absence of security providers visible (not silent)
- Provides a clear upgrade path to real enforcement
- Does not create false confidence about security posture

---

## Decision

**All security interfaces will ship with no-op implementations as defaults. Modules work without security providers but log warnings on every no-op operation.**

The no-op fallback implementations:

- **NoopIdentityProvider**: Issues bearer-token credentials without cryptographic backing. Verification always returns `valid: true`. All credentials accepted.
- **NoopKeyManagementProvider**: Returns plaintext for encryption/decryption operations. Key handles are dummy references. No actual cryptographic operations performed.
- **NoopContractEvaluator**: Approves all contract requests. Grants all requested capabilities unconditionally.
- **NoopStorageEncryptionProvider**: Directories are mounted without encryption. Lock/unlock operations are no-ops.

Every no-op operation logs a warning including the module name and the operation that was not secured, ensuring operators are aware of the degraded security posture.

Modules that require real security can set `enforcementMode: "fail-closed"` in their manifest to refuse startup without a real provider.

---

## Alternatives Considered

### Option A: Fail-Closed from Day One

**Description**: Require real security providers before any module can use security features. Modules declaring security needs refuse to start without providers.

**Pros**:
- No false sense of security
- Forces provider implementation before module deployment
- Clear security posture at all times

**Cons**:
- Blocks all module development until Phase 2 providers ship
- Creates circular dependency: can't test modules without providers, can't test providers without modules
- Prevents incremental adoption of security features

**Why not chosen**: Blocks module development for months while waiting for provider implementations. The framework exists to enable gradual security adoption, not gate all progress.

### Option B: No Fallback at All

**Description**: If no provider is registered, security interface calls throw errors. Modules must handle the absence of providers themselves.

**Pros**:
- Simple foundation implementation
- Forces modules to be explicit about security handling

**Cons**:
- Every module must implement its own "no provider" error handling
- Inconsistent behavior across modules
- Modules that forget error handling crash unpredictably

**Why not chosen**: Pushes complexity to every module author. The foundation should handle graceful degradation consistently rather than making it each module's problem.

### Option C: Mock Implementations with Fake Data

**Description**: Provide mock providers that simulate real security operations -- generating fake certificates, performing real but meaningless encryption with hardcoded keys, etc.

**Pros**:
- More realistic testing surface
- Exercises more of the code path

**Cons**:
- Creates false confidence that security is working
- Fake certificates and hardcoded keys could leak into production
- Harder to distinguish "mock secure" from "actually secure" in logs
- More code to maintain for something that will be replaced

**Why not chosen**: Misleading. Operators and developers might believe security is functioning when it is not. No-op with explicit warnings is honest about the security posture.

---

## Consequences

### Positive

- Module development proceeds immediately without waiting for provider implementations
- Operators see clear warnings about degraded security posture
- Code paths for security integration are exercised from day one
- Gradual migration: install a real provider, warnings disappear, no module changes needed
- `enforcementMode: "fail-closed"` provides an opt-in escape hatch for security-critical modules

### Negative

- Modules run without actual security in Phase 1A deployments
- Risk that operators ignore warnings and run no-op security in production
- Two enforcement modes (`warn` and `fail-closed`) add complexity to the lifecycle

### Neutral

- Phase 1B must implement enforcement mode switching so `warn` mode can be deprecated platform-wide once providers are available
- No-op implementations serve as reference for the provider interface contract

---

## Implementation Notes

- No-op providers are defined alongside their interface files in `foundation/interfaces/`
- Warning format: `[SECURITY-NOOP] Module "<module-id>" called <operation> — no <provider-type> provider registered`
- Default `enforcementMode` is `"warn"` (no-op allowed with warnings)
- Setting `enforcementMode: "fail-closed"` causes the foundation to check for real providers at module startup and abort if none are found

---

## References

### Documentation

- [SECURITY-FRAMEWORK.md](../../foundation/docs/SECURITY-FRAMEWORK.md) - Graceful Degradation section
- [SECURITY-LIFECYCLE-HOOKS.md](../../foundation/docs/SECURITY-LIFECYCLE-HOOKS.md) - Hook invocation with no-op providers

### Related ADRs

- [ADR-0203: Security Framework Core Interfaces](./0203-security-framework-core-interfaces.md) - The interface contracts these fallbacks implement

### Implementation References

- `encryption.ts` — `NoopKeyManagementProvider` class
- `identity.ts` — `NoopIdentityProvider` class

### Work Orders

- WO-083: No-op fallback design and implementation

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-02-23 | Initial draft | AI-assisted |
| 2026-02-23 | Status changed to accepted | AI-assisted |

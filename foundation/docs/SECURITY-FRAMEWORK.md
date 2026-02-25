# Security Framework

**Version**: 1.0.0
**Status**: Phase 1A - Core Interfaces
**Last Updated**: 2026-02-22

## Overview

The PeerMesh Security Framework provides a comprehensive, pluggable security layer for Docker Lab modules. Following the same "interfaces over implementations" pattern used for event bus, connections, and dashboard, the security framework defines **contracts** in the foundation while **implementations** live as modules.

This framework enables:

- **Identity**: Verifiable module identities for zero-trust communication
- **Encryption**: Key management and encrypted storage for data at rest
- **Contracts**: Capability-based security with policy evaluation and enforcement
- **Attestation**: Platform trust verification (Phase 1B)
- **Sessions**: Authentication session lifecycle management (Phase 1B)
- **Hardware**: Abstraction over TPM, secure enclaves, and HSMs (Phase 1B)

## Architecture Principles

### 1. Interfaces Over Implementations

The foundation defines **what** security services modules can request, not **how** those services are provided. For example:

- `foundation/interfaces/identity.py` defines the `IdentityProvider` protocol
- `identity-spiffe` module implements that protocol using SPIFFE/SPIRE
- `identity-jwt` module could provide a simpler JWT-based implementation

This mirrors the existing pattern:

| Domain | Foundation Interface | Example Implementations |
|--------|---------------------|------------------------|
| Communication | `eventbus.py` | `eventbus-redis`, `eventbus-nats` |
| Data | `connection.py` | `provider-postgres`, `provider-redis` |
| **Identity** | **`identity.py`** | **`identity-spiffe`, `identity-jwt`** |
| **Encryption** | **`encryption.py`** | **`encryption-openbao`, `encryption-fscrypt`** |
| **Contracts** | **`contract.py`** | **`contract-opa`, `contract-enforcer-nftables`** |

### 2. Declare Intent, Not Mechanism

Modules declare **what they need**, not **how to provide it**:

```json
{
  "security": {
    "identity": {
      "required": true,
      "credentialType": "any"
    },
    "encryption": {
      "dataAtRest": "required",
      "keyPurposes": ["encryption"]
    },
    "contract": {
      "network": {
        "access": "specific",
        "allowedEndpoints": ["api.example.com:443"]
      }
    }
  }
}
```

The foundation orchestrates provisioning through whatever security modules are installed. If no security providers are available, the system uses no-op fallbacks (see Graceful Degradation).

### 3. Optional by Default

**All security features are optional with sensible defaults.** Modules work unchanged without any security providers installed. The `security` section in `module.json` is entirely optional.

Default behavior:
- No identity provider → modules run without credentials (logged as warning)
- No encryption provider → data stored unencrypted (logged as warning)
- No contract evaluator → modules get unrestricted access (logged as warning)

This ensures backward compatibility and allows gradual security adoption.

### 4. Fail-Closed When Requested

Modules that **require** security can set `enforcementMode: "fail-closed"`:

```json
{
  "security": {
    "enforcementMode": "fail-closed",
    "identity": {
      "required": true
    }
  }
}
```

With `fail-closed`, the module **refuses to start** if the required security provider is unavailable. This prevents accidental insecure operation for security-critical modules.

## Security Interfaces (Phase 1A)

### Identity Interface

**File**: `foundation/interfaces/identity.py`, `identity.ts`

Defines how modules receive and verify identity credentials.

**Key types**:
- `IdentityProvider` - Issues, verifies, revokes, and rotates credentials
- `ModuleCredential` - Contains module identity and trust domain
- `VerificationResult` - Outcome of credential verification

**Standard events**:
- `foundation.identity.credential-issued`
- `foundation.identity.credential-revoked`
- `foundation.identity.credential-rotated`
- `foundation.identity.provider-available`

**See**: [IDENTITY-INTERFACE.md](./IDENTITY-INTERFACE.md)

### Encryption Interface

**File**: `foundation/interfaces/encryption.py`, `encryption.ts`

Defines key management and encrypted storage contracts.

**Key types**:
- `KeyManagementProvider` - Provision, rotate, encrypt/decrypt with keys
- `StorageEncryptionProvider` - Encrypted directories (lock/unlock)
- `KeyHandle` - Reference to a cryptographic key
- `EncryptedVolume` - Reference to an encrypted directory

**Standard events**:
- `foundation.encryption.key-provisioned`
- `foundation.encryption.key-rotated`
- `foundation.encryption.volume-locked`
- `foundation.encryption.volume-unlocked`

**See**: [ENCRYPTION-INTERFACE.md](./ENCRYPTION-INTERFACE.md)

### Contract Interface

**File**: `foundation/interfaces/contract.py`, `contract.ts`

Defines capability-based security: modules declare needs, policy evaluates them, enforcers implement decisions.

**Key types**:
- `ContractEvaluator` - Evaluates contract requests against policy
- `ContractEnforcer` - Enforces approved capabilities at network/filesystem level
- `ContractManifest` - Module's capability declaration
- `ContractDecision` - Approval/denial with granted capabilities

**Standard events**:
- `foundation.contract.evaluated`
- `foundation.contract.approved`
- `foundation.contract.violation-detected`
- `foundation.contract.enforcement-updated`

**See**: [CONTRACT-SYSTEM.md](./CONTRACT-SYSTEM.md)

## Module Manifest Integration

Modules declare security requirements in the `security` section of `module.json`:

```json
{
  "id": "my-secure-module",
  "version": "1.0.0",
  "security": {
    "enforcementMode": "warn",
    "identity": {
      "required": true,
      "credentialType": "x509-svid"
    },
    "encryption": {
      "dataAtRest": "required",
      "transitEncryption": "mtls",
      "keyPurposes": ["encryption", "signing"]
    },
    "contract": {
      "network": {
        "access": "specific",
        "allowedEndpoints": ["backup.example.com:443"]
      },
      "filesystemAccess": {
        "accessLevel": "own-directory-only"
      }
    }
  }
}
```

**Schema**: `foundation/schemas/security.schema.json`

## Security Lifecycle Hooks

The foundation adds four new lifecycle hooks for security integration:

### 1. `security-provision`

**When**: After identity credential issuance and encryption key provisioning
**Purpose**: Module-specific security setup
**Example**: Store credential in module config, initialize encrypted database

### 2. `security-deprovision`

**When**: Before identity revocation and key eviction
**Purpose**: Security-related cleanup
**Example**: Clear cached credentials, flush encrypted buffers

### 3. `security-rotate`

**When**: Credentials or keys are rotated
**Purpose**: Update to new credentials/keys
**Example**: Reload TLS certificates, re-establish connections with new identity

### 4. `security-lock`

**When**: Session locks (if `security.session.lockBehavior` is set)
**Purpose**: Respond to session lock event
**Example**: Lock encrypted volumes, evict keys from memory

**Schema**: Updated `lifecycle.schema.json`
**See**: [SECURITY-LIFECYCLE-HOOKS.md](./SECURITY-LIFECYCLE-HOOKS.md)

## Provides/Requires Security Services

Modules can declare that they **provide** security services or **require** them as dependencies.

### Provides

```json
{
  "provides": {
    "securityServices": [
      "identity-provider",
      "key-management"
    ]
  }
}
```

Valid service types:
- `identity-provider`
- `key-management`
- `storage-encryption`
- `contract-evaluation`
- `contract-enforcement`
- `attestation`
- `hardware-abstraction`
- `session-management`
- `authentication-ux`

### Requires

```json
{
  "requires": {
    "securityServices": [
      "identity-provider",
      "key-management"
    ]
  }
}
```

The foundation ensures required security services are available before starting the module.

## Graceful Degradation

When no security providers are installed, the foundation uses **no-op fallbacks**:

- **No-op Identity Provider**: Always returns `valid: true` for any credential
- **No-op Key Management**: Returns dummy key handles, no actual encryption
- **No-op Contract Evaluator**: Approves all contracts with all capabilities granted
- **No-op Storage Encryption**: Directories are not encrypted

This allows modules to run in low-security development environments while maintaining security-aware code paths.

**Warning**: No-op fallbacks log warnings at startup. Modules with `enforcementMode: "fail-closed"` refuse to start without real security providers.

## Phasing

### Phase 1A (Current) - Core Interfaces

**Status**: ✅ Complete

- Identity, Encryption, Contract interfaces defined
- Module manifest schema extended
- Security lifecycle hooks added
- No-op fallback implementations
- Documentation complete

**Out of Scope**: Attestation, Session, Hardware interfaces (Phase 1B)

### Phase 1B - Extended Interfaces

**Status**: Planned

- Attestation interface (platform trust verification)
- Session interface (authentication lifecycle)
- Hardware interface (TPM/secure enclave abstraction)

### Phase 2 - Reference Implementations

**Status**: Future

- `identity-spiffe` (SPIFFE/SPIRE)
- `encryption-openbao` (OpenBao KMS)
- `encryption-fscrypt` (fscrypt storage encryption)
- `contract-opa` (Open Policy Agent evaluator)
- `session-basic` (Basic session management)

### Phase 3 - Hardened Production

**Status**: Future

- `hardware-parsec` (Parsec with TPM backend)
- `attestation-veraison` (Hardware attestation)
- `contract-enforcer-nftables` (Network enforcement)
- `contract-enforcer-landlock` (Filesystem enforcement)

## Related Documentation

- [IDENTITY-INTERFACE.md](./IDENTITY-INTERFACE.md) - Identity credential lifecycle
- [ENCRYPTION-INTERFACE.md](./ENCRYPTION-INTERFACE.md) - Key management and storage encryption
- [CONTRACT-SYSTEM.md](./CONTRACT-SYSTEM.md) - Capability-based security model
- [SECURITY-LIFECYCLE-HOOKS.md](./SECURITY-LIFECYCLE-HOOKS.md) - Security hook invocation
- [MODULE-MANIFEST.md](./MODULE-MANIFEST.md) - Module manifest schema (includes security section)

## Design Decisions

- **ADR-001**: Security Framework Architecture - Interfaces in foundation, implementations as modules
- **ADR-002**: Graceful Degradation - Optional by default, fail-closed when requested
- **ADR-003**: Lifecycle Integration - Security hooks parallel to module lifecycle

(ADRs stored in `foundation/docs/decisions/`)

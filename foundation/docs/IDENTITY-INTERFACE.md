# Identity Interface

**Version**: 1.0.0
**Interface**: `foundation/interfaces/identity.py`, `identity.ts`
**Schema**: Part of `security.schema.json`
**Status**: Phase 1A - Core Interface Defined

## Purpose

The Identity Interface defines how modules receive and verify identity credentials for zero-trust inter-module communication. Every module can be issued a verifiable identity that other modules can authenticate.

## Core Concepts

### Module Identity

Each module instance receives a **credential** that proves its identity. The credential:

- Uniquely identifies the module (e.g., `backup-module`)
- Belongs to a **trust domain** (e.g., `peermesh.local`)
- Has an expiration time (requires rotation)
- Is cryptographically verifiable

### Trust Domains

A trust domain is a logical security boundary. All modules within the same trust domain trust each other's credentials. Cross-domain trust requires explicit configuration.

### Credential Types

- **x509-svid**: X.509 certificate (SPIFFE standard, most secure)
- **jwt-svid**: JWT token (SPIFFE standard, simpler)
- **bearer-token**: Simple bearer token (least secure, development only)

## Protocol Interface

### IdentityProvider

```python
class IdentityProvider(Protocol):
    async def issue_credential(
        module_id: str,
        attestation_context: Optional[Dict[str, Any]]
    ) -> ModuleCredential

    async def verify_credential(
        credential: ModuleCredential
    ) -> VerificationResult

    async def revoke_credential(
        credential_id: str
    ) -> None

    async def rotate_credentials(
        module_id: str
    ) -> ModuleCredential

    def get_trust_domain() -> str
    def is_available() -> bool
    async def close() -> None
```

### Key Data Types

**ModuleCredential**:
- `credential_id`: Unique credential identifier
- `module_id`: Module this credential belongs to
- `credential_type`: Type (x509-svid, jwt-svid, bearer-token)
- `issued_at`, `expires_at`: Validity period (Unix milliseconds)
- `trust_domain`: Trust domain membership
- `raw_credential`: Opaque credential bytes
- `metadata`: Provider-specific data

**VerificationResult**:
- `valid`: Whether credential passed verification
- `module_id`: Verified module identity
- `trust_domain`: Trust domain
- `expiry`: When credential expires
- `errors`: Verification error messages

## Module Manifest Declaration

Modules declare identity requirements in `security.identity`:

```json
{
  "security": {
    "identity": {
      "required": true,
      "credentialType": "x509-svid",
      "trustDomain": "peermesh.local"
    }
  }
}
```

**Fields**:
- `required` (default: `true`): Whether module needs identity
- `credentialType` (default: `"any"`): Preferred credential type
- `trustDomain` (optional): Specific trust domain to join

## Lifecycle Integration

### Provisioning Flow

1. Module declares `security.identity.required: true`
2. Foundation checks if an `IdentityProvider` is available
3. If available: `identity_provider.issue_credential(module_id, attestation_context)`
4. Credential stored in module environment/config
5. `security-provision` lifecycle hook called
6. Module starts with valid identity

### Rotation Flow

1. Identity provider detects credential approaching expiry
2. `identity_provider.rotate_credentials(module_id)` called
3. New credential issued
4. `security-rotate` lifecycle hook called
5. Module updates to new credential
6. Old credential grace period expires

### Deprovisioning Flow

1. Module stop requested
2. `security-deprovision` lifecycle hook called
3. `identity_provider.revoke_credential(credential_id)` called
4. Credential becomes invalid
5. Module stopped

## Standard Events

Published by identity providers (or the foundation when provider state changes):

- `foundation.identity.credential-issued`
  - Payload: `{ moduleId, credentialId, credentialType, expiresAt, trustDomain }`
- `foundation.identity.credential-revoked`
  - Payload: `{ credentialId, moduleId, reason? }`
- `foundation.identity.credential-rotated`
  - Payload: `{ moduleId, oldCredentialId, newCredentialId, newExpiresAt }`
- `foundation.identity.credential-verification-failed`
  - Payload: `{ credentialId, moduleId?, errors, sourceModule? }`
- `foundation.identity.provider-available`
  - Payload: `{ providerName, trustDomain, message? }`
- `foundation.identity.provider-unavailable`
  - Payload: `{ providerName, trustDomain, message? }`

## Implementation Examples

### SPIFFE/SPIRE Implementation

The `identity-spiffe` module implements `IdentityProvider` using SPIFFE/SPIRE:

- `issue_credential()` → SPIRE agent issues X.509-SVID
- `verify_credential()` → Validates SVID signature and trust bundle
- `rotate_credentials()` → Automatic rotation via SPIRE agent
- `trust_domain` → From SPIRE server configuration

### Simple JWT Implementation

The `identity-jwt` module provides a simpler JWT-based identity:

- `issue_credential()` → Signs JWT with shared secret
- `verify_credential()` → Validates JWT signature
- `rotate_credentials()` → Reissues JWT with new expiry
- `trust_domain` → Configured in module settings

### No-op Fallback

When no identity provider is installed, the foundation uses a no-op implementation:

- `issue_credential()` → Returns dummy credential
- `verify_credential()` → Always returns `valid: true`
- Logs warnings about missing identity provider

## Usage Patterns

### Inter-Module Communication

Module A wants to call Module B's API:

```python
# Module A
my_credential = get_my_credential()  # From environment
response = requests.post(
    "http://module-b/api",
    headers={"Authorization": f"Bearer {my_credential.raw_credential}"}
)

# Module B (receives request)
credential = parse_credential(request.headers["Authorization"])
result = await identity_provider.verify_credential(credential)
if result.valid:
    # Process request from result.module_id
else:
    # Reject request
```

### Credential Rotation Handler

```bash
#!/bin/bash
# security-rotate lifecycle hook

# Get new credential from environment
NEW_CREDENTIAL_PATH="${SECURITY_CREDENTIAL_PATH}"

# Reload application with new credential
kill -HUP $(cat /var/run/app.pid)
```

## Security Considerations

1. **Credential Storage**: Credentials should be stored in memory or secure storage (not on disk unencrypted)
2. **Rotation**: Implement rotation handlers to avoid credential expiry
3. **Verification**: Always verify credentials before trusting module identity
4. **Trust Domains**: Use separate trust domains for different security zones
5. **Fail-Closed**: Security-critical modules should set `enforcementMode: "fail-closed"`

## Related Documentation

- [SECURITY-FRAMEWORK.md](./SECURITY-FRAMEWORK.md) - Overall security architecture
- [ENCRYPTION-INTERFACE.md](./ENCRYPTION-INTERFACE.md) - Key management (uses identity for key ownership)
- [CONTRACT-SYSTEM.md](./CONTRACT-SYSTEM.md) - Contracts (uses identity for module verification)
- [SECURITY-LIFECYCLE-HOOKS.md](./SECURITY-LIFECYCLE-HOOKS.md) - Hook invocation details

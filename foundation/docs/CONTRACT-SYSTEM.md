# Contract System

**Version**: 1.0.0
**Interface**: `foundation/interfaces/contract.py`, `contract.ts`
**Schema**: `contract-manifest.schema.json`
**Status**: Phase 1A - Core Interface Defined

## Purpose

The Contract System implements **capability-based security**: modules declare what they need (network access, hardware, inter-module communication), policy evaluates those requests, and enforcers implement approved capabilities at the network/filesystem/process level.

This prevents modules from accessing resources they haven't explicitly requested and received approval for.

## Core Concepts

### Capability Declaration

Modules declare needed capabilities in `security.contract`:

```json
{
  "security": {
    "contract": {
      "network": {
        "access": "specific",
        "allowedEndpoints": ["api.example.com:443"]
      },
      "moduleCommunication": [
        {
          "targetModule": "database-module",
          "direction": "outbound",
          "dataTypes": ["sql-query"]
        }
      ],
      "filesystemAccess": {
        "accessLevel": "own-directory-only"
      }
    }
  }
}
```

This is **intent declaration**, not mechanism specification. The module says *what* it needs, not *how* to provide it.

### Policy Evaluation

A `ContractEvaluator` (e.g., `contract-opa` using Open Policy Agent) evaluates the contract against policy:

```rego
# Example OPA policy
allow {
    input.module_id == "backup-module"
    input.network.access == "specific"
    count(input.network.allowedEndpoints) <= 3
}
```

The evaluator returns a `ContractDecision`:
- `approved: true/false`
- `granted_capabilities`: List of approved capabilities
- `denied_capabilities`: List of denied capabilities
- `requires_user_approval`: Whether user must confirm

### Enforcement

A `ContractEnforcer` (e.g., `contract-enforcer-nftables`) implements the approved capabilities:

- **Network**: nftables rules, eBPF filters
- **Filesystem**: Landlock LSM policies, bind mounts
- **Process**: seccomp profiles, capability sets
- **Inter-module**: Service mesh policies, data validation gates

## Protocol Interfaces

### ContractEvaluator

```python
class ContractEvaluator(Protocol):
    async def evaluate(
        module_id: str,
        contract_manifest: ContractManifest
    ) -> ContractDecision

    async def get_active_contracts(module_id: str) -> List[ActiveContract]
    async def revoke_contract(contract_id: str) -> None
    async def update_policy(policy_bundle: Dict[str, Any]) -> None

    def get_policy_version() -> str
    def is_available() -> bool
    async def close() -> None
```

### ContractEnforcer

```python
class ContractEnforcer(Protocol):
    async def enforce(contract_decision: ContractDecision) -> EnforcementResult
    async def update_enforcement(contract_id: str, changes: Dict) -> EnforcementResult
    async def tear_down(contract_id: str) -> None
    async def get_enforcement_status(module_id: str) -> EnforcementStatus

    def is_available() -> bool
    async def close() -> None
```

### Key Data Types

**ContractManifest**:
- `module_id`: Module making the request
- `version`: Manifest version
- `network_access`: `NetworkPolicy`
- `module_communications`: List of `ModuleCommunicationPolicy`
- `hardware_access`: List of `HardwareAccessPolicy`
- `filesystem_access`: `FilesystemPolicy`
- `data_gates`: List of `DataGatePolicy`

**ContractDecision**:
- `approved`: Whether contract was approved
- `contract_id`: Unique contract identifier
- `granted_capabilities`: Approved capabilities
- `denied_capabilities`: Rejected capabilities
- `requires_user_approval`: User confirmation needed
- `reason`: Explanation for decision

**EnforcementResult**:
- `success`: Whether enforcement succeeded
- `enforcement_points`: Mechanisms activated (e.g., `["nftables-rule-123", "landlock-policy-456"]`)
- `errors`: Failure reasons

## Contract Manifest Schema

### Network Access

```json
{
  "network": {
    "access": "specific",
    "allowedEndpoints": [
      "api.example.com:443",
      "cdn.example.com:443"
    ]
  }
}
```

**Levels**:
- `none`: No network access (default)
- `specific`: Only listed endpoints
- `ports`: Only listed outbound ports
- `unrestricted`: Full network access

### Inter-Module Communication

```json
{
  "moduleCommunication": [
    {
      "targetModule": "postgres-provider",
      "direction": "outbound",
      "dataTypes": ["sql-query", "sql-result"],
      "rateLimit": {
        "maxPerSecond": 100
      }
    }
  ]
}
```

Declares which modules this module communicates with and what data types are exchanged.

### Hardware Access

```json
{
  "hardwareAccess": [
    {
      "deviceType": "tpm",
      "devicePath": "/dev/tpm0",
      "capabilities": ["seal", "unseal"]
    }
  ]
}
```

Requests access to specific hardware devices.

### Filesystem Access

```json
{
  "filesystemAccess": {
    "accessLevel": "own-directory-only",
    "additionalPaths": [],
    "readOnlyPaths": []
  }
}
```

**Levels**:
- `own-directory-only`: Only `/data/{module-id}` (default)
- `read-shared`: Can read shared directories
- `write-shared`: Can write to shared directories

### Data Gates

```json
{
  "dataGates": [
    {
      "gateId": "api-requests",
      "direction": "inbound",
      "dataTypeSchema": "https://example.com/schemas/api-request.json",
      "validationMode": "strict"
    }
  ]
}
```

Data gates validate data crossing module boundaries using JSON Schema or protobuf descriptors.

## Lifecycle Integration

### Provisioning Flow

1. Module starts, declares contract in manifest
2. Foundation reads `security.contract` section
3. Evaluator evaluates contract:
   ```python
   decision = await evaluator.evaluate(module_id, contract_manifest)
   ```
4. If `approved: false` → module fails to start
5. If `requires_user_approval: true` → prompt user
6. If `approved: true` → enforcer enforces:
   ```python
   result = await enforcer.enforce(decision)
   ```
7. Module starts with enforced capabilities

### Runtime Violation Detection

Enforcers monitor for contract violations:

```python
# Example: Module tries to connect to unapproved endpoint
if endpoint not in approved_endpoints:
    publish_event("foundation.contract.violation-detected", {
        "contractId": contract_id,
        "violationType": "unauthorized-network-access",
        "description": f"Attempted connection to {endpoint}"
    })
    # Block or log depending on enforcement mode
```

### Deprovisioning Flow

1. Module stop requested
2. Enforcer tears down enforcement:
   ```python
   await enforcer.tear_down(contract_id)
   ```
3. Contract revoked:
   ```python
   await evaluator.revoke_contract(contract_id)
   ```
4. Module stopped

## Standard Events

- `foundation.contract.evaluated`
  - Payload: `{ moduleId, contractId, approved, grantedCapabilities, deniedCapabilities }`
- `foundation.contract.approved`
  - Payload: `{ moduleId, contractId, grantedCapabilities }`
- `foundation.contract.denied`
  - Payload: `{ moduleId, reason, deniedCapabilities }`
- `foundation.contract.revoked`
  - Payload: `{ contractId, moduleId, reason? }`
- `foundation.contract.violation-detected`
  - Payload: `{ contractId, moduleId, violationType, description, timestamp }`
- `foundation.contract.enforcement-updated`
  - Payload: `{ contractId, moduleId, enforcementPoints }`
- `foundation.contract.enforcement-failed`
  - Payload: `{ contractId, moduleId, errors }`

## Implementation Examples

### OPA Policy Evaluator

The `contract-opa` module implements `ContractEvaluator` using Open Policy Agent:

- `evaluate()` → Sends contract to OPA, gets allow/deny decision
- `update_policy()` → Updates OPA policy bundle
- Policies written in Rego language
- Can query external data sources for context-aware decisions

### nftables Network Enforcer

The `contract-enforcer-nftables` module implements `ContractEnforcer` for network:

- `enforce()` → Creates nftables rules for allowed endpoints
- Default deny: Blocks all traffic not in contract
- Per-module chains for isolation
- Requires CAP_NET_ADMIN capability

### Landlock Filesystem Enforcer

The `contract-enforcer-landlock` module implements filesystem enforcement:

- `enforce()` → Sets Landlock LSM policies on module process
- Restricts filesystem access to declared paths
- Requires Linux kernel 5.13+ with Landlock enabled

### No-op Fallback

When no contract evaluator/enforcer is installed:

- Evaluator approves all contracts with all capabilities
- Enforcer does nothing (no actual enforcement)
- Logs warnings about missing contract system

## Usage Patterns

### Minimal Contract (Default)

```json
{
  "security": {
    "contract": {
      "network": {
        "access": "none"
      },
      "filesystemAccess": {
        "accessLevel": "own-directory-only"
      }
    }
  }
}
```

This is the default if no contract is specified: no network, own directory only.

### API Consumer Module

```json
{
  "security": {
    "contract": {
      "network": {
        "access": "specific",
        "allowedEndpoints": ["api.openweathermap.org:443"]
      },
      "moduleCommunication": [
        {
          "targetModule": "cache-module",
          "direction": "bidirectional",
          "dataTypes": ["weather-data"]
        }
      ]
    }
  }
}
```

### Database Provider Module

```json
{
  "security": {
    "contract": {
      "network": {
        "access": "ports",
        "allowedPorts": [5432]
      },
      "filesystemAccess": {
        "accessLevel": "read-shared",
        "additionalPaths": ["/data/backups"]
      },
      "dataGates": [
        {
          "gateId": "sql-queries",
          "direction": "inbound",
          "dataTypeSchema": "sql-query-schema.json",
          "validationMode": "strict"
        }
      ]
    }
  }
}
```

## Security Considerations

1. **Default Deny**: Modules get zero capabilities by default
2. **Least Privilege**: Request only needed capabilities
3. **Policy as Code**: Policies versioned and reviewed like code
4. **Enforcement Layers**: Multiple enforcers for defense in depth
5. **Violation Detection**: Runtime monitoring for contract violations
6. **User Approval**: Sensitive capabilities trigger user prompts
7. **Audit Trail**: All contract evaluations and violations logged

## Known Limitations (Phase 1A)

- **No actual enforcement**: Only interfaces defined, no working enforcers
- **No policy engine**: `contract-opa` is Phase 2
- **No data gate validation**: Interface defined, implementation is Phase 2
- **No rate limiting**: Declared but not enforced
- **No cross-module trust**: All modules in same trust domain

These will be addressed in Phase 2 (reference implementations) and Phase 3 (hardened production).

## Related Documentation

- [SECURITY-FRAMEWORK.md](./SECURITY-FRAMEWORK.md) - Overall security architecture
- [IDENTITY-INTERFACE.md](./IDENTITY-INTERFACE.md) - Module identity (used in contract evaluation)
- [ENCRYPTION-INTERFACE.md](./ENCRYPTION-INTERFACE.md) - Encryption (used for inter-module mtls)
- [SECURITY-LIFECYCLE-HOOKS.md](./SECURITY-LIFECYCLE-HOOKS.md) - Hook details

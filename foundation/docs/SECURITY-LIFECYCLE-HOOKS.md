# Security Lifecycle Hooks

**Version**: 1.0.0
**Schema**: Updated `lifecycle.schema.json`
**Status**: Phase 1A - Hooks Defined

## Overview

The foundation adds four new lifecycle hooks for security integration. These hooks run at specific points in the module lifecycle to coordinate security provisioning, rotation, and session management.

## Hook Definitions

### 1. security-provision

**When**: After identity credential issuance and encryption key provisioning

**Purpose**: Module-specific security setup

**Invocation Order**:
1. Foundation calls `identity_provider.issue_credential()`
2. Foundation calls `key_provider.provision_module_key()` (for each needed key)
3. Foundation calls `storage_provider.provision_encrypted_directory()`
4. **→ `security-provision` hook called**
5. Module continues with normal startup

**Environment Variables Provided**:
```bash
SECURITY_CREDENTIAL_ID="cred-abc123"
SECURITY_CREDENTIAL_TYPE="x509-svid"
SECURITY_CREDENTIAL_PATH="/run/security/credential"
SECURITY_TRUST_DOMAIN="peermesh.local"
SECURITY_KEY_HANDLES='[{"handleId":"key-1","keyPurpose":"encryption"}]'
SECURITY_VOLUME_ID="vol-xyz789"
SECURITY_VOLUME_PATH="/data/my-module"
```

**Example Hook**:
```bash
#!/bin/bash
# security-provision hook

# Load credential into application config
cp "${SECURITY_CREDENTIAL_PATH}" /etc/app/credential.pem
chmod 600 /etc/app/credential.pem

# Initialize encrypted database
if [ -n "${SECURITY_VOLUME_PATH}" ]; then
    sqlite3 "${SECURITY_VOLUME_PATH}/app.db" "CREATE TABLE IF NOT EXISTS secrets (...);"
fi

# Log provisioning
echo "Security provisioned: credential=${SECURITY_CREDENTIAL_ID}, volume=${SECURITY_VOLUME_ID}"
```

**Exit Codes**:
- `0`: Success, continue module startup
- `non-zero`: Failure, abort module startup

---

### 2. security-deprovision

**When**: Before identity revocation and key eviction

**Purpose**: Security-related cleanup

**Invocation Order**:
1. Module shutdown initiated
2. **→ `security-deprovision` hook called**
3. Foundation calls `key_provider.revoke_module_key()` (for each key)
4. Foundation calls `identity_provider.revoke_credential()`
5. Foundation calls `storage_provider.destroy_directory()` (if uninstalling)
6. Module shutdown completes

**Environment Variables Provided**:
Same as `security-provision`

**Example Hook**:
```bash
#!/bin/bash
# security-deprovision hook

# Clear cached credentials from memory
kill -USR1 $(cat /var/run/app.pid)

# Flush encrypted buffers
sync

# Remove temporary credential files
rm -f /tmp/app-credential-*

echo "Security deprovisioning complete"
```

**Exit Codes**:
- `0`: Success, continue shutdown
- `non-zero`: Warning logged, shutdown continues anyway

---

### 3. security-rotate

**When**: Credentials or keys are rotated

**Purpose**: Update module to use new credentials/keys

**Triggers**:
- Credential approaching expiry (automatic rotation)
- Key approaching expiry (automatic rotation)
- Manual rotation request
- Security policy update

**Invocation Order**:
1. Foundation calls `identity_provider.rotate_credentials()` or `key_provider.rotate_module_key()`
2. New credential/key provisioned
3. **→ `security-rotate` hook called**
4. Module updates to new credential/key
5. Old credential/key remains valid for grace period
6. Grace period expires, old credential/key revoked

**Environment Variables Provided**:
```bash
SECURITY_ROTATION_TYPE="credential"  # or "key"
SECURITY_OLD_CREDENTIAL_ID="cred-old123"
SECURITY_NEW_CREDENTIAL_ID="cred-new456"
SECURITY_NEW_CREDENTIAL_PATH="/run/security/credential-new"
SECURITY_GRACE_PERIOD_SECONDS="300"  # 5 minutes
```

**Example Hook**:
```bash
#!/bin/bash
# security-rotate hook

if [ "${SECURITY_ROTATION_TYPE}" = "credential" ]; then
    # Replace credential file
    mv "${SECURITY_NEW_CREDENTIAL_PATH}" /etc/app/credential.pem
    chmod 600 /etc/app/credential.pem

    # Reload application (reload config without restart)
    kill -HUP $(cat /var/run/app.pid)

    echo "Credential rotated: ${SECURITY_OLD_CREDENTIAL_ID} -> ${SECURITY_NEW_CREDENTIAL_ID}"
fi

if [ "${SECURITY_ROTATION_TYPE}" = "key" ]; then
    # Application automatically uses new key handle from environment
    # No action needed
    echo "Key rotated: ${SECURITY_OLD_KEY_HANDLE_ID} -> ${SECURITY_NEW_KEY_HANDLE_ID}"
fi
```

**Exit Codes**:
- `0`: Success, rotation complete
- `non-zero`: Failure, old credential/key remains active, retry scheduled

---

### 4. security-lock

**When**: Session locks (if module has `security.session.lockBehavior` configured)

**Purpose**: Respond to session lock event

**Only Called If**: Module manifest includes:
```json
{
  "security": {
    "session": {
      "lockBehavior": "lock-data"  // or "suspend", "stop"
    }
  }
}
```

**Invocation Order**:
1. Session lock event detected (user inactivity, manual lock, system suspend)
2. Grace period starts (from `security.session.gracePeriodMs`)
3. **→ `security-lock` hook called**
4. Module responds based on `lockBehavior`:
   - `stop`: Foundation stops module
   - `suspend`: Foundation pauses module container
   - `lock-data`: Module locks data, continues running
   - `continue`: Module ignores lock (hook not called)

**Environment Variables Provided**:
```bash
SECURITY_LOCK_REASON="user-inactivity"  # or "manual-lock", "system-suspend"
SECURITY_LOCK_BEHAVIOR="lock-data"
SECURITY_GRACE_PERIOD_MS="5000"
SECURITY_SESSION_ID="session-abc123"
```

**Example Hook**:
```bash
#!/bin/bash
# security-lock hook

if [ "${SECURITY_LOCK_BEHAVIOR}" = "lock-data" ]; then
    # Close all database connections
    psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='app_db';"

    # Lock encrypted volumes (foundation does this automatically if storage provider present)
    # Module just needs to stop accessing the volume

    # Evict keys from memory (implementation-specific)
    kill -USR2 $(cat /var/run/app.pid)

    echo "Data locked due to: ${SECURITY_LOCK_REASON}"
fi
```

**Exit Codes**:
- `0`: Success, lock complete
- `non-zero`: Warning logged, lock proceeds anyway

**Unlock**: When session resumes, module restarts (or container resumes), `security-provision` flow re-runs to unlock volumes.

---

## Hook Declaration in Module Manifest

Security hooks are declared in `lifecycle` section like other hooks:

```json
{
  "lifecycle": {
    "install": "./scripts/install.sh",
    "start": "./scripts/start.sh",
    "stop": "./scripts/stop.sh",
    "security-provision": "./scripts/security-provision.sh",
    "security-deprovision": "./scripts/security-deprovision.sh",
    "security-rotate": {
      "script": "./scripts/security-rotate.sh",
      "timeout": 60,
      "retries": 3
    },
    "security-lock": "./scripts/security-lock.sh"
  }
}
```

**Optional Hooks**: All security hooks are optional. If not declared, foundation skips them (with info-level log).

---

## Common Patterns

### Minimal Security-Aware Module

```bash
#!/bin/bash
# security-provision - Just log that security was provisioned

echo "Module has identity: ${SECURITY_CREDENTIAL_ID}"
echo "Data directory: ${SECURITY_VOLUME_PATH}"
exit 0
```

### Credential-Aware Web Service

```bash
#!/bin/bash
# security-provision - Configure web service with TLS certificate

if [ "${SECURITY_CREDENTIAL_TYPE}" = "x509-svid" ]; then
    # Extract cert and key from SVID
    ./extract-svid.sh "${SECURITY_CREDENTIAL_PATH}" /etc/nginx/cert.pem /etc/nginx/key.pem

    # Update nginx config
    nginx -s reload
fi
```

### Database with Encrypted Storage

```bash
#!/bin/bash
# security-provision - Initialize encrypted database

if [ -n "${SECURITY_VOLUME_PATH}" ]; then
    DB_PATH="${SECURITY_VOLUME_PATH}/postgres"

    if [ ! -d "${DB_PATH}" ]; then
        # First time: initialize database in encrypted volume
        initdb -D "${DB_PATH}"
    fi

    # Start postgres pointing at encrypted volume
    pg_ctl -D "${DB_PATH}" start
fi
```

### Graceful Key Rotation

```bash
#!/bin/bash
# security-rotate - Handle key rotation without downtime

if [ "${SECURITY_ROTATION_TYPE}" = "key" ]; then
    # Notify application of new key handle
    # Application should:
    # 1. Start using new key for new operations
    # 2. Keep old key for reading existing data
    # 3. After grace period, re-encrypt data with new key

    curl -X POST http://localhost:8080/admin/rotate-key \
        -d "{\"old\":\"${SECURITY_OLD_KEY_HANDLE_ID}\",\"new\":\"${SECURITY_NEW_KEY_HANDLE_ID}\"}"
fi
```

---

## Error Handling

### Hook Failures

- **security-provision failure**: Module fails to start
- **security-deprovision failure**: Warning logged, shutdown continues
- **security-rotate failure**: Old credential/key remains active, retry scheduled
- **security-lock failure**: Warning logged, lock proceeds

### Missing Hooks

If a security hook is not declared:
- Foundation logs info-level message: "Module does not define security-provision hook"
- Security provisioning continues (credential/keys still issued)
- Module starts normally

### No Security Providers

If no security providers are installed:
- Hooks are still called (with dummy/empty environment variables)
- Modules can check if security is actually active:
  ```bash
  if [ "${SECURITY_CREDENTIAL_ID}" = "none" ]; then
      echo "WARNING: Running without identity provider"
  fi
  ```

---

## Hook Execution Environment

All security hooks run with:

- **Working directory**: Module root directory
- **User**: Module user (not root, unless module explicitly requires it)
- **Timeout**: 300 seconds (default), or `timeout` from hook config
- **Retries**: 0 (default), or `retries` from hook config
- **Environment**: Standard module environment + security-specific variables

---

## Security Considerations

1. **Credential Files**: Written to `/run/security/{module-id}/` (tmpfs, cleared on boot)
2. **Permissions**: Credential files are `0600`, owned by module user
3. **Cleanup**: Credential files removed after `security-provision` hook completes
4. **Grace Periods**: Rotation grace periods prevent downtime but extend key lifetime
5. **Lock Enforcement**: `security-lock` hook must complete before encrypted volumes locked
6. **Audit**: All hook invocations logged with outcome

---

## Related Documentation

- [SECURITY-FRAMEWORK.md](./SECURITY-FRAMEWORK.md) - Overall security architecture
- [IDENTITY-INTERFACE.md](./IDENTITY-INTERFACE.md) - Identity credential lifecycle
- [ENCRYPTION-INTERFACE.md](./ENCRYPTION-INTERFACE.md) - Key and storage encryption
- [CONTRACT-SYSTEM.md](./CONTRACT-SYSTEM.md) - Capability contracts
- [LIFECYCLE-HOOKS.md](./LIFECYCLE-HOOKS.md) - General lifecycle hooks

# Encryption Interface

**Version**: 1.0.0
**Interface**: `foundation/interfaces/encryption.py`, `encryption.ts`
**Schema**: Part of `security.schema.json`
**Status**: Phase 1A - Core Interface Defined

## Purpose

The Encryption Interface defines two related capabilities:

1. **Key Management**: Provision, rotate, and use cryptographic keys
2. **Storage Encryption**: Encrypted directories for module data at rest

Both capabilities are provided by pluggable modules (e.g., `encryption-openbao` for keys, `encryption-fscrypt` for storage).

## Core Concepts

### Key Management

Modules request cryptographic keys for specific purposes (encryption, signing, authentication). The key management provider:

- Provisions keys without exposing them to the module
- Performs cryptographic operations (encrypt/decrypt) on behalf of the module
- Rotates keys before expiry
- Revokes keys during deprovisioning

Keys are never directly accessible to modules — only **key handles** (opaque references).

### Storage Encryption

Modules can request encrypted directories for data at rest. The storage encryption provider:

- Creates encrypted filesystem directories
- Locks directories (makes inaccessible) when sessions end
- Unlocks directories when sessions resume
- Destroys directories securely during uninstallation

## Protocol Interfaces

### KeyManagementProvider

```python
class KeyManagementProvider(Protocol):
    async def provision_module_key(
        module_id: str,
        key_purpose: KeyPurpose,
        key_type: KeyType
    ) -> KeyHandle

    async def revoke_module_key(key_handle: KeyHandle) -> None
    async def rotate_module_key(key_handle: KeyHandle) -> KeyHandle

    async def encrypt(key_handle: KeyHandle, plaintext: bytes) -> bytes
    async def decrypt(key_handle: KeyHandle, ciphertext: bytes) -> bytes

    async def get_module_keys(module_id: str) -> List[KeyHandle]
    def is_available() -> bool
    async def close() -> None
```

### StorageEncryptionProvider

```python
class StorageEncryptionProvider(Protocol):
    async def provision_encrypted_directory(
        module_id: str,
        path: str
    ) -> EncryptedVolume

    async def lock_directory(volume: EncryptedVolume) -> None
    async def unlock_directory(volume: EncryptedVolume, key_handle: KeyHandle) -> None
    async def destroy_directory(volume: EncryptedVolume) -> None

    def is_locked(volume: EncryptedVolume) -> bool
    def is_available() -> bool
    async def close() -> None
```

### Key Data Types

**KeyPurpose** (enum):
- `encryption` - Data encryption/decryption
- `signing` - Digital signatures
- `authentication` - Authentication tokens
- `derivation` - Key derivation

**KeyType** (enum):
- `symmetric-aes256` - AES-256 symmetric key
- `ed25519` - Ed25519 signing key
- `p256` - NIST P-256 elliptic curve
- `x25519` - X25519 key exchange

**KeyHandle**:
- `handle_id`: Unique key identifier
- `module_id`: Module that owns this key
- `key_purpose`, `key_type`: Key metadata
- `created_at`, `rotated_at`, `expires_at`: Lifecycle timestamps
- `metadata`: Provider-specific data

**EncryptedVolume**:
- `volume_id`: Unique volume identifier
- `module_id`: Module that owns this volume
- `path`: Filesystem path
- `encryption_method`: Implementation (e.g., "fscrypt-v2", "luks2")
- `locked`: Current lock state
- `created_at`: Creation timestamp

## Module Manifest Declaration

```json
{
  "security": {
    "encryption": {
      "dataAtRest": "required",
      "transitEncryption": "mtls",
      "keyPurposes": ["encryption", "signing"]
    }
  }
}
```

**Fields**:
- `dataAtRest`: `"required"`, `"preferred"`, or `"none"` (default: `"preferred"`)
- `transitEncryption`: `"mtls"`, `"tls"`, or `"none"` (default: `"tls"`)
- `keyPurposes`: Array of key purposes needed (default: `[]`)

## Lifecycle Integration

### Provisioning Flow

1. Module declares `security.encryption.dataAtRest: "required"`
2. Foundation checks for `KeyManagementProvider` and `StorageEncryptionProvider`
3. Key provisioning:
   ```python
   for purpose in module.security.encryption.keyPurposes:
       key = await key_provider.provision_module_key(module_id, purpose, key_type)
   ```
4. Storage provisioning:
   ```python
   volume = await storage_provider.provision_encrypted_directory(
       module_id,
       f"/data/{module_id}"
   )
   ```
5. `security-provision` lifecycle hook called with key/volume info
6. Module starts with encrypted storage

### Lock/Unlock Flow (Session Integration)

When session locks (if `security.session.lockBehavior` is configured):

1. `security-lock` lifecycle hook called
2. Module flushes any pending writes
3. Storage provider locks directory:
   ```python
   await storage_provider.lock_directory(volume)
   ```
4. Keys evicted from memory (implementation-specific)

When session resumes:

1. User authenticates
2. Storage provider unlocks directory:
   ```python
   await storage_provider.unlock_directory(volume, encryption_key)
   ```
3. Module resumes operation

### Rotation Flow

1. Key provider detects key approaching expiry
2. `key_provider.rotate_module_key(old_key_handle)` → new key
3. `security-rotate` lifecycle hook called
4. Module re-encrypts data with new key (if needed)

### Deprovisioning Flow

1. `security-deprovision` hook called (module cleanup)
2. Keys revoked:
   ```python
   for key in keys:
       await key_provider.revoke_module_key(key)
   ```
3. Storage destroyed:
   ```python
   await storage_provider.destroy_directory(volume)
   ```

## Standard Events

- `foundation.encryption.key-provisioned`
  - Payload: `{ moduleId, handleId, keyPurpose, keyType, expiresAt? }`
- `foundation.encryption.key-revoked`
  - Payload: `{ moduleId, handleId, reason? }`
- `foundation.encryption.key-rotated`
  - Payload: `{ moduleId, oldHandleId, newHandleId, keyPurpose }`
- `foundation.encryption.volume-provisioned`
  - Payload: `{ moduleId, volumeId, path, encryptionMethod }`
- `foundation.encryption.volume-locked`
  - Payload: `{ moduleId, volumeId, reason? }`
- `foundation.encryption.volume-unlocked`
  - Payload: `{ moduleId, volumeId }`
- `foundation.encryption.volume-destroyed`
  - Payload: `{ moduleId, volumeId, reason? }`
- `foundation.encryption.provider-available/unavailable`
  - Payload: `{ providerName, providerType, message? }`

## Implementation Examples

### OpenBao Key Management

The `encryption-openbao` module implements `KeyManagementProvider` using OpenBao vault:

- `provision_module_key()` → Creates key in OpenBao transit engine
- `encrypt()/decrypt()` → Calls OpenBao transit API (key never leaves vault)
- `rotate_module_key()` → OpenBao key rotation
- Hierarchical key derivation (master → module → purpose)

### fscrypt Storage Encryption

The `encryption-fscrypt` module implements `StorageEncryptionProvider` using Linux fscrypt:

- `provision_encrypted_directory()` → Creates fscrypt policy for directory
- `lock_directory()` → Removes encryption key from kernel keyring
- `unlock_directory()` → Adds key to keyring, directory accessible
- Requires Linux kernel 4.1+ with fscrypt support

### No-op Fallback

When no encryption provider is installed:

- `KeyManagementProvider` returns dummy handles, no actual encryption
- `StorageEncryptionProvider` creates normal (unencrypted) directories
- Logs warnings about missing encryption

## Usage Patterns

### Encrypting Module Data

```python
# Module initialization
key_handle = get_encryption_key()  # From environment/config

# Encrypt sensitive data before storage
plaintext = b"sensitive data"
ciphertext = await key_provider.encrypt(key_handle, plaintext)
save_to_database(ciphertext)

# Decrypt when reading
ciphertext = load_from_database()
plaintext = await key_provider.decrypt(key_handle, ciphertext)
```

### Using Encrypted Storage

```python
# Module just writes to its data directory
with open("/data/my-module/secrets.db", "w") as f:
    f.write(sensitive_data)

# Foundation ensures directory is encrypted
# Lock/unlock handled automatically by session lifecycle
```

### Signing Data

```python
# Provision signing key
signing_key = await key_provider.provision_module_key(
    module_id,
    KeyPurpose.SIGNING,
    KeyType.ED25519
)

# Sign data (implementation delegates to provider)
signature = await key_provider.sign(signing_key, data)
```

## Security Considerations

1. **Keys Never Exposed**: Modules never see raw keys, only handles
2. **Rotation**: Implement rotation handlers to avoid key expiry
3. **Hierarchy**: Key providers should use hierarchical key derivation
4. **Locked State**: Encrypted volumes should be locked when sessions end
5. **Destruction**: `destroy_directory()` must securely erase data
6. **Transit Encryption**: `transitEncryption: "mtls"` requires identity provider
7. **Fail-Closed**: Critical modules should require encryption enforcement

## Known Limitations (Phase 1A)

- **No actual implementations**: Only interfaces defined, no working providers
- **No key import/export**: Interfaces assume provider-managed keys only
- **No hardware backing**: Hardware abstraction is Phase 1B
- **No backup/recovery**: Key backup/escrow not yet defined

These will be addressed in Phase 2 (reference implementations) and Phase 3 (hardened production).

## Related Documentation

- [SECURITY-FRAMEWORK.md](./SECURITY-FRAMEWORK.md) - Overall security architecture
- [IDENTITY-INTERFACE.md](./IDENTITY-INTERFACE.md) - Module identity (used for key ownership)
- [CONTRACT-SYSTEM.md](./CONTRACT-SYSTEM.md) - Contracts (uses encryption for mtls)
- [SECURITY-LIFECYCLE-HOOKS.md](./SECURITY-LIFECYCLE-HOOKS.md) - Hook details

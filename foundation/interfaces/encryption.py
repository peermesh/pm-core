"""
PeerMesh Foundation - Encryption Interface

This file defines the Python protocol (interface) for encryption services.
The foundation core includes only this interface - actual implementations
are provided by add-on modules (e.g., encryption-openbao, encryption-fscrypt).

The encryption interface provides two related capabilities:
1. Key management: Provision, rotate, and revoke cryptographic keys
2. Storage encryption: Encrypted directories for module data at rest

Usage:
    from foundation.interfaces.encryption import KeyManagementProvider, StorageEncryptionProvider

Example:
    # Provision a key for a module
    key_handle = await key_provider.provision_module_key(
        module_id='backup-module',
        key_purpose=KeyPurpose.ENCRYPTION,
        key_type=KeyType.SYMMETRIC_AES256
    )

    # Encrypt data
    ciphertext = await key_provider.encrypt(key_handle, plaintext)

    # Provision encrypted storage
    volume = await storage_provider.provision_encrypted_directory(
        module_id='backup-module',
        path='/data/backup-module'
    )
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol
from time import time


class KeyPurpose(str, Enum):
    """Purpose for which a cryptographic key will be used."""
    ENCRYPTION = 'encryption'      # Data encryption/decryption
    SIGNING = 'signing'           # Digital signatures
    AUTHENTICATION = 'authentication'  # Authentication tokens
    DERIVATION = 'derivation'     # Key derivation


class KeyType(str, Enum):
    """Type of cryptographic key."""
    SYMMETRIC_AES256 = 'symmetric-aes256'  # AES-256 symmetric key
    ED25519 = 'ed25519'                    # Ed25519 signing key
    P256 = 'p256'                          # NIST P-256 elliptic curve
    X25519 = 'x25519'                      # X25519 key exchange


@dataclass
class KeyHandle:
    """
    KeyHandle represents a reference to a cryptographic key.

    The handle does not contain the key itself - it's an opaque reference
    that can be used with the key management provider to perform operations.

    Attributes:
        handle_id: Unique identifier for this key handle
        module_id: Module that owns this key
        key_purpose: What the key is used for
        key_type: Type of cryptographic key
        created_at: Unix timestamp (milliseconds) when key was created
        rotated_at: Unix timestamp (milliseconds) of last rotation (if any)
        expires_at: Unix timestamp (milliseconds) when key expires (if applicable)
        metadata: Additional provider-specific metadata
    """
    handle_id: str
    module_id: str
    key_purpose: KeyPurpose
    key_type: KeyType
    created_at: int
    rotated_at: Optional[int] = None
    expires_at: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EncryptedVolume:
    """
    EncryptedVolume represents an encrypted directory for module data.

    The volume provides transparent encryption for all data written to
    the directory path.

    Attributes:
        volume_id: Unique identifier for this encrypted volume
        module_id: Module that owns this volume
        path: Filesystem path to the encrypted directory
        encryption_method: Method used for encryption (e.g., "fscrypt-v2", "luks2")
        locked: Whether the volume is currently locked (inaccessible)
        created_at: Unix timestamp (milliseconds) when volume was created
        metadata: Additional provider-specific metadata
    """
    volume_id: str
    module_id: str
    path: str
    encryption_method: str
    locked: bool
    created_at: int
    metadata: Dict[str, Any] = field(default_factory=dict)


class KeyManagementProvider(Protocol):
    """
    KeyManagementProvider defines the interface for cryptographic key management.

    This protocol handles provisioning, rotation, and use of cryptographic keys.
    The foundation core provides a no-op implementation; actual implementations
    are provided by add-on modules (e.g., encryption-openbao).

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def provision_module_key(
        self,
        module_id: str,
        key_purpose: KeyPurpose,
        key_type: KeyType,
    ) -> KeyHandle:
        """
        Provision a new cryptographic key for a module.

        Called during module provisioning or when a module requests additional keys.
        The key is stored securely and never exposed directly to the module.

        Args:
            module_id: Module requesting the key
            key_purpose: What the key will be used for
            key_type: Type of cryptographic key to provision

        Returns:
            KeyHandle that can be used for cryptographic operations

        Raises:
            ProvisioningError: If key provisioning fails
        """
        ...

    async def revoke_module_key(
        self,
        key_handle: KeyHandle,
    ) -> None:
        """
        Revoke a cryptographic key.

        Called during module deprovisioning or when a key is no longer needed.
        After revocation, the key cannot be used for any operations.

        Args:
            key_handle: Handle to the key to revoke

        Raises:
            RevocationError: If key revocation fails
        """
        ...

    async def rotate_module_key(
        self,
        key_handle: KeyHandle,
    ) -> KeyHandle:
        """
        Rotate a cryptographic key.

        Creates a new key and returns a new handle. The old key may remain
        valid for a grace period to allow decryption of existing data.

        Args:
            key_handle: Handle to the key to rotate

        Returns:
            New KeyHandle for the rotated key

        Raises:
            RotationError: If key rotation fails
        """
        ...

    async def encrypt(
        self,
        key_handle: KeyHandle,
        plaintext: bytes,
    ) -> bytes:
        """
        Encrypt data using a key.

        Args:
            key_handle: Handle to the encryption key
            plaintext: Data to encrypt

        Returns:
            Encrypted ciphertext

        Raises:
            EncryptionError: If encryption fails
        """
        ...

    async def decrypt(
        self,
        key_handle: KeyHandle,
        ciphertext: bytes,
    ) -> bytes:
        """
        Decrypt data using a key.

        Args:
            key_handle: Handle to the decryption key
            ciphertext: Data to decrypt

        Returns:
            Decrypted plaintext

        Raises:
            DecryptionError: If decryption fails
        """
        ...

    async def get_module_keys(
        self,
        module_id: str,
    ) -> List[KeyHandle]:
        """
        Get all active key handles for a module.

        Args:
            module_id: Module to query keys for

        Returns:
            List of KeyHandles owned by the module
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the key management provider is operational.

        Returns:
            True if the provider can perform key operations
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the key management provider connection.
        """
        ...


class StorageEncryptionProvider(Protocol):
    """
    StorageEncryptionProvider defines the interface for encrypted storage.

    This protocol handles provisioning and managing encrypted directories
    for module data at rest. Implementations might use fscrypt, LUKS,
    dm-crypt, or other storage encryption technologies.

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def provision_encrypted_directory(
        self,
        module_id: str,
        path: str,
    ) -> EncryptedVolume:
        """
        Provision an encrypted directory for a module.

        Called during module provisioning to create encrypted storage.
        All data written to the directory is transparently encrypted.

        Args:
            module_id: Module requesting encrypted storage
            path: Filesystem path for the encrypted directory

        Returns:
            EncryptedVolume handle for the directory

        Raises:
            ProvisioningError: If provisioning fails
        """
        ...

    async def lock_directory(
        self,
        volume: EncryptedVolume,
    ) -> None:
        """
        Lock an encrypted directory, making it inaccessible.

        Called when a session locks or module stops. The directory
        becomes inaccessible until unlocked.

        Args:
            volume: Volume to lock

        Raises:
            LockError: If locking fails
        """
        ...

    async def unlock_directory(
        self,
        volume: EncryptedVolume,
        key_handle: KeyHandle,
    ) -> None:
        """
        Unlock an encrypted directory, making it accessible.

        Called when a session starts or module resumes.

        Args:
            volume: Volume to unlock
            key_handle: Key handle with decryption capability

        Raises:
            UnlockError: If unlocking fails
        """
        ...

    async def destroy_directory(
        self,
        volume: EncryptedVolume,
    ) -> None:
        """
        Permanently destroy an encrypted directory and its contents.

        Called during module uninstallation. All data is securely erased.

        Args:
            volume: Volume to destroy

        Raises:
            DestructionError: If destruction fails
        """
        ...

    def is_locked(
        self,
        volume: EncryptedVolume,
    ) -> bool:
        """
        Check if an encrypted directory is locked.

        Args:
            volume: Volume to check

        Returns:
            True if the directory is locked
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the storage encryption provider is operational.

        Returns:
            True if the provider can manage encrypted directories
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the storage encryption provider connection.
        """
        ...


# Standard event types defined by the foundation
class FoundationEncryptionEventTypes:
    """Standard encryption-related event types defined by the foundation core."""
    KEY_PROVISIONED = 'foundation.encryption.key-provisioned'
    KEY_REVOKED = 'foundation.encryption.key-revoked'
    KEY_ROTATED = 'foundation.encryption.key-rotated'
    VOLUME_PROVISIONED = 'foundation.encryption.volume-provisioned'
    VOLUME_LOCKED = 'foundation.encryption.volume-locked'
    VOLUME_UNLOCKED = 'foundation.encryption.volume-unlocked'
    VOLUME_DESTROYED = 'foundation.encryption.volume-destroyed'
    PROVIDER_AVAILABLE = 'foundation.encryption.provider-available'
    PROVIDER_UNAVAILABLE = 'foundation.encryption.provider-unavailable'


# Payload dataclasses for standard encryption events
@dataclass
class KeyProvisionedPayload:
    """Payload for encryption.key-provisioned events."""
    module_id: str
    handle_id: str
    key_purpose: KeyPurpose
    key_type: KeyType
    expires_at: Optional[int] = None


@dataclass
class KeyRevokedPayload:
    """Payload for encryption.key-revoked events."""
    module_id: str
    handle_id: str
    reason: Optional[str] = None


@dataclass
class KeyRotatedPayload:
    """Payload for encryption.key-rotated events."""
    module_id: str
    old_handle_id: str
    new_handle_id: str
    key_purpose: KeyPurpose


@dataclass
class VolumeProvisionedPayload:
    """Payload for encryption.volume-provisioned events."""
    module_id: str
    volume_id: str
    path: str
    encryption_method: str


@dataclass
class VolumeLockedPayload:
    """Payload for encryption.volume-locked events."""
    module_id: str
    volume_id: str
    reason: Optional[str] = None


@dataclass
class VolumeUnlockedPayload:
    """Payload for encryption.volume-unlocked events."""
    module_id: str
    volume_id: str


@dataclass
class VolumeDestroyedPayload:
    """Payload for encryption.volume-destroyed events."""
    module_id: str
    volume_id: str
    reason: Optional[str] = None


@dataclass
class EncryptionProviderStatusPayload:
    """Payload for encryption.provider-available/unavailable events."""
    provider_name: str
    provider_type: str  # 'key-management' or 'storage-encryption'
    message: Optional[str] = None


class NoopKeyManagementProvider:
    """
    No-operation key management provider for fallback mode.

    Keys are represented as handles only; encryption/decryption is pass-through.
    """

    def __init__(self) -> None:
        self._warned = False
        self._handles: Dict[str, List[KeyHandle]] = {}

    def _warn_once(self) -> None:
        if not self._warned:
            import warnings
            warnings.warn(
                "[Encryption] No key management provider installed. Using no-op fallback.",
                stacklevel=3,
            )
            self._warned = True

    def _now_ms(self) -> int:
        return int(time() * 1000)

    async def provision_module_key(
        self,
        module_id: str,
        key_purpose: KeyPurpose,
        key_type: KeyType,
    ) -> KeyHandle:
        self._warn_once()
        handle = KeyHandle(
            handle_id=f"noop-key-{module_id}-{self._now_ms()}",
            module_id=module_id,
            key_purpose=key_purpose,
            key_type=key_type,
            created_at=self._now_ms(),
            metadata={"provider": "noop-key-management"},
        )
        self._handles.setdefault(module_id, []).append(handle)
        return handle

    async def revoke_module_key(self, key_handle: KeyHandle) -> None:
        keys = self._handles.get(key_handle.module_id, [])
        self._handles[key_handle.module_id] = [k for k in keys if k.handle_id != key_handle.handle_id]

    async def rotate_module_key(self, key_handle: KeyHandle) -> KeyHandle:
        await self.revoke_module_key(key_handle)
        return await self.provision_module_key(
            module_id=key_handle.module_id,
            key_purpose=key_handle.key_purpose,
            key_type=key_handle.key_type,
        )

    async def encrypt(self, key_handle: KeyHandle, plaintext: bytes) -> bytes:
        del key_handle
        return plaintext

    async def decrypt(self, key_handle: KeyHandle, ciphertext: bytes) -> bytes:
        del key_handle
        return ciphertext

    async def get_module_keys(self, module_id: str) -> List[KeyHandle]:
        return list(self._handles.get(module_id, []))

    def is_available(self) -> bool:
        return False

    async def close(self) -> None:
        return None


class NoopStorageEncryptionProvider:
    """
    No-operation storage encryption provider for fallback mode.
    """

    def __init__(self) -> None:
        self._warned = False
        self._volumes: Dict[str, EncryptedVolume] = {}

    def _warn_once(self) -> None:
        if not self._warned:
            import warnings
            warnings.warn(
                "[Encryption] No storage encryption provider installed. Using no-op fallback.",
                stacklevel=3,
            )
            self._warned = True

    def _now_ms(self) -> int:
        return int(time() * 1000)

    async def provision_encrypted_directory(self, module_id: str, path: str) -> EncryptedVolume:
        self._warn_once()
        volume = EncryptedVolume(
            volume_id=f"noop-volume-{module_id}-{self._now_ms()}",
            module_id=module_id,
            path=path,
            encryption_method="noop",
            locked=False,
            created_at=self._now_ms(),
            metadata={"provider": "noop-storage-encryption"},
        )
        self._volumes[volume.volume_id] = volume
        return volume

    async def lock_directory(self, volume: EncryptedVolume) -> None:
        volume.locked = True

    async def unlock_directory(self, volume: EncryptedVolume, key_handle: KeyHandle) -> None:
        del key_handle
        volume.locked = False

    async def destroy_directory(self, volume: EncryptedVolume) -> None:
        self._volumes.pop(volume.volume_id, None)

    def is_locked(self, volume: EncryptedVolume) -> bool:
        return volume.locked

    def is_available(self) -> bool:
        return False

    async def close(self) -> None:
        return None

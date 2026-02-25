/**
 * PeerMesh Foundation - Encryption Interface
 *
 * This file defines the TypeScript interface for encryption services.
 * The foundation core includes only this interface - actual implementations
 * are provided by add-on modules (e.g., encryption-openbao, encryption-fscrypt).
 *
 * The encryption interface provides two related capabilities:
 * 1. Key management: Provision, rotate, and revoke cryptographic keys
 * 2. Storage encryption: Encrypted directories for module data at rest
 *
 * @module foundation/interfaces/encryption
 * @version 1.0.0
 */

/**
 * KeyPurpose enumerates the purposes for which a key can be used.
 */
export type KeyPurpose = 'encryption' | 'signing' | 'authentication' | 'derivation';

/**
 * KeyType enumerates the types of cryptographic keys.
 */
export type KeyType = 'symmetric-aes256' | 'ed25519' | 'p256' | 'x25519';

/**
 * KeyHandle represents a reference to a cryptographic key.
 *
 * The handle does not contain the key itself - it's an opaque reference
 * that can be used with the key management provider to perform operations.
 */
export interface KeyHandle {
  /** Unique identifier for this key handle */
  handleId: string;

  /** Module that owns this key */
  moduleId: string;

  /** What the key is used for */
  keyPurpose: KeyPurpose;

  /** Type of cryptographic key */
  keyType: KeyType;

  /** Unix timestamp (milliseconds) when key was created */
  createdAt: number;

  /** Unix timestamp (milliseconds) of last rotation (if any) */
  rotatedAt?: number;

  /** Unix timestamp (milliseconds) when key expires (if applicable) */
  expiresAt?: number;

  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * EncryptedVolume represents an encrypted directory for module data.
 *
 * The volume provides transparent encryption for all data written to
 * the directory path.
 */
export interface EncryptedVolume {
  /** Unique identifier for this encrypted volume */
  volumeId: string;

  /** Module that owns this volume */
  moduleId: string;

  /** Filesystem path to the encrypted directory */
  path: string;

  /** Method used for encryption (e.g., "fscrypt-v2", "luks2") */
  encryptionMethod: string;

  /** Whether the volume is currently locked (inaccessible) */
  locked: boolean;

  /** Unix timestamp (milliseconds) when volume was created */
  createdAt: number;

  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * KeyManagementProvider defines the interface for cryptographic key management.
 *
 * This interface handles provisioning, rotation, and use of cryptographic keys.
 * The foundation core provides a no-op implementation; actual implementations
 * are provided by add-on modules.
 *
 * @example
 * ```typescript
 * // Provision a key for a module
 * const keyHandle = await keyProvider.provisionModuleKey(
 *   'backup-module',
 *   'encryption',
 *   'symmetric-aes256'
 * );
 *
 * // Encrypt data
 * const ciphertext = await keyProvider.encrypt(keyHandle, plaintext);
 * ```
 */
export interface KeyManagementProvider {
  /**
   * Provision a new cryptographic key for a module.
   *
   * Called during module provisioning or when a module requests additional keys.
   *
   * @param moduleId - Module requesting the key
   * @param keyPurpose - What the key will be used for
   * @param keyType - Type of cryptographic key to provision
   * @returns Promise resolving to key handle
   * @throws {ProvisioningError} If key provisioning fails
   */
  provisionModuleKey(
    moduleId: string,
    keyPurpose: KeyPurpose,
    keyType: KeyType
  ): Promise<KeyHandle>;

  /**
   * Revoke a cryptographic key.
   *
   * Called during module deprovisioning or when a key is no longer needed.
   *
   * @param keyHandle - Handle to the key to revoke
   * @throws {RevocationError} If key revocation fails
   */
  revokeModuleKey(keyHandle: KeyHandle): Promise<void>;

  /**
   * Rotate a cryptographic key.
   *
   * Creates a new key and returns a new handle.
   *
   * @param keyHandle - Handle to the key to rotate
   * @returns Promise resolving to new key handle
   * @throws {RotationError} If key rotation fails
   */
  rotateModuleKey(keyHandle: KeyHandle): Promise<KeyHandle>;

  /**
   * Encrypt data using a key.
   *
   * @param keyHandle - Handle to the encryption key
   * @param plaintext - Data to encrypt
   * @returns Promise resolving to encrypted ciphertext
   * @throws {EncryptionError} If encryption fails
   */
  encrypt(keyHandle: KeyHandle, plaintext: Uint8Array): Promise<Uint8Array>;

  /**
   * Decrypt data using a key.
   *
   * @param keyHandle - Handle to the decryption key
   * @param ciphertext - Data to decrypt
   * @returns Promise resolving to decrypted plaintext
   * @throws {DecryptionError} If decryption fails
   */
  decrypt(keyHandle: KeyHandle, ciphertext: Uint8Array): Promise<Uint8Array>;

  /**
   * Get all active key handles for a module.
   *
   * @param moduleId - Module to query keys for
   * @returns Promise resolving to list of key handles
   */
  getModuleKeys(moduleId: string): Promise<KeyHandle[]>;

  /**
   * Check if the key management provider is operational.
   *
   * @returns True if the provider can perform key operations
   */
  isAvailable(): boolean;

  /**
   * Gracefully close the key management provider connection.
   */
  close(): Promise<void>;
}

/**
 * StorageEncryptionProvider defines the interface for encrypted storage.
 *
 * This interface handles provisioning and managing encrypted directories
 * for module data at rest.
 *
 * @example
 * ```typescript
 * // Provision encrypted storage
 * const volume = await storageProvider.provisionEncryptedDirectory(
 *   'backup-module',
 *   '/data/backup-module'
 * );
 *
 * // Lock volume when session ends
 * await storageProvider.lockDirectory(volume);
 * ```
 */
export interface StorageEncryptionProvider {
  /**
   * Provision an encrypted directory for a module.
   *
   * Called during module provisioning to create encrypted storage.
   *
   * @param moduleId - Module requesting encrypted storage
   * @param path - Filesystem path for the encrypted directory
   * @returns Promise resolving to encrypted volume handle
   * @throws {ProvisioningError} If provisioning fails
   */
  provisionEncryptedDirectory(moduleId: string, path: string): Promise<EncryptedVolume>;

  /**
   * Lock an encrypted directory, making it inaccessible.
   *
   * Called when a session locks or module stops.
   *
   * @param volume - Volume to lock
   * @throws {LockError} If locking fails
   */
  lockDirectory(volume: EncryptedVolume): Promise<void>;

  /**
   * Unlock an encrypted directory, making it accessible.
   *
   * Called when a session starts or module resumes.
   *
   * @param volume - Volume to unlock
   * @param keyHandle - Key handle with decryption capability
   * @throws {UnlockError} If unlocking fails
   */
  unlockDirectory(volume: EncryptedVolume, keyHandle: KeyHandle): Promise<void>;

  /**
   * Permanently destroy an encrypted directory and its contents.
   *
   * Called during module uninstallation.
   *
   * @param volume - Volume to destroy
   * @throws {DestructionError} If destruction fails
   */
  destroyDirectory(volume: EncryptedVolume): Promise<void>;

  /**
   * Check if an encrypted directory is locked.
   *
   * @param volume - Volume to check
   * @returns True if the directory is locked
   */
  isLocked(volume: EncryptedVolume): boolean;

  /**
   * Check if the storage encryption provider is operational.
   *
   * @returns True if the provider can manage encrypted directories
   */
  isAvailable(): boolean;

  /**
   * Gracefully close the storage encryption provider connection.
   */
  close(): Promise<void>;
}

/**
 * Standard encryption event types defined by the foundation.
 */
export const FOUNDATION_ENCRYPTION_EVENT_TYPES = {
  KEY_PROVISIONED: 'foundation.encryption.key-provisioned',
  KEY_REVOKED: 'foundation.encryption.key-revoked',
  KEY_ROTATED: 'foundation.encryption.key-rotated',
  VOLUME_PROVISIONED: 'foundation.encryption.volume-provisioned',
  VOLUME_LOCKED: 'foundation.encryption.volume-locked',
  VOLUME_UNLOCKED: 'foundation.encryption.volume-unlocked',
  VOLUME_DESTROYED: 'foundation.encryption.volume-destroyed',
  PROVIDER_AVAILABLE: 'foundation.encryption.provider-available',
  PROVIDER_UNAVAILABLE: 'foundation.encryption.provider-unavailable',
} as const;

/**
 * Payload types for standard encryption events.
 */
export interface KeyProvisionedPayload {
  moduleId: string;
  handleId: string;
  keyPurpose: KeyPurpose;
  keyType: KeyType;
  expiresAt?: number;
}

export interface KeyRevokedPayload {
  moduleId: string;
  handleId: string;
  reason?: string;
}

export interface KeyRotatedPayload {
  moduleId: string;
  oldHandleId: string;
  newHandleId: string;
  keyPurpose: KeyPurpose;
}

export interface VolumeProvisionedPayload {
  moduleId: string;
  volumeId: string;
  path: string;
  encryptionMethod: string;
}

export interface VolumeLockedPayload {
  moduleId: string;
  volumeId: string;
  reason?: string;
}

export interface VolumeUnlockedPayload {
  moduleId: string;
  volumeId: string;
}

export interface VolumeDestroyedPayload {
  moduleId: string;
  volumeId: string;
  reason?: string;
}

export interface EncryptionProviderStatusPayload {
  providerName: string;
  providerType: 'key-management' | 'storage-encryption';
  message?: string;
}

/**
 * No-operation key management provider for fallback mode.
 */
export class NoopKeyManagementProvider implements KeyManagementProvider {
  private warned = false;
  private readonly handles = new Map<string, KeyHandle[]>();

  private warnOnce(): void {
    if (!this.warned) {
      console.warn('[Encryption] No key management provider installed. Using no-op fallback.');
      this.warned = true;
    }
  }

  async provisionModuleKey(
    moduleId: string,
    keyPurpose: KeyPurpose,
    keyType: KeyType
  ): Promise<KeyHandle> {
    this.warnOnce();
    const handle: KeyHandle = {
      handleId: `noop-key-${moduleId}-${Date.now()}`,
      moduleId,
      keyPurpose,
      keyType,
      createdAt: Date.now(),
      metadata: { provider: 'noop-key-management' },
    };
    const existing = this.handles.get(moduleId) ?? [];
    existing.push(handle);
    this.handles.set(moduleId, existing);
    return handle;
  }

  async revokeModuleKey(keyHandle: KeyHandle): Promise<void> {
    const existing = this.handles.get(keyHandle.moduleId) ?? [];
    this.handles.set(
      keyHandle.moduleId,
      existing.filter((item) => item.handleId !== keyHandle.handleId)
    );
  }

  async rotateModuleKey(keyHandle: KeyHandle): Promise<KeyHandle> {
    await this.revokeModuleKey(keyHandle);
    return this.provisionModuleKey(keyHandle.moduleId, keyHandle.keyPurpose, keyHandle.keyType);
  }

  async encrypt(keyHandle: KeyHandle, plaintext: Uint8Array): Promise<Uint8Array> {
    void keyHandle;
    return plaintext;
  }

  async decrypt(keyHandle: KeyHandle, ciphertext: Uint8Array): Promise<Uint8Array> {
    void keyHandle;
    return ciphertext;
  }

  async getModuleKeys(moduleId: string): Promise<KeyHandle[]> {
    return [...(this.handles.get(moduleId) ?? [])];
  }

  isAvailable(): boolean {
    return false;
  }

  async close(): Promise<void> {
    return;
  }
}

/**
 * No-operation storage encryption provider for fallback mode.
 */
export class NoopStorageEncryptionProvider implements StorageEncryptionProvider {
  private warned = false;
  private readonly volumes = new Map<string, EncryptedVolume>();

  private warnOnce(): void {
    if (!this.warned) {
      console.warn('[Encryption] No storage encryption provider installed. Using no-op fallback.');
      this.warned = true;
    }
  }

  async provisionEncryptedDirectory(moduleId: string, path: string): Promise<EncryptedVolume> {
    this.warnOnce();
    const volume: EncryptedVolume = {
      volumeId: `noop-volume-${moduleId}-${Date.now()}`,
      moduleId,
      path,
      encryptionMethod: 'noop',
      locked: false,
      createdAt: Date.now(),
      metadata: { provider: 'noop-storage-encryption' },
    };
    this.volumes.set(volume.volumeId, volume);
    return volume;
  }

  async lockDirectory(volume: EncryptedVolume): Promise<void> {
    volume.locked = true;
  }

  async unlockDirectory(volume: EncryptedVolume, keyHandle: KeyHandle): Promise<void> {
    void keyHandle;
    volume.locked = false;
  }

  async destroyDirectory(volume: EncryptedVolume): Promise<void> {
    this.volumes.delete(volume.volumeId);
  }

  isLocked(volume: EncryptedVolume): boolean {
    return volume.locked;
  }

  isAvailable(): boolean {
    return false;
  }

  async close(): Promise<void> {
    return;
  }
}

/**
 * PeerMesh Foundation - Identity Interface
 *
 * This file defines the TypeScript interface for the identity system.
 * The foundation core includes only this interface - actual implementations
 * are provided by add-on modules (e.g., identity-spiffe, identity-jwt).
 *
 * Module identity credentials enable zero-trust inter-module communication
 * by providing verifiable identity assertions.
 *
 * @module foundation/interfaces/identity
 * @version 1.0.0
 */

/**
 * CredentialType enumerates the types of identity credentials.
 */
export type CredentialType = 'x509-svid' | 'jwt-svid' | 'bearer-token';

/**
 * ModuleCredential represents a verifiable identity credential for a module.
 *
 * The credential is issued by an identity provider and contains everything
 * needed to prove the module's identity to other modules or services.
 */
export interface ModuleCredential {
  /** Unique identifier for this credential */
  credentialId: string;

  /** Module ID this credential belongs to */
  moduleId: string;

  /** Type of credential (x509, jwt, bearer token) */
  credentialType: CredentialType;

  /** Unix timestamp (milliseconds) when credential was issued */
  issuedAt: number;

  /** Unix timestamp (milliseconds) when credential expires */
  expiresAt: number;

  /** Trust domain this credential belongs to (e.g., "peermesh.local") */
  trustDomain: string;

  /** Opaque credential bytes (format depends on credentialType) */
  rawCredential: Uint8Array;

  /** Additional provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * VerificationResult contains the outcome of credential verification.
 */
export interface VerificationResult {
  /** Whether the credential passed verification */
  valid: boolean;

  /** Verified module ID from the credential */
  moduleId: string;

  /** Trust domain the credential belongs to */
  trustDomain: string;

  /** Unix timestamp (milliseconds) when credential expires */
  expiry: number;

  /** List of error messages if verification failed */
  errors?: string[];

  /** Additional verification details */
  metadata?: Record<string, unknown>;
}

/**
 * IdentityProvider is the core interface for module identity management.
 *
 * This interface defines how modules receive and verify identity credentials.
 * The foundation core provides a no-op implementation; actual implementations
 * are provided by add-on modules.
 *
 * @example
 * ```typescript
 * // Issue a credential for a module
 * const credential = await identityProvider.issueCredential(
 *   'backup-module',
 *   { platform: 'docker', version: '1.0.0' }
 * );
 *
 * // Verify a credential
 * const result = await identityProvider.verifyCredential(credential);
 * if (result.valid) {
 *   console.log(`Verified module: ${result.moduleId}`);
 * }
 * ```
 */
export interface IdentityProvider {
  /**
   * Issue a new identity credential for a module.
   *
   * Called during module provisioning to provide the module with its identity.
   *
   * @param moduleId - Unique module identifier
   * @param attestationContext - Platform attestation data (optional)
   * @returns Promise resolving to the issued credential
   * @throws {ProvisioningError} If credential issuance fails
   */
  issueCredential(
    moduleId: string,
    attestationContext?: Record<string, unknown>
  ): Promise<ModuleCredential>;

  /**
   * Verify the authenticity and validity of a module credential.
   *
   * Checks cryptographic signatures, expiration, revocation status,
   * and trust domain membership.
   *
   * @param credential - The credential to verify
   * @returns Promise resolving to verification result
   */
  verifyCredential(credential: ModuleCredential): Promise<VerificationResult>;

  /**
   * Revoke a previously issued credential.
   *
   * Called during module deprovisioning or when a credential is compromised.
   *
   * @param credentialId - ID of credential to revoke
   * @throws {RevocationError} If revocation fails
   */
  revokeCredential(credentialId: string): Promise<void>;

  /**
   * Issue a new credential for a module, replacing the old one.
   *
   * Called periodically or before expiry to renew module identity.
   *
   * @param moduleId - Module ID to rotate credentials for
   * @returns Promise resolving to new credential
   * @throws {RotationError} If rotation fails
   */
  rotateCredentials(moduleId: string): Promise<ModuleCredential>;

  /**
   * Get the trust domain for this identity provider.
   *
   * @returns Trust domain identifier (e.g., "peermesh.local")
   */
  getTrustDomain(): string;

  /**
   * Check if the identity provider is operational.
   *
   * @returns True if the provider can issue and verify credentials
   */
  isAvailable(): boolean;

  /**
   * Gracefully close the identity provider connection.
   */
  close(): Promise<void>;
}

/**
 * Standard identity event types defined by the foundation.
 */
export const FOUNDATION_IDENTITY_EVENT_TYPES = {
  CREDENTIAL_ISSUED: 'foundation.identity.credential-issued',
  CREDENTIAL_REVOKED: 'foundation.identity.credential-revoked',
  CREDENTIAL_ROTATED: 'foundation.identity.credential-rotated',
  CREDENTIAL_VERIFICATION_FAILED: 'foundation.identity.credential-verification-failed',
  PROVIDER_AVAILABLE: 'foundation.identity.provider-available',
  PROVIDER_UNAVAILABLE: 'foundation.identity.provider-unavailable',
} as const;

/**
 * Payload types for standard identity events.
 */
export interface CredentialIssuedPayload {
  moduleId: string;
  credentialId: string;
  credentialType: CredentialType;
  expiresAt: number;
  trustDomain: string;
}

export interface CredentialRevokedPayload {
  credentialId: string;
  moduleId: string;
  reason?: string;
}

export interface CredentialRotatedPayload {
  moduleId: string;
  oldCredentialId: string;
  newCredentialId: string;
  newExpiresAt: number;
}

export interface CredentialVerificationFailedPayload {
  credentialId: string;
  moduleId?: string;
  errors?: string[];
  sourceModule?: string;
}

export interface ProviderStatusPayload {
  providerName: string;
  trustDomain: string;
  message?: string;
}

/**
 * No-operation identity provider used when no identity module is installed.
 */
export class NoopIdentityProvider implements IdentityProvider {
  private readonly trustDomain: string;
  private warned = false;
  private counter = 0;
  private readonly revoked = new Set<string>();

  constructor(trustDomain = 'noop.local') {
    this.trustDomain = trustDomain;
  }

  private warnOnce(): void {
    if (!this.warned) {
      console.warn('[Identity] No identity provider installed. Using no-op fallback.');
      this.warned = true;
    }
  }

  private nowMs(): number {
    return Date.now();
  }

  async issueCredential(
    moduleId: string,
    attestationContext?: Record<string, unknown>
  ): Promise<ModuleCredential> {
    void attestationContext;
    this.warnOnce();
    this.counter += 1;
    const credentialId = `noop-${moduleId}-${this.counter}`;
    return {
      credentialId,
      moduleId,
      credentialType: 'bearer-token',
      issuedAt: this.nowMs(),
      expiresAt: this.nowMs() + 60 * 60 * 1000,
      trustDomain: this.trustDomain,
      rawCredential: new TextEncoder().encode(`noop:${moduleId}:${this.counter}`),
      metadata: { provider: 'noop-identity' },
    };
  }

  async verifyCredential(credential: ModuleCredential): Promise<VerificationResult> {
    if (this.revoked.has(credential.credentialId)) {
      return {
        valid: false,
        moduleId: credential.moduleId,
        trustDomain: credential.trustDomain,
        expiry: credential.expiresAt,
        errors: ['credential revoked'],
        metadata: { provider: 'noop-identity' },
      };
    }
    const expired = credential.expiresAt < this.nowMs();
    return {
      valid: !expired,
      moduleId: credential.moduleId,
      trustDomain: credential.trustDomain,
      expiry: credential.expiresAt,
      errors: expired ? ['credential expired'] : [],
      metadata: { provider: 'noop-identity' },
    };
  }

  async revokeCredential(credentialId: string): Promise<void> {
    this.revoked.add(credentialId);
  }

  async rotateCredentials(moduleId: string): Promise<ModuleCredential> {
    return this.issueCredential(moduleId);
  }

  getTrustDomain(): string {
    return this.trustDomain;
  }

  isAvailable(): boolean {
    return false;
  }

  async close(): Promise<void> {
    return;
  }
}

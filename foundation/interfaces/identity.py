"""
PeerMesh Foundation - Identity Interface

This file defines the Python protocol (interface) for the identity system.
The foundation core includes only this interface - actual implementations
are provided by add-on modules (e.g., identity-spiffe, identity-jwt).

Module identity credentials enable zero-trust inter-module communication
by providing verifiable identity assertions. Every module receives a credential
during provisioning and uses it to authenticate to other modules.

Usage:
    from foundation.interfaces.identity import IdentityProvider, ModuleCredential

Example:
    # Issue a credential for a module
    credential = await identity_provider.issue_credential(
        module_id='backup-module',
        attestation_context={'platform': 'docker', 'version': '1.0.0'}
    )

    # Verify a credential
    result = await identity_provider.verify_credential(credential)
    if result.valid:
        print(f"Verified module: {result.module_id}")

    # Rotate credentials before expiry
    new_credential = await identity_provider.rotate_credentials('backup-module')
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol
from datetime import datetime


class CredentialType(str, Enum):
    """Types of identity credentials supported by the system."""
    X509_SVID = 'x509-svid'  # X.509 SPIFFE Verifiable Identity Document
    JWT_SVID = 'jwt-svid'    # JWT SPIFFE Verifiable Identity Document
    BEARER_TOKEN = 'bearer-token'  # Simple bearer token (least secure)


@dataclass
class ModuleCredential:
    """
    ModuleCredential represents a verifiable identity credential for a module.

    The credential is issued by an identity provider and contains everything
    needed to prove the module's identity to other modules or services.

    Attributes:
        credential_id: Unique identifier for this credential
        module_id: Module ID this credential belongs to
        credential_type: Type of credential (x509, jwt, bearer token)
        issued_at: Unix timestamp (milliseconds) when credential was issued
        expires_at: Unix timestamp (milliseconds) when credential expires
        trust_domain: Trust domain this credential belongs to (e.g., "peermesh.local")
        raw_credential: Opaque credential bytes (format depends on credential_type)
        metadata: Additional provider-specific metadata
    """
    credential_id: str
    module_id: str
    credential_type: CredentialType
    issued_at: int
    expires_at: int
    trust_domain: str
    raw_credential: bytes
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class VerificationResult:
    """
    VerificationResult contains the outcome of credential verification.

    Attributes:
        valid: Whether the credential passed verification
        module_id: Verified module ID from the credential
        trust_domain: Trust domain the credential belongs to
        expiry: Unix timestamp (milliseconds) when credential expires
        errors: List of error messages if verification failed
        metadata: Additional verification details
    """
    valid: bool
    module_id: str
    trust_domain: str
    expiry: int
    errors: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class IdentityProvider(Protocol):
    """
    IdentityProvider is the core protocol for module identity management.

    This interface defines how modules receive and verify identity credentials.
    The foundation core provides a no-op implementation; actual implementations
    are provided by add-on modules (e.g., identity-spiffe for SPIFFE/SPIRE).

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def issue_credential(
        self,
        module_id: str,
        attestation_context: Optional[Dict[str, Any]] = None,
    ) -> ModuleCredential:
        """
        Issue a new identity credential for a module.

        Called during module provisioning to provide the module with its identity.
        The attestation context contains platform/environment information used
        to bind the credential to the specific module instance.

        Args:
            module_id: Unique module identifier
            attestation_context: Platform attestation data (optional)

        Returns:
            ModuleCredential containing the issued identity

        Raises:
            ProvisioningError: If credential issuance fails
        """
        ...

    async def verify_credential(
        self,
        credential: ModuleCredential,
    ) -> VerificationResult:
        """
        Verify the authenticity and validity of a module credential.

        Checks cryptographic signatures, expiration, revocation status,
        and trust domain membership.

        Args:
            credential: The credential to verify

        Returns:
            VerificationResult with validation outcome
        """
        ...

    async def revoke_credential(
        self,
        credential_id: str,
    ) -> None:
        """
        Revoke a previously issued credential.

        Called during module deprovisioning or when a credential is compromised.
        After revocation, the credential will fail verification.

        Args:
            credential_id: ID of credential to revoke

        Raises:
            RevocationError: If revocation fails
        """
        ...

    async def rotate_credentials(
        self,
        module_id: str,
    ) -> ModuleCredential:
        """
        Issue a new credential for a module, replacing the old one.

        Called periodically or before expiry to renew module identity.
        The old credential may remain valid for a grace period.

        Args:
            module_id: Module ID to rotate credentials for

        Returns:
            New ModuleCredential

        Raises:
            RotationError: If rotation fails
        """
        ...

    def get_trust_domain(self) -> str:
        """
        Get the trust domain for this identity provider.

        The trust domain is a logical boundary for identities (e.g., "peermesh.local").
        All credentials issued by this provider belong to the same trust domain.

        Returns:
            Trust domain identifier
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the identity provider is operational.

        Returns:
            True if the provider can issue and verify credentials
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the identity provider connection.
        """
        ...


# Standard event types defined by the foundation
class FoundationIdentityEventTypes:
    """Standard identity-related event types defined by the foundation core."""
    CREDENTIAL_ISSUED = 'foundation.identity.credential-issued'
    CREDENTIAL_REVOKED = 'foundation.identity.credential-revoked'
    CREDENTIAL_ROTATED = 'foundation.identity.credential-rotated'
    CREDENTIAL_VERIFICATION_FAILED = 'foundation.identity.credential-verification-failed'
    PROVIDER_AVAILABLE = 'foundation.identity.provider-available'
    PROVIDER_UNAVAILABLE = 'foundation.identity.provider-unavailable'


# Payload dataclasses for standard identity events
@dataclass
class CredentialIssuedPayload:
    """Payload for identity.credential-issued events."""
    module_id: str
    credential_id: str
    credential_type: CredentialType
    expires_at: int
    trust_domain: str


@dataclass
class CredentialRevokedPayload:
    """Payload for identity.credential-revoked events."""
    credential_id: str
    module_id: str
    reason: Optional[str] = None


@dataclass
class CredentialRotatedPayload:
    """Payload for identity.credential-rotated events."""
    module_id: str
    old_credential_id: str
    new_credential_id: str
    new_expires_at: int


@dataclass
class CredentialVerificationFailedPayload:
    """Payload for identity.credential-verification-failed events."""
    credential_id: str
    module_id: Optional[str] = None
    errors: List[str] = field(default_factory=list)
    source_module: Optional[str] = None


@dataclass
class ProviderStatusPayload:
    """Payload for identity.provider-available/unavailable events."""
    provider_name: str
    trust_domain: str
    message: Optional[str] = None


class NoopIdentityProvider:
    """
    No-operation identity provider used when no identity module is installed.

    Behavior:
    - Issues deterministic placeholder bearer credentials.
    - Verifies credentials structurally only.
    - Always reports unavailable for capability checks so callers can distinguish
      fallback behavior from a real provider.
    """

    def __init__(self, trust_domain: str = "noop.local") -> None:
        self._trust_domain = trust_domain
        self._warned = False
        self._revoked: set[str] = set()
        self._counter = 0

    def _warn_once(self) -> None:
        if not self._warned:
            import warnings
            warnings.warn(
                "[Identity] No identity provider installed. Using no-op fallback.",
                stacklevel=3,
            )
            self._warned = True

    def _now_ms(self) -> int:
        return int(datetime.utcnow().timestamp() * 1000)

    async def issue_credential(
        self,
        module_id: str,
        attestation_context: Optional[Dict[str, Any]] = None,
    ) -> ModuleCredential:
        self._warn_once()
        del attestation_context
        self._counter += 1
        now = self._now_ms()
        return ModuleCredential(
            credential_id=f"noop-{module_id}-{self._counter}",
            module_id=module_id,
            credential_type=CredentialType.BEARER_TOKEN,
            issued_at=now,
            expires_at=now + (60 * 60 * 1000),
            trust_domain=self._trust_domain,
            raw_credential=f"noop:{module_id}:{self._counter}".encode("utf-8"),
            metadata={"provider": "noop-identity"},
        )

    async def verify_credential(
        self,
        credential: ModuleCredential,
    ) -> VerificationResult:
        if credential.credential_id in self._revoked:
            return VerificationResult(
                valid=False,
                module_id=credential.module_id,
                trust_domain=credential.trust_domain,
                expiry=credential.expires_at,
                errors=["credential revoked"],
                metadata={"provider": "noop-identity"},
            )
        expired = credential.expires_at < self._now_ms()
        return VerificationResult(
            valid=not expired,
            module_id=credential.module_id,
            trust_domain=credential.trust_domain,
            expiry=credential.expires_at,
            errors=(["credential expired"] if expired else []),
            metadata={"provider": "noop-identity"},
        )

    async def revoke_credential(self, credential_id: str) -> None:
        self._revoked.add(credential_id)

    async def rotate_credentials(self, module_id: str) -> ModuleCredential:
        return await self.issue_credential(module_id)

    def get_trust_domain(self) -> str:
        return self._trust_domain

    def is_available(self) -> bool:
        return False

    async def close(self) -> None:
        return None

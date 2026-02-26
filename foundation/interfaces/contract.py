"""
PeerMesh Foundation - Contract Interface

This file defines the Python protocol (interface) for the capability contract system.
The foundation core includes only this interface - actual implementations
are provided by add-on modules (e.g., contract-opa for policy evaluation,
contract-enforcer-nftables for network enforcement).

Contracts enable capability-based security: modules declare what they need,
policy evaluators approve or deny those requests, and enforcers implement
the decisions at the network/filesystem/process level.

Usage:
    from foundation.interfaces.contract import ContractEvaluator, ContractEnforcer

Example:
    # Evaluate a module's contract request
    decision = await evaluator.evaluate(
        module_id='backup-module',
        contract_manifest=module_contract
    )

    # Enforce the decision
    if decision.approved:
        result = await enforcer.enforce(decision)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol
from time import time


class NetworkAccessLevel(str, Enum):
    """Level of network access a module requests."""
    NONE = 'none'                    # No network access
    SPECIFIC_ENDPOINTS = 'specific'  # Only listed endpoints
    SPECIFIC_PORTS = 'ports'        # Only listed ports
    UNRESTRICTED = 'unrestricted'   # Full network access


class Direction(str, Enum):
    """Direction of communication flow."""
    INBOUND = 'inbound'
    OUTBOUND = 'outbound'
    BIDIRECTIONAL = 'bidirectional'


class ValidationMode(str, Enum):
    """How strictly to validate data at gates."""
    STRICT = 'strict'        # Reject invalid data
    PERMISSIVE = 'permissive'  # Accept but log warnings
    AUDIT_ONLY = 'audit-only'  # Accept all, log for analysis


class FilesystemAccessLevel(str, Enum):
    """Level of filesystem access a module requests."""
    OWN_DIRECTORY_ONLY = 'own-directory-only'
    READ_SHARED = 'read-shared'
    WRITE_SHARED = 'write-shared'


@dataclass
class RateLimit:
    """Rate limit configuration."""
    max_per_second: Optional[int] = None
    max_per_minute: Optional[int] = None
    burst: Optional[int] = None


@dataclass
class NetworkPolicy:
    """
    NetworkPolicy defines what network access a module requests.

    Attributes:
        level: Level of network access requested
        allowed_endpoints: Specific endpoints allowed (e.g., ["api.example.com:443"])
        allowed_ports: Specific ports allowed (e.g., [80, 443])
    """
    level: NetworkAccessLevel
    allowed_endpoints: List[str] = field(default_factory=list)
    allowed_ports: List[int] = field(default_factory=list)


@dataclass
class ModuleCommunicationPolicy:
    """
    ModuleCommunicationPolicy defines inter-module communication requirements.

    Attributes:
        target_module_id: Module this policy applies to
        direction: Direction of communication
        data_types: List of data type schema references
        rate_limit: Optional rate limiting
    """
    target_module_id: str
    direction: Direction
    data_types: List[str] = field(default_factory=list)
    rate_limit: Optional[RateLimit] = None


@dataclass
class HardwareAccessPolicy:
    """
    HardwareAccessPolicy defines what hardware a module can access.

    Attributes:
        device_type: Type of hardware (e.g., 'tpm', 'gpu', 'usb')
        device_path: Specific device path (optional)
        capabilities: List of capability strings
    """
    device_type: str
    device_path: Optional[str] = None
    capabilities: List[str] = field(default_factory=list)


@dataclass
class FilesystemPolicy:
    """
    FilesystemPolicy defines filesystem access scope.

    Attributes:
        access_level: Scope of filesystem access
        additional_paths: Paths outside module directory (if access_level permits)
        read_only_paths: Paths that can only be read
    """
    access_level: FilesystemAccessLevel
    additional_paths: List[str] = field(default_factory=list)
    read_only_paths: List[str] = field(default_factory=list)


@dataclass
class DataGatePolicy:
    """
    DataGatePolicy defines validation for data crossing module boundaries.

    Attributes:
        gate_id: Unique identifier for this data gate
        direction: Direction of data flow
        data_type_schema: Schema reference for validation (JSON Schema or protobuf)
        rate_limit: Optional rate limiting
        validation_mode: How strictly to validate
    """
    gate_id: str
    direction: Direction
    data_type_schema: str
    rate_limit: Optional[RateLimit] = None
    validation_mode: ValidationMode = ValidationMode.STRICT


@dataclass
class ContractManifest:
    """
    ContractManifest is the complete capability contract declaration for a module.

    This is what modules declare in their module.json security.contract section.

    Attributes:
        module_id: Module making the request
        version: Manifest version
        network_access: Network access policy
        module_communications: Inter-module communication policies
        hardware_access: Hardware access policies
        filesystem_access: Filesystem access policy
        data_gates: Data validation gates
    """
    module_id: str
    version: str
    network_access: NetworkPolicy
    module_communications: List[ModuleCommunicationPolicy] = field(default_factory=list)
    hardware_access: List[HardwareAccessPolicy] = field(default_factory=list)
    filesystem_access: FilesystemPolicy = field(
        default_factory=lambda: FilesystemPolicy(
            access_level=FilesystemAccessLevel.OWN_DIRECTORY_ONLY
        )
    )
    data_gates: List[DataGatePolicy] = field(default_factory=list)


@dataclass
class ContractDecision:
    """
    ContractDecision is the outcome of evaluating a contract request.

    Attributes:
        approved: Whether the contract was approved
        contract_id: Unique ID for this contract (if approved)
        module_id: Module this decision applies to
        granted_capabilities: List of capabilities granted
        denied_capabilities: List of capabilities denied
        requires_user_approval: Whether user must approve this contract
        reason: Human-readable reason for the decision
        metadata: Additional decision metadata
    """
    approved: bool
    contract_id: str
    module_id: str
    granted_capabilities: List[str] = field(default_factory=list)
    denied_capabilities: List[str] = field(default_factory=list)
    requires_user_approval: bool = False
    reason: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActiveContract:
    """
    ActiveContract represents a contract currently in effect.

    Attributes:
        contract_id: Unique contract identifier
        module_id: Module this contract applies to
        manifest: The contract manifest
        decision: The evaluation decision
        created_at: Unix timestamp (milliseconds) when contract was created
        last_updated: Unix timestamp (milliseconds) of last update
    """
    contract_id: str
    module_id: str
    manifest: ContractManifest
    decision: ContractDecision
    created_at: int
    last_updated: int


@dataclass
class EnforcementResult:
    """
    EnforcementResult is the outcome of enforcing a contract decision.

    Attributes:
        success: Whether enforcement was successful
        contract_id: Contract being enforced
        module_id: Module the enforcement applies to
        enforcement_points: List of enforcement mechanisms activated
        errors: List of errors if enforcement failed
        metadata: Additional enforcement metadata
    """
    success: bool
    contract_id: str
    module_id: str
    enforcement_points: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EnforcementStatus:
    """
    EnforcementStatus describes the current enforcement state for a module.

    Attributes:
        module_id: Module this status applies to
        active_contract_id: Currently active contract ID
        enforcement_active: Whether enforcement is currently active
        enforcement_points: Active enforcement mechanisms
        violations: Recent violations detected
        last_updated: Unix timestamp (milliseconds) of last status update
    """
    module_id: str
    active_contract_id: Optional[str]
    enforcement_active: bool
    enforcement_points: List[str] = field(default_factory=list)
    violations: List[str] = field(default_factory=list)
    last_updated: int = 0


class ContractEvaluator(Protocol):
    """
    ContractEvaluator defines the interface for evaluating capability contracts.

    Evaluators determine whether a module's requested capabilities should be
    granted based on policy. The foundation core provides a no-op implementation;
    actual implementations are provided by add-on modules (e.g., contract-opa).

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def evaluate(
        self,
        module_id: str,
        contract_manifest: ContractManifest,
    ) -> ContractDecision:
        """
        Evaluate a module's contract manifest against policy.

        Args:
            module_id: Module requesting capabilities
            contract_manifest: The contract to evaluate

        Returns:
            ContractDecision with approval/denial and granted capabilities

        Raises:
            EvaluationError: If evaluation fails
        """
        ...

    async def get_active_contracts(
        self,
        module_id: str,
    ) -> List[ActiveContract]:
        """
        Get all active contracts for a module.

        Args:
            module_id: Module to query contracts for

        Returns:
            List of active contracts
        """
        ...

    async def revoke_contract(
        self,
        contract_id: str,
    ) -> None:
        """
        Revoke an active contract.

        Args:
            contract_id: Contract to revoke

        Raises:
            RevocationError: If revocation fails
        """
        ...

    async def update_policy(
        self,
        policy_bundle: Dict[str, Any],
    ) -> None:
        """
        Update the policy used for contract evaluation.

        Args:
            policy_bundle: New policy bundle

        Raises:
            PolicyUpdateError: If policy update fails
        """
        ...

    def get_policy_version(self) -> str:
        """
        Get the current policy version.

        Returns:
            Policy version identifier
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the contract evaluator is operational.

        Returns:
            True if the evaluator can evaluate contracts
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the contract evaluator connection.
        """
        ...


class ContractEnforcer(Protocol):
    """
    ContractEnforcer defines the interface for enforcing contract decisions.

    Enforcers implement approved capabilities at the network, filesystem,
    and process level using technologies like nftables, eBPF, Landlock, etc.

    This is a Protocol class - it defines the interface that implementations must follow.
    Use this for type hints; do not instantiate directly.
    """

    async def enforce(
        self,
        contract_decision: ContractDecision,
    ) -> EnforcementResult:
        """
        Enforce a contract decision.

        Sets up network rules, filesystem restrictions, etc. based on
        the granted capabilities.

        Args:
            contract_decision: Decision to enforce

        Returns:
            EnforcementResult indicating success/failure

        Raises:
            EnforcementError: If enforcement fails
        """
        ...

    async def update_enforcement(
        self,
        contract_id: str,
        changes: Dict[str, Any],
    ) -> EnforcementResult:
        """
        Update enforcement for an existing contract.

        Args:
            contract_id: Contract to update
            changes: Changes to apply

        Returns:
            EnforcementResult

        Raises:
            EnforcementError: If update fails
        """
        ...

    async def tear_down(
        self,
        contract_id: str,
    ) -> None:
        """
        Remove enforcement for a contract.

        Called when a contract is revoked or module is stopped.

        Args:
            contract_id: Contract to tear down

        Raises:
            TeardownError: If teardown fails
        """
        ...

    async def get_enforcement_status(
        self,
        module_id: str,
    ) -> EnforcementStatus:
        """
        Get the current enforcement status for a module.

        Args:
            module_id: Module to query

        Returns:
            EnforcementStatus
        """
        ...

    def is_available(self) -> bool:
        """
        Check if the contract enforcer is operational.

        Returns:
            True if the enforcer can enforce contracts
        """
        ...

    async def close(self) -> None:
        """
        Gracefully close the contract enforcer connection.
        """
        ...


# Standard event types defined by the foundation
class FoundationContractEventTypes:
    """Standard contract-related event types defined by the foundation core."""
    EVALUATED = 'foundation.contract.evaluated'
    APPROVED = 'foundation.contract.approved'
    DENIED = 'foundation.contract.denied'
    REVOKED = 'foundation.contract.revoked'
    VIOLATION_DETECTED = 'foundation.contract.violation-detected'
    ENFORCEMENT_UPDATED = 'foundation.contract.enforcement-updated'
    ENFORCEMENT_FAILED = 'foundation.contract.enforcement-failed'


# Payload dataclasses for standard contract events
@dataclass
class ContractEvaluatedPayload:
    """Payload for contract.evaluated events."""
    module_id: str
    contract_id: str
    approved: bool
    granted_capabilities: List[str] = field(default_factory=list)
    denied_capabilities: List[str] = field(default_factory=list)


@dataclass
class ContractApprovedPayload:
    """Payload for contract.approved events."""
    module_id: str
    contract_id: str
    granted_capabilities: List[str] = field(default_factory=list)


@dataclass
class ContractDeniedPayload:
    """Payload for contract.denied events."""
    module_id: str
    reason: str
    denied_capabilities: List[str] = field(default_factory=list)


@dataclass
class ContractRevokedPayload:
    """Payload for contract.revoked events."""
    contract_id: str
    module_id: str
    reason: Optional[str] = None


@dataclass
class ContractViolationPayload:
    """Payload for contract.violation-detected events."""
    contract_id: str
    module_id: str
    violation_type: str
    description: str
    timestamp: int


@dataclass
class EnforcementUpdatedPayload:
    """Payload for contract.enforcement-updated events."""
    contract_id: str
    module_id: str
    enforcement_points: List[str] = field(default_factory=list)


@dataclass
class EnforcementFailedPayload:
    """Payload for contract.enforcement-failed events."""
    contract_id: str
    module_id: str
    errors: List[str] = field(default_factory=list)


class NoopContractEvaluator:
    """
    No-operation contract evaluator for fallback mode.

    The evaluator approves requests in warn-mode style with a noop contract ID.
    """

    def __init__(self) -> None:
        self._warned = False
        self._contracts: Dict[str, List[ActiveContract]] = {}
        self._policy_version = "noop-v1"

    def _warn_once(self) -> None:
        if not self._warned:
            import warnings
            warnings.warn(
                "[Contract] No policy evaluator installed. Using no-op fallback.",
                stacklevel=3,
            )
            self._warned = True

    def _now_ms(self) -> int:
        return int(time() * 1000)

    async def evaluate(self, module_id: str, contract_manifest: ContractManifest) -> ContractDecision:
        self._warn_once()
        contract_id = f"noop-contract-{module_id}-{self._now_ms()}"
        decision = ContractDecision(
            approved=True,
            contract_id=contract_id,
            module_id=module_id,
            granted_capabilities=["noop-default"],
            denied_capabilities=[],
            requires_user_approval=False,
            reason="No-op evaluator approved contract (warn mode).",
            metadata={"provider": "noop-contract-evaluator"},
        )
        active = ActiveContract(
            contract_id=contract_id,
            module_id=module_id,
            manifest=contract_manifest,
            decision=decision,
            created_at=self._now_ms(),
            last_updated=self._now_ms(),
        )
        self._contracts.setdefault(module_id, []).append(active)
        return decision

    async def get_active_contracts(self, module_id: str) -> List[ActiveContract]:
        return list(self._contracts.get(module_id, []))

    async def revoke_contract(self, contract_id: str) -> None:
        for module_id, contracts in self._contracts.items():
            self._contracts[module_id] = [c for c in contracts if c.contract_id != contract_id]

    async def update_policy(self, policy_bundle: Dict[str, Any]) -> None:
        self._policy_version = str(policy_bundle.get("version", "noop-v1"))

    def get_policy_version(self) -> str:
        return self._policy_version

    def is_available(self) -> bool:
        return False

    async def close(self) -> None:
        return None


class NoopContractEnforcer:
    """
    No-operation contract enforcer for fallback mode.
    """

    def __init__(self) -> None:
        self._statuses: Dict[str, EnforcementStatus] = {}

    def _now_ms(self) -> int:
        return int(time() * 1000)

    async def enforce(self, contract_decision: ContractDecision) -> EnforcementResult:
        status = EnforcementStatus(
            module_id=contract_decision.module_id,
            active_contract_id=contract_decision.contract_id,
            enforcement_active=False,
            enforcement_points=["noop"],
            violations=[],
            last_updated=self._now_ms(),
        )
        self._statuses[contract_decision.module_id] = status
        return EnforcementResult(
            success=True,
            contract_id=contract_decision.contract_id,
            module_id=contract_decision.module_id,
            enforcement_points=["noop"],
            errors=[],
            metadata={"provider": "noop-contract-enforcer"},
        )

    async def update_enforcement(self, contract_id: str, changes: Dict[str, Any]) -> EnforcementResult:
        del changes
        module_id = next(
            (m for m, s in self._statuses.items() if s.active_contract_id == contract_id),
            "unknown-module",
        )
        return EnforcementResult(
            success=True,
            contract_id=contract_id,
            module_id=module_id,
            enforcement_points=["noop"],
            errors=[],
            metadata={"provider": "noop-contract-enforcer"},
        )

    async def tear_down(self, contract_id: str) -> None:
        for module_id, status in list(self._statuses.items()):
            if status.active_contract_id == contract_id:
                self._statuses[module_id] = EnforcementStatus(
                    module_id=module_id,
                    active_contract_id=None,
                    enforcement_active=False,
                    enforcement_points=[],
                    violations=[],
                    last_updated=self._now_ms(),
                )

    async def get_enforcement_status(self, module_id: str) -> EnforcementStatus:
        return self._statuses.get(
            module_id,
            EnforcementStatus(
                module_id=module_id,
                active_contract_id=None,
                enforcement_active=False,
                enforcement_points=[],
                violations=[],
                last_updated=self._now_ms(),
            ),
        )

    def is_available(self) -> bool:
        return False

    async def close(self) -> None:
        return None

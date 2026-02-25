/**
 * PeerMesh Foundation - Contract Interface
 *
 * This file defines the TypeScript interface for the capability contract system.
 * The foundation core includes only this interface - actual implementations
 * are provided by add-on modules (e.g., contract-opa for policy evaluation,
 * contract-enforcer-nftables for network enforcement).
 *
 * Contracts enable capability-based security: modules declare what they need,
 * policy evaluators approve or deny those requests, and enforcers implement
 * the decisions at the network/filesystem/process level.
 *
 * @module foundation/interfaces/contract
 * @version 1.0.0
 */

/**
 * NetworkAccessLevel enumerates levels of network access.
 */
export type NetworkAccessLevel = 'none' | 'specific' | 'ports' | 'unrestricted';

/**
 * Direction enumerates communication flow directions.
 */
export type Direction = 'inbound' | 'outbound' | 'bidirectional';

/**
 * ValidationMode enumerates data validation strictness levels.
 */
export type ValidationMode = 'strict' | 'permissive' | 'audit-only';

/**
 * FilesystemAccessLevel enumerates levels of filesystem access.
 */
export type FilesystemAccessLevel = 'own-directory-only' | 'read-shared' | 'write-shared';

/**
 * RateLimit configuration for throttling.
 */
export interface RateLimit {
  maxPerSecond?: number;
  maxPerMinute?: number;
  burst?: number;
}

/**
 * NetworkPolicy defines what network access a module requests.
 */
export interface NetworkPolicy {
  /** Level of network access requested */
  level: NetworkAccessLevel;

  /** Specific endpoints allowed (e.g., ["api.example.com:443"]) */
  allowedEndpoints?: string[];

  /** Specific ports allowed (e.g., [80, 443]) */
  allowedPorts?: number[];
}

/**
 * ModuleCommunicationPolicy defines inter-module communication requirements.
 */
export interface ModuleCommunicationPolicy {
  /** Module this policy applies to */
  targetModuleId: string;

  /** Direction of communication */
  direction: Direction;

  /** List of data type schema references */
  dataTypes?: string[];

  /** Optional rate limiting */
  rateLimit?: RateLimit;
}

/**
 * HardwareAccessPolicy defines what hardware a module can access.
 */
export interface HardwareAccessPolicy {
  /** Type of hardware (e.g., 'tpm', 'gpu', 'usb') */
  deviceType: string;

  /** Specific device path (optional) */
  devicePath?: string;

  /** List of capability strings */
  capabilities?: string[];
}

/**
 * FilesystemPolicy defines filesystem access scope.
 */
export interface FilesystemPolicy {
  /** Scope of filesystem access */
  accessLevel: FilesystemAccessLevel;

  /** Paths outside module directory (if access_level permits) */
  additionalPaths?: string[];

  /** Paths that can only be read */
  readOnlyPaths?: string[];
}

/**
 * DataGatePolicy defines validation for data crossing module boundaries.
 */
export interface DataGatePolicy {
  /** Unique identifier for this data gate */
  gateId: string;

  /** Direction of data flow */
  direction: Direction;

  /** Schema reference for validation (JSON Schema or protobuf) */
  dataTypeSchema: string;

  /** Optional rate limiting */
  rateLimit?: RateLimit;

  /** How strictly to validate */
  validationMode?: ValidationMode;
}

/**
 * ContractManifest is the complete capability contract declaration for a module.
 *
 * This is what modules declare in their module.json security.contract section.
 */
export interface ContractManifest {
  /** Module making the request */
  moduleId: string;

  /** Manifest version */
  version: string;

  /** Network access policy */
  networkAccess: NetworkPolicy;

  /** Inter-module communication policies */
  moduleCommunications?: ModuleCommunicationPolicy[];

  /** Hardware access policies */
  hardwareAccess?: HardwareAccessPolicy[];

  /** Filesystem access policy */
  filesystemAccess?: FilesystemPolicy;

  /** Data validation gates */
  dataGates?: DataGatePolicy[];
}

/**
 * ContractDecision is the outcome of evaluating a contract request.
 */
export interface ContractDecision {
  /** Whether the contract was approved */
  approved: boolean;

  /** Unique ID for this contract (if approved) */
  contractId: string;

  /** Module this decision applies to */
  moduleId: string;

  /** List of capabilities granted */
  grantedCapabilities?: string[];

  /** List of capabilities denied */
  deniedCapabilities?: string[];

  /** Whether user must approve this contract */
  requiresUserApproval?: boolean;

  /** Human-readable reason for the decision */
  reason?: string;

  /** Additional decision metadata */
  metadata?: Record<string, unknown>;
}

/**
 * ActiveContract represents a contract currently in effect.
 */
export interface ActiveContract {
  /** Unique contract identifier */
  contractId: string;

  /** Module this contract applies to */
  moduleId: string;

  /** The contract manifest */
  manifest: ContractManifest;

  /** The evaluation decision */
  decision: ContractDecision;

  /** Unix timestamp (milliseconds) when contract was created */
  createdAt: number;

  /** Unix timestamp (milliseconds) of last update */
  lastUpdated: number;
}

/**
 * EnforcementResult is the outcome of enforcing a contract decision.
 */
export interface EnforcementResult {
  /** Whether enforcement was successful */
  success: boolean;

  /** Contract being enforced */
  contractId: string;

  /** Module the enforcement applies to */
  moduleId: string;

  /** List of enforcement mechanisms activated */
  enforcementPoints?: string[];

  /** List of errors if enforcement failed */
  errors?: string[];

  /** Additional enforcement metadata */
  metadata?: Record<string, unknown>;
}

/**
 * EnforcementStatus describes the current enforcement state for a module.
 */
export interface EnforcementStatus {
  /** Module this status applies to */
  moduleId: string;

  /** Currently active contract ID */
  activeContractId?: string;

  /** Whether enforcement is currently active */
  enforcementActive: boolean;

  /** Active enforcement mechanisms */
  enforcementPoints?: string[];

  /** Recent violations detected */
  violations?: string[];

  /** Unix timestamp (milliseconds) of last status update */
  lastUpdated: number;
}

/**
 * ContractEvaluator defines the interface for evaluating capability contracts.
 *
 * Evaluators determine whether a module's requested capabilities should be
 * granted based on policy.
 *
 * @example
 * ```typescript
 * // Evaluate a module's contract request
 * const decision = await evaluator.evaluate(
 *   'backup-module',
 *   contractManifest
 * );
 *
 * if (decision.approved) {
 *   console.log('Contract approved:', decision.grantedCapabilities);
 * }
 * ```
 */
export interface ContractEvaluator {
  /**
   * Evaluate a module's contract manifest against policy.
   *
   * @param moduleId - Module requesting capabilities
   * @param contractManifest - The contract to evaluate
   * @returns Promise resolving to contract decision
   * @throws {EvaluationError} If evaluation fails
   */
  evaluate(moduleId: string, contractManifest: ContractManifest): Promise<ContractDecision>;

  /**
   * Get all active contracts for a module.
   *
   * @param moduleId - Module to query contracts for
   * @returns Promise resolving to list of active contracts
   */
  getActiveContracts(moduleId: string): Promise<ActiveContract[]>;

  /**
   * Revoke an active contract.
   *
   * @param contractId - Contract to revoke
   * @throws {RevocationError} If revocation fails
   */
  revokeContract(contractId: string): Promise<void>;

  /**
   * Update the policy used for contract evaluation.
   *
   * @param policyBundle - New policy bundle
   * @throws {PolicyUpdateError} If policy update fails
   */
  updatePolicy(policyBundle: Record<string, unknown>): Promise<void>;

  /**
   * Get the current policy version.
   *
   * @returns Policy version identifier
   */
  getPolicyVersion(): string;

  /**
   * Check if the contract evaluator is operational.
   *
   * @returns True if the evaluator can evaluate contracts
   */
  isAvailable(): boolean;

  /**
   * Gracefully close the contract evaluator connection.
   */
  close(): Promise<void>;
}

/**
 * ContractEnforcer defines the interface for enforcing contract decisions.
 *
 * Enforcers implement approved capabilities at the network, filesystem,
 * and process level.
 *
 * @example
 * ```typescript
 * // Enforce a contract decision
 * const result = await enforcer.enforce(decision);
 *
 * if (result.success) {
 *   console.log('Enforcement active:', result.enforcementPoints);
 * }
 * ```
 */
export interface ContractEnforcer {
  /**
   * Enforce a contract decision.
   *
   * Sets up network rules, filesystem restrictions, etc.
   *
   * @param contractDecision - Decision to enforce
   * @returns Promise resolving to enforcement result
   * @throws {EnforcementError} If enforcement fails
   */
  enforce(contractDecision: ContractDecision): Promise<EnforcementResult>;

  /**
   * Update enforcement for an existing contract.
   *
   * @param contractId - Contract to update
   * @param changes - Changes to apply
   * @returns Promise resolving to enforcement result
   * @throws {EnforcementError} If update fails
   */
  updateEnforcement(contractId: string, changes: Record<string, unknown>): Promise<EnforcementResult>;

  /**
   * Remove enforcement for a contract.
   *
   * Called when a contract is revoked or module is stopped.
   *
   * @param contractId - Contract to tear down
   * @throws {TeardownError} If teardown fails
   */
  tearDown(contractId: string): Promise<void>;

  /**
   * Get the current enforcement status for a module.
   *
   * @param moduleId - Module to query
   * @returns Promise resolving to enforcement status
   */
  getEnforcementStatus(moduleId: string): Promise<EnforcementStatus>;

  /**
   * Check if the contract enforcer is operational.
   *
   * @returns True if the enforcer can enforce contracts
   */
  isAvailable(): boolean;

  /**
   * Gracefully close the contract enforcer connection.
   */
  close(): Promise<void>;
}

/**
 * Standard contract event types defined by the foundation.
 */
export const FOUNDATION_CONTRACT_EVENT_TYPES = {
  EVALUATED: 'foundation.contract.evaluated',
  APPROVED: 'foundation.contract.approved',
  DENIED: 'foundation.contract.denied',
  REVOKED: 'foundation.contract.revoked',
  VIOLATION_DETECTED: 'foundation.contract.violation-detected',
  ENFORCEMENT_UPDATED: 'foundation.contract.enforcement-updated',
  ENFORCEMENT_FAILED: 'foundation.contract.enforcement-failed',
} as const;

/**
 * Payload types for standard contract events.
 */
export interface ContractEvaluatedPayload {
  moduleId: string;
  contractId: string;
  approved: boolean;
  grantedCapabilities?: string[];
  deniedCapabilities?: string[];
}

export interface ContractApprovedPayload {
  moduleId: string;
  contractId: string;
  grantedCapabilities?: string[];
}

export interface ContractDeniedPayload {
  moduleId: string;
  reason: string;
  deniedCapabilities?: string[];
}

export interface ContractRevokedPayload {
  contractId: string;
  moduleId: string;
  reason?: string;
}

export interface ContractViolationPayload {
  contractId: string;
  moduleId: string;
  violationType: string;
  description: string;
  timestamp: number;
}

export interface EnforcementUpdatedPayload {
  contractId: string;
  moduleId: string;
  enforcementPoints?: string[];
}

export interface EnforcementFailedPayload {
  contractId: string;
  moduleId: string;
  errors?: string[];
}

/**
 * No-operation contract evaluator for fallback mode.
 */
export class NoopContractEvaluator implements ContractEvaluator {
  private warned = false;
  private policyVersion = 'noop-v1';
  private readonly contracts = new Map<string, ActiveContract[]>();

  private warnOnce(): void {
    if (!this.warned) {
      console.warn('[Contract] No policy evaluator installed. Using no-op fallback.');
      this.warned = true;
    }
  }

  async evaluate(moduleId: string, contractManifest: ContractManifest): Promise<ContractDecision> {
    this.warnOnce();
    const contractId = `noop-contract-${moduleId}-${Date.now()}`;
    const decision: ContractDecision = {
      approved: true,
      contractId,
      moduleId,
      grantedCapabilities: ['noop-default'],
      deniedCapabilities: [],
      requiresUserApproval: false,
      reason: 'No-op evaluator approved contract (warn mode).',
      metadata: { provider: 'noop-contract-evaluator' },
    };

    const active: ActiveContract = {
      contractId,
      moduleId,
      manifest: contractManifest,
      decision,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    const existing = this.contracts.get(moduleId) ?? [];
    existing.push(active);
    this.contracts.set(moduleId, existing);
    return decision;
  }

  async getActiveContracts(moduleId: string): Promise<ActiveContract[]> {
    return [...(this.contracts.get(moduleId) ?? [])];
  }

  async revokeContract(contractId: string): Promise<void> {
    for (const [moduleId, values] of this.contracts.entries()) {
      this.contracts.set(
        moduleId,
        values.filter((item) => item.contractId !== contractId)
      );
    }
  }

  async updatePolicy(policyBundle: Record<string, unknown>): Promise<void> {
    const version = policyBundle.version;
    if (typeof version === 'string' && version.trim() !== '') {
      this.policyVersion = version;
    }
  }

  getPolicyVersion(): string {
    return this.policyVersion;
  }

  isAvailable(): boolean {
    return false;
  }

  async close(): Promise<void> {
    return;
  }
}

/**
 * No-operation contract enforcer for fallback mode.
 */
export class NoopContractEnforcer implements ContractEnforcer {
  private readonly statuses = new Map<string, EnforcementStatus>();

  async enforce(contractDecision: ContractDecision): Promise<EnforcementResult> {
    this.statuses.set(contractDecision.moduleId, {
      moduleId: contractDecision.moduleId,
      activeContractId: contractDecision.contractId,
      enforcementActive: false,
      enforcementPoints: ['noop'],
      violations: [],
      lastUpdated: Date.now(),
    });

    return {
      success: true,
      contractId: contractDecision.contractId,
      moduleId: contractDecision.moduleId,
      enforcementPoints: ['noop'],
      errors: [],
      metadata: { provider: 'noop-contract-enforcer' },
    };
  }

  async updateEnforcement(
    contractId: string,
    changes: Record<string, unknown>
  ): Promise<EnforcementResult> {
    void changes;
    let moduleId = 'unknown-module';
    for (const [key, value] of this.statuses.entries()) {
      if (value.activeContractId === contractId) {
        moduleId = key;
        break;
      }
    }
    return {
      success: true,
      contractId,
      moduleId,
      enforcementPoints: ['noop'],
      errors: [],
      metadata: { provider: 'noop-contract-enforcer' },
    };
  }

  async tearDown(contractId: string): Promise<void> {
    for (const [moduleId, value] of this.statuses.entries()) {
      if (value.activeContractId === contractId) {
        this.statuses.set(moduleId, {
          moduleId,
          activeContractId: undefined,
          enforcementActive: false,
          enforcementPoints: [],
          violations: [],
          lastUpdated: Date.now(),
        });
      }
    }
  }

  async getEnforcementStatus(moduleId: string): Promise<EnforcementStatus> {
    return (
      this.statuses.get(moduleId) ?? {
        moduleId,
        activeContractId: undefined,
        enforcementActive: false,
        enforcementPoints: [],
        violations: [],
        lastUpdated: Date.now(),
      }
    );
  }

  isAvailable(): boolean {
    return false;
  }

  async close(): Promise<void> {
    return;
  }
}

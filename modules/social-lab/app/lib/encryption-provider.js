// =============================================================================
// Abstract GroupEncryptionProvider Interface
// =============================================================================
// Blueprint: ARCH-005 Mechanic 7 (Encryption Layer Modularity)
//            F-019 (MLS Integration)
//
// Defines the abstract interface that all encryption providers must implement.
// Application code interacts with this interface, not MLS or any specific
// encryption library directly. This enables swapping encryption backends
// (e.g., AES-GCM Phase 1 -> MLS Phase 2) without changing consumer code.
//
// Phase 1: AesGcmProvider (simple AES-256-GCM, see aes-gcm-provider.js)
// Phase 2: MlsEncryptionProvider (OpenMLS WASM, RFC 9420)
//
// Consumers: collab (doc encryption), groups (content encryption),
//            spatial (room state encryption), chat module (via export)
// =============================================================================

/**
 * @typedef {Object} EncryptionCapabilities
 * @property {boolean} supportsPostQuantum      - PQ ciphersuite available
 * @property {number|null} maxGroupSize         - null = unlimited
 * @property {boolean} supportsExporterSecrets  - Can derive labeled secrets
 * @property {boolean} supportsForwardSecrecy   - Removed members lose access
 * @property {boolean} supportsPostCompromiseSecurity - Self-update recovers security
 */

/**
 * @typedef {Object} GroupConfig
 * @property {string[]} memberWebIds   - Initial member WebIDs
 * @property {string}   [algorithm]    - e.g., 'aes-256-gcm', 'mls-128-dhkemx25519'
 * @property {Object}   [metadata]     - Arbitrary group-level metadata
 */

/**
 * @typedef {Object} GroupHandle
 * @property {string} groupId
 * @property {string} algorithm
 * @property {number} epoch            - Current key epoch (increments on rotation)
 * @property {number} memberCount
 * @property {string} createdAt        - ISO 8601
 */

/**
 * @typedef {Object} GroupUpdateResult
 * @property {string}  groupId
 * @property {number}  newEpoch
 * @property {boolean} keyRotated      - Whether group key material changed
 * @property {number}  memberCount     - Updated member count
 */

/**
 * @typedef {Object} EncryptedPayload
 * @property {string} ciphertext  - Base64-encoded ciphertext
 * @property {string} iv          - Base64-encoded initialization vector
 * @property {string} tag         - Base64-encoded authentication tag
 * @property {number} epoch       - Epoch at which this was encrypted
 * @property {string} algorithm   - Algorithm used
 */

/**
 * Abstract base class for group encryption providers.
 *
 * All methods throw if called directly on the base class.
 * Concrete providers (AesGcmProvider, future MlsEncryptionProvider)
 * must override every method.
 *
 * Per ARCH-005 Mechanic 7: modules interact with this interface, not
 * with MLS types or crypto primitives directly.
 */
class GroupEncryptionProvider {

  /**
   * @param {string} providerId - Unique provider identifier
   * @param {EncryptionCapabilities} capabilities
   */
  constructor(providerId, capabilities) {
    if (new.target === GroupEncryptionProvider) {
      throw new Error('GroupEncryptionProvider is abstract and cannot be instantiated directly.');
    }
    this.providerId = providerId;
    this.capabilities = Object.freeze({ ...capabilities });
  }

  /**
   * Create a new encryption group.
   *
   * @param {string} groupId - Unique group identifier (e.g., 'pmsl:doc:{docId}')
   * @param {GroupConfig} config - Group configuration
   * @returns {Promise<GroupHandle>}
   */
  async createGroup(_groupId, _config) {
    throw new Error(`${this.providerId}: createGroup() not implemented`);
  }

  /**
   * Add a member to an existing group.
   * May trigger key rotation depending on provider policy.
   *
   * @param {string} groupId
   * @param {string} memberWebId - WebID of the member to add
   * @returns {Promise<GroupUpdateResult>}
   */
  async addMember(_groupId, _memberWebId) {
    throw new Error(`${this.providerId}: addMember() not implemented`);
  }

  /**
   * Remove a member from a group.
   * MUST trigger key rotation to ensure forward secrecy (removed member
   * cannot derive future keys).
   *
   * @param {string} groupId
   * @param {string} memberWebId - WebID of the member to remove
   * @returns {Promise<GroupUpdateResult>}
   */
  async removeMember(_groupId, _memberWebId) {
    throw new Error(`${this.providerId}: removeMember() not implemented`);
  }

  /**
   * Encrypt plaintext for all current group members.
   *
   * @param {string} groupId
   * @param {string|Buffer} plaintext
   * @returns {Promise<EncryptedPayload>}
   */
  async encrypt(_groupId, _plaintext) {
    throw new Error(`${this.providerId}: encrypt() not implemented`);
  }

  /**
   * Decrypt ciphertext using the group key for the given epoch.
   *
   * @param {string} groupId
   * @param {EncryptedPayload} encryptedPayload
   * @returns {Promise<Buffer>}
   */
  async decrypt(_groupId, _encryptedPayload) {
    throw new Error(`${this.providerId}: decrypt() not implemented`);
  }

  /**
   * Derive an application-specific secret from the current group key.
   * Per ARCH-005 Mechanic 5: exporter secrets for non-messaging use
   * (document keys, access tokens, content keys, spatial keys).
   *
   * @param {string} groupId
   * @param {string} label     - Application label (e.g., 'pmsl-doc-key')
   * @param {number} [length]  - Desired key length in bytes (default 32)
   * @returns {Promise<Buffer>}
   */
  async exportSecret(_groupId, _label, _length) {
    throw new Error(`${this.providerId}: exportSecret() not implemented`);
  }

  /**
   * Get the current encryption status of a group.
   *
   * @param {string} groupId
   * @returns {Promise<GroupHandle|null>} - null if group not found
   */
  async getGroupStatus(_groupId) {
    throw new Error(`${this.providerId}: getGroupStatus() not implemented`);
  }
}

/**
 * Registry for encryption providers.
 * Parallel to AdapterRegistry / DataLayerAdapter patterns.
 *
 * Usage:
 *   registry.register(new AesGcmProvider(pool));
 *   const provider = registry.getProvider('aes-gcm-phase1');
 *   // or get the default:
 *   const provider = registry.getDefault();
 */
class EncryptionProviderRegistry {

  constructor() {
    /** @type {Map<string, GroupEncryptionProvider>} */
    this._providers = new Map();
    /** @type {string|null} */
    this._defaultId = null;
  }

  /**
   * Register a provider. The first registered provider becomes the default.
   *
   * @param {GroupEncryptionProvider} provider
   * @param {boolean} [setDefault=false]
   */
  register(provider, setDefault = false) {
    if (!(provider instanceof GroupEncryptionProvider)) {
      throw new TypeError('Provider must extend GroupEncryptionProvider');
    }
    this._providers.set(provider.providerId, provider);
    if (setDefault || this._providers.size === 1) {
      this._defaultId = provider.providerId;
    }
    console.log(`[encryption] Registered provider: ${provider.providerId}` +
      (this._defaultId === provider.providerId ? ' (default)' : ''));
  }

  /**
   * @param {string} providerId
   * @returns {GroupEncryptionProvider}
   */
  getProvider(providerId) {
    const p = this._providers.get(providerId);
    if (!p) throw new Error(`Encryption provider not found: ${providerId}`);
    return p;
  }

  /**
   * @returns {GroupEncryptionProvider}
   */
  getDefault() {
    if (!this._defaultId) throw new Error('No encryption providers registered');
    return this._providers.get(this._defaultId);
  }

  /**
   * @returns {string[]}
   */
  listProviders() {
    return [...this._providers.keys()];
  }
}

// Singleton registry
const encryptionRegistry = new EncryptionProviderRegistry();

export {
  GroupEncryptionProvider,
  EncryptionProviderRegistry,
  encryptionRegistry,
};

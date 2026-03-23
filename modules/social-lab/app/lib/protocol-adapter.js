// =============================================================================
// Protocol Adapter Interface
// =============================================================================
// Abstract base class that ALL protocol integrations must implement.
// This creates a uniform contract so every protocol (ActivityPub, Nostr,
// Holochain, SSB, Zot, Bonfire, RSS, IndieWeb, AT Protocol) plugs in
// consistently, regardless of underlying implementation maturity.
//
// Status values:
//   'active'      — Protocol is fully implemented and operational
//   'partial'     — Protocol has limited functionality (e.g., read-only)
//   'stub'        — Protocol interface exists but runtime is not available
//   'unavailable' — Protocol was active but is currently unreachable
//
// Adapters that wrap existing route-based implementations delegate to the
// existing code. Stub adapters return informative errors documenting what
// runtime dependencies are needed.

/**
 * @typedef {Object} ProtocolIdentity
 * @property {string} protocol    — Protocol name (e.g., 'activitypub')
 * @property {string} identifier  — Protocol-specific identifier (e.g., actor URI, npub, feed ID)
 * @property {Object} [metadata]  — Additional protocol-specific identity data
 */

/**
 * @typedef {Object} DistributionResult
 * @property {boolean} success
 * @property {string}  [id]       — Protocol-specific post/content ID
 * @property {string}  [error]    — Error message on failure
 * @property {Object}  [metadata] — Additional protocol-specific result data
 */

/**
 * @typedef {Object} FollowResult
 * @property {boolean} success
 * @property {string}  status     — 'pending', 'accepted', 'rejected', 'error'
 * @property {string}  [error]    — Error message on failure
 */

/**
 * @typedef {Object} HealthCheckResult
 * @property {boolean}  available
 * @property {number}   [latency]  — Response time in milliseconds
 * @property {string}   [error]    — Error description if unavailable
 * @property {Object}   [details]  — Protocol-specific health details
 */

/**
 * Abstract Protocol Adapter base class.
 *
 * Every protocol integration extends this class and implements all methods.
 * Methods that are not applicable for a given protocol should return
 * appropriate defaults (e.g., stub adapters return { success: false }).
 */
export class ProtocolAdapter {
  /**
   * @param {Object} config
   * @param {string} config.name      — Protocol name (lowercase, e.g., 'activitypub')
   * @param {string} config.version   — Adapter version (semver)
   * @param {string} config.status    — 'active' | 'partial' | 'stub' | 'unavailable'
   * @param {string} [config.description] — Human-readable description
   * @param {string[]} [config.requires] — Runtime dependencies needed for full operation
   */
  constructor(config) {
    if (new.target === ProtocolAdapter) {
      throw new Error('ProtocolAdapter is abstract and cannot be instantiated directly');
    }
    this.name = config.name;
    this.version = config.version;
    this.status = config.status;
    this.description = config.description || '';
    this.requires = config.requires || [];
  }

  /**
   * Provision a protocol-specific identity for a user profile.
   * @param {Object} profile — Social Lab profile object (from profile_index)
   * @returns {Promise<ProtocolIdentity>}
   */
  async provisionIdentity(profile) {
    throw new Error(`${this.name}: provisionIdentity() not implemented`);
  }

  /**
   * Publish content to the protocol network.
   * @param {Object} post      — Post object (content_text, content_html, media_urls, etc.)
   * @param {ProtocolIdentity} identity — The identity to publish as
   * @returns {Promise<DistributionResult>}
   */
  async publishContent(post, identity) {
    throw new Error(`${this.name}: publishContent() not implemented`);
  }

  /**
   * Fetch content from the protocol network for a given identity.
   * @param {ProtocolIdentity} identity — Identity to fetch content for
   * @param {Object} [options]          — { limit, since, until }
   * @returns {Promise<Object[]>}       — Array of content items
   */
  async fetchContent(identity, options = {}) {
    throw new Error(`${this.name}: fetchContent() not implemented`);
  }

  /**
   * Follow a remote identity from a local identity.
   * @param {ProtocolIdentity} localIdentity  — The follower
   * @param {ProtocolIdentity} remoteIdentity — The target to follow
   * @returns {Promise<FollowResult>}
   */
  async follow(localIdentity, remoteIdentity) {
    throw new Error(`${this.name}: follow() not implemented`);
  }

  /**
   * Get a profile for a protocol identity.
   * @param {ProtocolIdentity} identity
   * @returns {Promise<Object|null>} — Protocol-specific profile data, or null
   */
  async getProfile(identity) {
    throw new Error(`${this.name}: getProfile() not implemented`);
  }

  /**
   * Check protocol health and availability.
   * @returns {Promise<HealthCheckResult>}
   */
  async healthCheck() {
    throw new Error(`${this.name}: healthCheck() not implemented`);
  }

  /**
   * Return a JSON-serializable summary of this adapter.
   * Used by the protocol registry and status API.
   */
  toJSON() {
    return {
      name: this.name,
      version: this.version,
      status: this.status,
      description: this.description,
      requires: this.requires,
    };
  }
}

/**
 * Helper base class for stub adapters.
 * Provides default implementations that return informative "not available" responses.
 */
export class StubProtocolAdapter extends ProtocolAdapter {
  constructor(config) {
    super({ ...config, status: 'stub' });
    this._stubNote = config.stubNote || `${config.name} runtime is not available. See 'requires' for needed dependencies.`;
  }

  async provisionIdentity(profile) {
    return {
      protocol: this.name,
      identifier: null,
      metadata: { stub: true, note: this._stubNote },
    };
  }

  async publishContent(post, identity) {
    return { success: false, error: this._stubNote };
  }

  async fetchContent(identity, options = {}) {
    return [];
  }

  async follow(localIdentity, remoteIdentity) {
    return { success: false, status: 'error', error: this._stubNote };
  }

  async getProfile(identity) {
    return null;
  }

  async healthCheck() {
    return {
      available: false,
      error: this._stubNote,
      details: { requires: this.requires },
    };
  }
}

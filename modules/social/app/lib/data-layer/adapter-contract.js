// data layer adapter runtime contract and capability helpers

/**
 * @typedef {'path'|'content'|'key'} AddressingMode
 */

/**
 * @typedef {Object} AdapterCapabilities
 * @property {AddressingMode[]} addressingModes
 * @property {boolean} supportsMutableData
 * @property {boolean} supportsAppendOnly
 * @property {boolean} supportsTrueDeletion
 * @property {boolean} supportsDHT
 * @property {boolean} supportsP2PSync
 * @property {boolean} supportsACL
 * @property {boolean} supportsRDF
 * @property {boolean} supportsOfflineFirst
 * @property {number|null} maxPayloadSize
 * @property {boolean} supportsTransactions
 * @property {string|null} nativeQueryLanguage
 */

const REQUIRED_METHODS = [
  'initialize',
  'shutdown',
  'healthCheck',
  'create',
  'read',
  'update',
  'delete',
  'query',
  'subscribe',
  'exportData',
  'importData',
];

/**
 * Build immutable adapter capabilities with defaults.
 * @param {Partial<AdapterCapabilities>} partial
 * @returns {AdapterCapabilities}
 */
export function defineAdapterCapabilities(partial = {}) {
  return Object.freeze({
    addressingModes: partial.addressingModes || [],
    supportsMutableData: Boolean(partial.supportsMutableData),
    supportsAppendOnly: Boolean(partial.supportsAppendOnly),
    supportsTrueDeletion: Boolean(partial.supportsTrueDeletion),
    supportsDHT: Boolean(partial.supportsDHT),
    supportsP2PSync: Boolean(partial.supportsP2PSync),
    supportsACL: Boolean(partial.supportsACL),
    supportsRDF: Boolean(partial.supportsRDF),
    supportsOfflineFirst: Boolean(partial.supportsOfflineFirst),
    maxPayloadSize: partial.maxPayloadSize ?? null,
    supportsTransactions: Boolean(partial.supportsTransactions),
    nativeQueryLanguage: partial.nativeQueryLanguage ?? null,
  });
}

/**
 * Runtime contract guard for adapters registered with the data layer.
 * @param {object} adapter
 * @returns {void}
 */
export function assertAdapterContract(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('Adapter contract violation: adapter must be an object');
  }
  if (!adapter.backendId || typeof adapter.backendId !== 'string') {
    throw new Error('Adapter contract violation: backendId must be a non-empty string');
  }
  if (!adapter.capabilities || typeof adapter.capabilities !== 'object') {
    throw new Error('Adapter contract violation: capabilities must be provided');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`Adapter contract violation: missing method ${method}()`);
    }
  }
}

export const DATA_LAYER_REQUIRED_METHODS = Object.freeze([...REQUIRED_METHODS]);

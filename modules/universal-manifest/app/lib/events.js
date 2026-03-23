// =============================================================================
// Universal Manifest Module - Event Publishing
// =============================================================================
// Publishes lifecycle events for manifest operations.
// Events are published to the eventbus if available (Redis/NATS),
// and always logged to stdout.
//
// Event names per module.json:
//   um.manifest.created
//   um.manifest.updated
//   um.manifest.revoked
//   um.facet.written
//   um.manifest.verified
//   um.manifest.resolved
// =============================================================================

/**
 * Publish a UM lifecycle event.
 * Currently logs to stdout. When an eventbus is connected,
 * this will also publish to Redis/NATS.
 *
 * @param {string} eventName - One of the um.* event names
 * @param {object} payload - Event payload data
 */
function emit(eventName, payload) {
  const event = {
    event: eventName,
    module: 'universal-manifest',
    timestamp: new Date().toISOString(),
    payload,
  };

  // Log to stdout (always)
  console.log(`[um-event] ${eventName}`, JSON.stringify(payload));

  // TODO: Publish to eventbus (Redis/NATS) when um-events connection is available.
  // The eventbus connection is optional per module.json.

  return event;
}

export { emit };

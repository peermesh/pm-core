#!/usr/bin/env bash
#
# PeerMesh Foundation - No-Op Event Bus Implementation
#
# This script provides a no-op (no-operation) event bus implementation for
# the foundation core. When no event bus module is installed, these functions
# can be sourced to satisfy the event bus interface without any actual
# message passing.
#
# Usage:
#   source /path/to/foundation/lib/eventbus-noop.sh
#
#   # Publish (does nothing, logs warning on first call)
#   eventbus_publish "my-module.entity.created" '{"id": "123"}'
#
#   # Subscribe (returns dummy subscription, logs warning)
#   sub_id=$(eventbus_subscribe "my-module.entity.*" handler_function)
#
#   # Unsubscribe (does nothing)
#   eventbus_unsubscribe "$sub_id"
#
# Note: This implementation logs a warning the first time it is used,
# informing users that no event bus module is installed.

set -euo pipefail

# Track whether we've warned about no event bus being configured
_EVENTBUS_WARNED=${_EVENTBUS_WARNED:-false}

# Internal function to emit warning once
_eventbus_warn_once() {
    if [[ "$_EVENTBUS_WARNED" == "false" ]]; then
        echo "[WARN] Event bus not configured. Install an event bus module (e.g., eventbus-redis, eventbus-nats) to enable inter-module messaging." >&2
        export _EVENTBUS_WARNED=true
    fi
}

# Publish an event to the event bus
# Arguments:
#   $1 - topic: Topic to publish to (e.g., "module.entity.action")
#   $2 - payload: JSON payload string
#   $3 - options: (optional) JSON options string
# Returns:
#   0 always (no-op)
eventbus_publish() {
    local topic="${1:-}"
    local payload="${2:-}"
    local options="${3:-}"

    _eventbus_warn_once

    # No-op: do nothing
    # In debug mode, you could uncomment the following to see what would be published:
    # if [[ "${EVENTBUS_DEBUG:-false}" == "true" ]]; then
    #     echo "[DEBUG] eventbus_publish: topic=$topic payload=$payload" >&2
    # fi

    return 0
}

# Subscribe to events matching a topic pattern
# Arguments:
#   $1 - topic: Topic pattern to subscribe to (supports * and # wildcards)
#   $2 - handler: Name of the handler function to call (not used in no-op)
#   $3 - options: (optional) JSON options string
# Returns:
#   Dummy subscription ID
eventbus_subscribe() {
    local topic="${1:-}"
    local handler="${2:-}"
    local options="${3:-}"

    _eventbus_warn_once

    # Generate a dummy subscription ID
    local sub_id="noop-sub-$(date +%s)-$$-$RANDOM"

    echo "$sub_id"
}

# Unsubscribe from a topic
# Arguments:
#   $1 - subscription_id: Subscription ID returned from eventbus_subscribe
# Returns:
#   0 always (no-op)
eventbus_unsubscribe() {
    local subscription_id="${1:-}"

    # No-op: do nothing
    return 0
}

# Check if the event bus is connected and operational
# Returns:
#   1 (false) - no-op event bus is never "connected" to anything
eventbus_is_connected() {
    return 1
}

# Get the current event bus implementation name
# Returns:
#   "noop" for this implementation
eventbus_implementation() {
    echo "noop"
}

# Initialize the event bus (no-op does nothing)
# Returns:
#   0 always
eventbus_init() {
    _eventbus_warn_once
    return 0
}

# Close the event bus connection (no-op does nothing)
# Returns:
#   0 always
eventbus_close() {
    return 0
}

# Export all functions for use in other scripts
export -f eventbus_publish
export -f eventbus_subscribe
export -f eventbus_unsubscribe
export -f eventbus_is_connected
export -f eventbus_implementation
export -f eventbus_init
export -f eventbus_close
export -f _eventbus_warn_once

# If script is executed directly (not sourced), print usage info
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    cat <<EOF
PeerMesh Foundation - No-Op Event Bus

This is a no-operation event bus implementation. It provides stub functions
that satisfy the event bus interface but do not actually send or receive
any messages.

To use inter-module messaging, install an event bus module:
  - eventbus-redis: Redis-based pub/sub
  - eventbus-nats: NATS messaging
  - eventbus-memory: In-memory for testing

Usage (source in your script):
  source /path/to/foundation/lib/eventbus-noop.sh

Functions:
  eventbus_publish <topic> <payload> [options]  - Publish event (no-op)
  eventbus_subscribe <topic> <handler> [options] - Subscribe to topic (returns dummy ID)
  eventbus_unsubscribe <subscription_id>         - Unsubscribe (no-op)
  eventbus_is_connected                          - Check connection (always returns 1)
  eventbus_implementation                        - Get implementation name ("noop")
  eventbus_init                                  - Initialize (no-op)
  eventbus_close                                 - Close connection (no-op)

EOF
fi

/**
 * PeerMesh Foundation - Event Bus Interface
 *
 * This file defines the TypeScript interface for the event bus system.
 * The foundation core includes only this interface - actual implementations
 * are provided by add-on modules (e.g., eventbus-redis, eventbus-nats, eventbus-memory).
 *
 * @module foundation/interfaces/eventbus
 * @version 1.0.0
 */

/**
 * Event represents a message published on the event bus.
 *
 * Events follow the CloudEvents specification with PeerMesh extensions.
 * All events must have an id, timestamp, source module, and type.
 */
export interface Event<T = unknown> {
  /** Unique event identifier (UUIDv4) */
  id: string;

  /** Unix timestamp in milliseconds when event was created */
  timestamp: number;

  /** Module ID that emitted this event */
  source: string;

  /** Event type in format: source.entity.action (e.g., "backup-module.backup.completed") */
  type: string;

  /** Event format specification version */
  specversion?: '1.0';

  /** Content type of the payload */
  datacontenttype?: string;

  /** Specific subject/resource this event relates to */
  subject?: string;

  /** ID linking related events in a workflow */
  correlationId?: string;

  /** ID of the event that caused this event */
  causationId?: string;

  /** Event-specific data */
  payload?: T;

  /** Additional metadata about the event */
  metadata?: EventMetadata;
}

/**
 * EventMetadata contains optional additional information about an event.
 */
export interface EventMetadata {
  /** Version of the event schema */
  version?: string;

  /** Number of delivery attempts */
  retryCount?: number;

  /** Original timestamp if event was replayed */
  originalTimestamp?: number;

  /** Custom metadata properties */
  [key: string]: unknown;
}

/**
 * EventHandler is a callback function that processes events.
 *
 * Handlers should be idempotent when possible, as events may be delivered
 * more than once in certain implementations.
 */
export type EventHandler<T = unknown> = (event: Event<T>) => void | Promise<void>;

/**
 * Subscription represents an active event subscription.
 *
 * Use the subscription ID to unsubscribe when the handler is no longer needed.
 */
export interface Subscription {
  /** Unique subscription identifier */
  id: string;

  /** Topic pattern this subscription is listening to */
  topic: string;

  /** Whether the subscription is currently active */
  active: boolean;
}

/**
 * SubscribeOptions configures how events are delivered to a handler.
 */
export interface SubscribeOptions {
  /**
   * If true, only receive events from other modules (not from self).
   * Default: false
   */
  excludeSelf?: boolean;

  /**
   * Consumer group name for competing consumers pattern.
   * When set, only one subscriber in the group receives each event.
   */
  group?: string;

  /**
   * If true, receive historical events from the beginning.
   * Implementation-dependent; may not be supported by all event bus implementations.
   */
  fromBeginning?: boolean;
}

/**
 * PublishOptions configures how an event is published.
 */
export interface PublishOptions {
  /**
   * Correlation ID to link this event with a workflow.
   * If provided, this ID will be set on the event.
   */
  correlationId?: string;

  /**
   * Causation ID indicating what event caused this one.
   */
  causationId?: string;

  /**
   * If true, wait for the event to be acknowledged/persisted.
   * Implementation-dependent.
   */
  waitForAck?: boolean;
}

/**
 * EventBus is the core interface for inter-module communication.
 *
 * Modules use the event bus to publish events and subscribe to topics.
 * The foundation core provides a no-op implementation; actual implementations
 * are provided by add-on modules.
 *
 * @example
 * ```typescript
 * // Publishing an event
 * eventBus.publish('backup-module.backup.completed', {
 *   backupId: 'daily-2024-01-16',
 *   size: 1073741824,
 *   duration: 45000
 * });
 *
 * // Subscribing to events
 * const subscription = eventBus.subscribe('backup-module.backup.*', (event) => {
 *   console.log(`Backup event: ${event.type}`, event.payload);
 * });
 *
 * // Cleanup when done
 * eventBus.unsubscribe(subscription);
 * ```
 */
export interface EventBus {
  /**
   * Publish an event to the event bus.
   *
   * @param topic - Topic to publish to (e.g., "module.entity.action")
   * @param payload - Event payload data
   * @param options - Optional publish configuration
   * @returns Promise that resolves when event is published
   */
  publish<T = unknown>(topic: string, payload: T, options?: PublishOptions): Promise<void>;

  /**
   * Subscribe to events matching a topic pattern.
   *
   * Topic patterns support wildcards:
   * - `*` matches a single segment (e.g., "module.*.created")
   * - `#` matches zero or more segments (e.g., "module.#")
   *
   * @param topic - Topic pattern to subscribe to
   * @param handler - Function to call when events are received
   * @param options - Optional subscription configuration
   * @returns Subscription object that can be used to unsubscribe
   */
  subscribe<T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions
  ): Subscription;

  /**
   * Unsubscribe from a topic.
   *
   * @param subscription - Subscription to cancel
   */
  unsubscribe(subscription: Subscription): void;

  /**
   * Check if the event bus is connected and operational.
   *
   * @returns True if the event bus is ready to use
   */
  isConnected(): boolean;

  /**
   * Gracefully close the event bus connection.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  close(): Promise<void>;
}

/**
 * Standard event types defined by the foundation.
 *
 * These events are published by the foundation core and can be subscribed to
 * by any module for system-level notifications.
 */
export const FOUNDATION_EVENT_TYPES = {
  MODULE_INSTALLED: 'foundation.module.installed',
  MODULE_STARTED: 'foundation.module.started',
  MODULE_STOPPED: 'foundation.module.stopped',
  MODULE_UNINSTALLED: 'foundation.module.uninstalled',
  MODULE_HEALTH_CHANGED: 'foundation.module.health-changed',
  MODULE_CONFIG_UPDATED: 'foundation.module.config-updated',
  CONNECTION_ESTABLISHED: 'foundation.connection.established',
  CONNECTION_LOST: 'foundation.connection.lost',
  SYSTEM_STARTUP: 'foundation.system.startup',
  SYSTEM_SHUTDOWN: 'foundation.system.shutdown',
} as const;

/**
 * Payload types for standard foundation events.
 */
export interface ModuleInstalledPayload {
  moduleId: string;
  version: string;
  previousVersion?: string;
}

export interface ModuleStartedPayload {
  moduleId: string;
  startupDuration?: number;
}

export interface ModuleStoppedPayload {
  moduleId: string;
  reason: 'requested' | 'error' | 'dependency' | 'system-shutdown';
}

export interface ModuleHealthChangedPayload {
  moduleId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  previousStatus?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  message?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message?: string;
  }>;
}

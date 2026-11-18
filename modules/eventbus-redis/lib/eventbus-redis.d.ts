/** Exact-topic, auto-ack subset; not whole Foundation EventBus conformance. */
export type MembershipTopic = 'groups.group.created' | 'groups.group.updated' |
  'groups.member.joined' | 'groups.member.left' | 'groups.member.approved';
/**
 * A module-scoped exact topic, such as 'pm-module-events.event.created'. The type only requires three
 * dot-separated parts; the provider checks the rest at runtime: lowercase segments of [a-z0-9-], at
 * least three, at most 128 characters, and for publish the first segment equals the bus source.
 * Which topics a module may publish is decided by its manifest (provides.events) at the gateway.
 */
export type EventBusTopic = `${string}.${string}.${string}`;
export interface RedisStreamsConfig {
  /** redis:// or rediss:// with no username or password; credentials in the URL are refused. */
  url: string;
  source: string;
  streamPrefix: string;
  consumerGroup: string;
  claimIdleMs: number;
  /** Defaults to provider metadata's 5; delivery count includes recovery claims. */
  maxDeliveryAttempts?: number;
  /** Defaults to 2000. Timeout rejects; an already-running handler cannot be cancelled. */
  closeTimeoutMs?: number;
  /**
   * Path of a file holding the Redis password, read once at connect. One trailing newline is removed.
   * Refused when missing, empty, larger than 4096 bytes, a symlink, not a regular file, or group- or
   * world-readable. The value is never logged or put in an error.
   */
  passwordFile?: string;
  /** Redis ACL user name; requires passwordFile. Omit for the default user (requirepass). */
  username?: string;
}
export interface Event<T = Record<string, unknown>> {
  id: string; timestamp: number; source: string; type: EventBusTopic;
  specversion: '1.0'; datacontenttype: 'application/json'; payload: T;
  correlationId?: string; causationId?: string;
  metadata?: Record<string, unknown>;
}
export interface PublishOptions {
  correlationId?: string; causationId?: string; waitForAck?: false;
  deliveryGuarantee?: 'at-least-once'; deliveryTier?: 'informational' | 'operational-critical';
  idempotencyKey?: string; deadLetterTopic?: string; metadata?: Record<string, unknown>;
}
export interface SubscribeOptions {
  /** If supplied, must match config.consumerGroup. */
  group?: string;
  fromBeginning?: boolean;
  ackMode?: 'auto'; deliveryGuarantee?: 'at-least-once';
  maxDeliveryAttempts?: number;
  /** Same rule as a topic; its first segment is the subscribed topic's source, and it differs from that topic. */
  deadLetterTopic: string;
}
export interface RedisSubscription {
  readonly id: string; readonly topic: EventBusTopic; readonly active: boolean;
  readonly ready: Promise<void>;
  /** Resolves when the loop has exited. Inspect error for background failure. */
  readonly closed: Promise<void>;
  /**
   * Set only when the loop has ended for good: a non-retryable error, or close()/unsubscribe() while the
   * subscription was reconnecting (then it holds the last connection error). Not set during a reconnect.
   */
  readonly error?: Error;
  /** Number of times the loop re-established its broker connection after a retryable failure. */
  readonly reconnects: number;
  /** True while the loop is backing off and reconnecting after a retryable failure. */
  readonly reconnecting: boolean;
}
export class RedisStreamsEventBus {
  connect(config: RedisStreamsConfig): Promise<void>;
  publish<T extends Record<string, unknown>>(topic: EventBusTopic, payload: T, options?: PublishOptions): Promise<void>;
  subscribe<T = Record<string, unknown>>(topic: EventBusTopic, handler: (event: Event<T>) => void | Promise<void>, options: SubscribeOptions): RedisSubscription;
  unsubscribe(subscription: RedisSubscription): void;
  isConnected(): boolean;
  close(): Promise<void>;
}

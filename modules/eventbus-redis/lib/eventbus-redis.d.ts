/** Exact-topic, auto-ack subset; not whole Foundation EventBus conformance. */
export type MembershipTopic = 'groups.group.created' | 'groups.group.updated' |
  'groups.member.joined' | 'groups.member.left' | 'groups.member.approved';
export interface RedisStreamsConfig {
  url: string;
  source: string;
  streamPrefix: string;
  consumerGroup: string;
  claimIdleMs: number;
  /** Defaults to provider metadata's 5; delivery count includes recovery claims. */
  maxDeliveryAttempts?: number;
  /** Defaults to 2000. Timeout rejects; an already-running handler cannot be cancelled. */
  closeTimeoutMs?: number;
}
export interface Event<T = Record<string, unknown>> {
  id: string; timestamp: number; source: string; type: MembershipTopic;
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
  deadLetterTopic: string;
}
export interface RedisSubscription {
  readonly id: string; readonly topic: MembershipTopic; readonly active: boolean;
  readonly ready: Promise<void>;
  /** Resolves when the loop has exited. Inspect error for background failure. */
  readonly closed: Promise<void>;
  readonly error?: Error;
}
export class RedisStreamsEventBus {
  connect(config: RedisStreamsConfig): Promise<void>;
  publish<T extends Record<string, unknown>>(topic: MembershipTopic, payload: T, options?: PublishOptions): Promise<void>;
  subscribe<T = Record<string, unknown>>(topic: MembershipTopic, handler: (event: Event<T>) => void | Promise<void>, options: SubscribeOptions): RedisSubscription;
  unsubscribe(subscription: RedisSubscription): void;
  isConnected(): boolean;
  close(): Promise<void>;
}

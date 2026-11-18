export type BusGatewayErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'unavailable' |
  'unexpected_status' | 'timeout' | 'transport';

export class BusGatewayError extends Error {
  readonly code: BusGatewayErrorCode;
  /** HTTP status, or null for timeout/transport failures. */
  readonly status: number | null;
  /** True for 503, timeouts, transport failures and unexpected statuses. */
  readonly retryable: boolean;
  /** The gateway's error reason, such as topic_not_allowed or body_too_large. */
  readonly reason: string | null;
}

export interface GatewayPublishOptions {
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayPublisher {
  /** Resolves only on 202 (the bus accepted the event); throws BusGatewayError otherwise. */
  publish(topic: string, payload: Record<string, unknown>, options: GatewayPublishOptions): Promise<void>;
}

export function createGatewayPublisher(options: {
  url: string;
  key: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): GatewayPublisher;

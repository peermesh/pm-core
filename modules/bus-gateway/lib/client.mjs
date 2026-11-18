// Publisher client for modules. Structurally matches the Groups drain publisher:
// publish(topic, payload, {idempotencyKey, metadata}) -> Promise<void>.

const CODES = {
  400: ['bad_request', false],
  401: ['unauthorized', false],
  403: ['forbidden', false],
  503: ['unavailable', true],
};

export class BusGatewayError extends Error {
  /** code: bad_request | unauthorized | forbidden | unavailable | unexpected_status | timeout | transport */
  constructor(code, { status = null, retryable, reason = null } = {}) {
    super('Bus gateway publish failed: ' + code + (status ? ' (' + status + ')' : '') + (reason ? ' ' + reason : ''));
    this.name = 'BusGatewayError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.reason = reason;
  }
}

export function createGatewayPublisher({ url, key, timeoutMs = 10000, fetchImpl = globalThis.fetch }) {
  const base = new URL(url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new TypeError('Gateway URL must be http(s) without credentials');
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('Gateway key required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('timeoutMs must be 1..60000');
  const endpoint = new URL('/v1/publish', base).href;
  const authorization = 'Bearer ' + key;

  return Object.freeze({
    async publish(topic, payload, options = {}) {
      const body = { topic, payload, idempotencyKey: options.idempotencyKey };
      if (options.metadata !== undefined) body.metadata = options.metadata;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw new BusGatewayError(timedOut ? 'timeout' : 'transport', { retryable: true });
      }
      let reason = null;
      try {
        const parsed = await response.json();
        reason = typeof parsed?.error === 'string' ? parsed.error : null;
      } catch { /* empty or non-JSON body */ }
      if (response.status === 202) return;
      const [code, retryable] = CODES[response.status] ?? ['unexpected_status', true];
      throw new BusGatewayError(code, { status: response.status, retryable, reason });
    },
  });
}

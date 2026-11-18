// In-process stand-in for the `redis` package, used only by topic-pattern.test.mjs.
// It never opens a socket. Each client records its commands; the test installs a
// reply function on globalThis.__eventbusRedisStub to script broker answers.
// The error classes exist only so the provider's named imports resolve.
const state = globalThis.__eventbusRedisStub ??= {clients: [], reply: () => 'OK'};

export class ErrorReply extends Error {}
export class ClientClosedError extends Error {}
export class ClientOfflineError extends Error {}
export class ConnectionTimeoutError extends Error {}
export class DisconnectsClientError extends Error {}
export class ReconnectStrategyError extends Error {}
export class SocketClosedUnexpectedlyError extends Error {}

export function createClient(options) {
  const client = {
    options, isOpen: false, isReady: false, calls: [],
    on() { return client; },
    async connect() { client.isOpen = true; client.isReady = true; },
    async disconnect() { client.isOpen = false; client.isReady = false; },
    async sendCommand(args) { client.calls.push(args); return state.reply(args, client); },
  };
  state.clients.push(client);
  return client;
}

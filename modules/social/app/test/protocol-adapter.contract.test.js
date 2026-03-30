import test from 'node:test';
import assert from 'node:assert/strict';

import { ProtocolAdapter, StubProtocolAdapter } from '../lib/protocol-adapter.js';

class DummyAdapter extends ProtocolAdapter {
  constructor() {
    super({
      name: 'dummy',
      version: '0.1.0',
      status: 'active',
      description: 'test adapter',
      requires: [],
    });
  }

  async provisionIdentity(profile) {
    return { protocol: this.name, identifier: profile?.id || 'dummy-id' };
  }

  async publishContent(post, identity) {
    return { success: true, id: identity?.identifier || 'dummy-post' };
  }

  async fetchContent() {
    return [];
  }

  async follow() {
    return { success: true, status: 'accepted' };
  }

  async getProfile() {
    return {};
  }

  async healthCheck() {
    return { available: true };
  }
}

test('ProtocolAdapter cannot be instantiated directly', () => {
  assert.throws(
    () => new ProtocolAdapter({ name: 'bad', version: '0.0.0', status: 'stub' }),
    /abstract/
  );
});

test('ProtocolAdapter subclass exposes expected JSON summary', () => {
  const adapter = new DummyAdapter();
  assert.deepEqual(adapter.toJSON(), {
    name: 'dummy',
    version: '0.1.0',
    status: 'active',
    description: 'test adapter',
    requires: [],
  });
});

test('StubProtocolAdapter returns deterministic stub responses', async () => {
  class DummyStubAdapter extends StubProtocolAdapter {
    constructor() {
      super({
        name: 'dummy-stub',
        version: '0.0.1',
        description: 'stub test adapter',
        requires: ['runtime-x'],
      });
    }
  }

  const adapter = new DummyStubAdapter();
  const identity = await adapter.provisionIdentity({});
  const publish = await adapter.publishContent({}, identity);
  const follow = await adapter.follow(identity, identity);
  const health = await adapter.healthCheck();

  assert.equal(adapter.status, 'stub');
  assert.equal(identity.metadata.stub, true);
  assert.equal(publish.success, false);
  assert.equal(follow.success, false);
  assert.equal(health.available, false);
});

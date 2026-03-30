// data orchestrator with primary-first writes and fallback reads

import { DataEventBus } from './event-bus.js';

export class DataOrchestrator {
  /**
   * @param {{ registry: import('./adapter-registry.js').AdapterRegistry, eventBus?: DataEventBus }} options
   */
  constructor({ registry, eventBus = new DataEventBus() }) {
    this.registry = registry;
    this.eventBus = eventBus;
  }

  async create(resource, data) {
    return this._writeWithReplication('create', [resource, data], 'create');
  }

  async update(ref, data) {
    return this._writeWithReplication('update', [ref, data], 'update');
  }

  async delete(ref) {
    return this._writeWithReplication('delete', [ref], 'delete');
  }

  async query(q) {
    const primary = this.registry.getPrimary();
    return primary.query(q);
  }

  async read(ref) {
    const primary = this.registry.getPrimary();
    const active = await this.registry.getActive();
    const activeIds = new Set(active.map((a) => a.backendId));

    const candidates = activeIds.has(primary.backendId)
      ? [primary, ...active.filter((a) => a.backendId !== primary.backendId)]
      : active;

    for (const adapter of candidates) {
      try {
        const result = await adapter.read(ref);
        if (result !== null && result !== undefined) {
          return result;
        }
      } catch {
        // continue fallback chain
      }
    }
    return null;
  }

  async _writeWithReplication(method, args, changeType) {
    const primary = this.registry.getPrimary();
    const active = await this.registry.getActive();
    const secondaries = active.filter((a) => a.backendId !== primary.backendId);

    const primaryResult = await primary[method](...args);
    const replicationErrors = [];

    for (const adapter of secondaries) {
      try {
        await adapter[method](...args);
      } catch (error) {
        replicationErrors.push({
          backendId: adapter.backendId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.eventBus.publish({
      backendId: primary.backendId,
      changeType,
      resourceRef: primaryResult?.ref || primaryResult || null,
      timestamp: new Date().toISOString(),
      canonicalObject: method === 'delete' ? undefined : args[args.length - 1],
    });

    if (primaryResult && typeof primaryResult === 'object') {
      return { ...primaryResult, replicationErrors };
    }
    return { value: primaryResult, replicationErrors };
  }
}

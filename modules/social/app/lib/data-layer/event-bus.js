// lightweight async pub/sub bus for data change events

export class DataEventBus {
  constructor() {
    /** @type {Set<(event: any) => Promise<void>|void>} */
    this._subscribers = new Set();
  }

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => {
      this._subscribers.delete(callback);
    };
  }

  async publish(event) {
    await Promise.allSettled([...this._subscribers].map((cb) => cb(event)));
  }
}

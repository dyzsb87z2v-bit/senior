import { EventEmitter } from 'node:events';

/**
 * In-process event bus feeding the dashboard's Server-Sent Events stream.
 * One process serves the restaurant; for several instances, replace this
 * with Postgres LISTEN/NOTIFY or Redis pub/sub behind the same interface.
 */
export type LiveEvent = { type: 'order' | 'alert' | 'call' | 'menu' | 'customer' | 'settings'; action: 'create' | 'update' | 'delete'; id: string; data?: unknown };

export class LiveEvents {
  private emitter = new EventEmitter();
  constructor() { this.emitter.setMaxListeners(500); }
  publish(event: LiveEvent) { this.emitter.emit('event', event); }
  subscribe(listener: (e: LiveEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

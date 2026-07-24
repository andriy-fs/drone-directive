import type { GameEvents } from './events';

type Listener<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub (no dependencies). Engine systems/scenes `emit`; app-layer
 * adapters (audio, store-sync) `on`. `on` returns an unsubscribe function.
 */
export class EventBus<E> {
  private readonly listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    (this.listeners[type] ??= new Set()).add(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: Listener<E[K]>): void {
    this.listeners[type]?.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.listeners[type]?.forEach((fn) => fn(payload));
  }
}

export type GameBus = EventBus<GameEvents>;

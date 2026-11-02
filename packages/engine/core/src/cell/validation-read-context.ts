import type { CellStore } from './types';

// Synchronous, read-only validation scopes. Never retain a store between calls.
const active = new WeakMap<CellStore, Map<unknown, unknown>>();
export function withCellValidationReads<T>(store: CellStore, read: () => T): T {
  if (active.has(store)) return read();
  active.set(store, new Map());
  try {
    return read();
  } finally {
    active.delete(store);
  }
}

/** Reuse a pure lookup during validation; outside validation always read afresh. */
export function memoizeCellValidationRead<T>(
  store: CellStore,
  key: unknown,
  read: () => T,
  outsideRead: () => T = read,
): T {
  const cache = active.get(store);
  if (!cache) return outsideRead();
  if (!cache.has(key)) cache.set(key, read());
  return cache.get(key) as T;
}

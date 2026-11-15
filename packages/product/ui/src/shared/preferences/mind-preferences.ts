import { useSyncExternalStore } from 'react';
import { DEFAULT_MIND_MAX_WIDTH, validMindMaxWidth } from '@sue/board-mind';
export const mindPreferencesKey = 'verdboard.mind-settings';
export function readMindMaxWidth(): number {
  try {
    const value = JSON.parse(
      localStorage.getItem(mindPreferencesKey) ?? 'null',
    )?.maxNodeWidth;
    return validMindMaxWidth(value) ? value : DEFAULT_MIND_MAX_WIDTH;
  } catch {
    return DEFAULT_MIND_MAX_WIDTH;
  }
}
let snapshot: number | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const getSnapshot = () => (snapshot ??= readMindMaxWidth());
const onStorage = (event: StorageEvent) => {
  if (event.key === mindPreferencesKey || event.key === null) {
    snapshot = readMindMaxWidth();
    notify();
  }
};
const subscribe = (listener: () => void) => {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
};
export function setMindMaxWidth(value: number) {
  if (!validMindMaxWidth(value)) return;
  snapshot = value;
  try {
    localStorage.setItem(
      mindPreferencesKey,
      JSON.stringify({ maxNodeWidth: value }),
    );
  } catch {
    /* The in-memory preference remains usable. */
  }
  notify();
}
export const useMindMaxWidth = () =>
  useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MIND_MAX_WIDTH);

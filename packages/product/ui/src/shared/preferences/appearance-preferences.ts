import { useSyncExternalStore } from 'react';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';
export interface AppearanceState {
  preference: AppearancePreference;
  appearance: ResolvedAppearance;
}

export const appearancePreferencesKey = 'verdboard.appearance';
const serverSnapshot: AppearanceState = {
  preference: 'system',
  appearance: 'light',
};
const normalize = (value: unknown): AppearancePreference =>
  value === 'light' || value === 'dark' ? value : 'system';

export function readAppearancePreference(): AppearancePreference {
  try {
    return normalize(localStorage.getItem(appearancePreferencesKey));
  } catch {
    return 'system';
  }
}

let snapshot: AppearanceState | undefined;
let media: MediaQueryList | undefined;
let connections = 0;
let disconnect: (() => void) | undefined;
let memoryOnly = false;
const listeners = new Set<() => void>();
const systemMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;
const resolve = (preference: AppearancePreference): ResolvedAppearance =>
  preference === 'system'
    ? (media ?? systemMedia())?.matches
      ? 'dark'
      : 'light'
    : preference;
const getSnapshot = (): AppearanceState => {
  if (!snapshot) {
    const preference = readAppearancePreference();
    snapshot = { preference, appearance: resolve(preference) };
  }
  return snapshot;
};

const apply = () => {
  if (typeof document === 'undefined') return;
  const { appearance } = getSnapshot();
  document.documentElement.dataset['verdAppearance'] = appearance;
  document.documentElement.style.colorScheme = appearance;
};
const publish = (preference: AppearancePreference) => {
  const appearance = resolve(preference);
  const changed =
    snapshot?.preference !== preference || snapshot?.appearance !== appearance;
  snapshot = changed ? { preference, appearance } : snapshot;
  apply();
  if (changed) listeners.forEach((listener) => listener());
};

/** Call before mounting React. The returned cleanup releases this subscription. */
export function initializeAppearance(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    return () => undefined;
  if (connections++ === 0) {
    media = systemMedia();
    const query = media;
    const onSystemChange = () => publish(getSnapshot().preference);
    const onStorage = (event: StorageEvent) => {
      if (event.key === appearancePreferencesKey || event.key === null) {
        memoryOnly = false;
        publish(readAppearancePreference());
      }
    };
    query?.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    disconnect = () => {
      query?.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
      media = undefined;
    };
    publish(memoryOnly ? getSnapshot().preference : readAppearancePreference());
  } else apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--connections === 0) {
      disconnect?.();
      disconnect = undefined;
    }
  };
}

export function setAppearancePreference(preference: AppearancePreference) {
  const value = normalize(preference);
  try {
    localStorage.setItem(appearancePreferencesKey, value);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
    // Apply the preference in memory even when browser storage is unavailable.
  }
  publish(value);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const release = initializeAppearance();
  return () => {
    listeners.delete(listener);
    release();
  };
};

export const useAppearancePreference = (): AppearanceState =>
  useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);

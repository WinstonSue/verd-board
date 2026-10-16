import { useSyncExternalStore } from 'react';

export interface InteractionPreferences {
  smartGuides: boolean;
  zoomSensitivity: number;
  dragPanSpeed: number;
}

export const interactionPreferencesKey = 'verdboard.interaction-settings';
export const defaultInteractionPreferences: InteractionPreferences = {
  smartGuides: true,
  zoomSensitivity: 1,
  dragPanSpeed: 1,
};

const multiplier = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(3, Math.max(0.25, value))
    : 1;

export function readInteractionPreferences(): InteractionPreferences {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(interactionPreferencesKey) ?? 'null',
    );
    if (!stored || typeof stored !== 'object')
      return defaultInteractionPreferences;
    const values = stored as Record<string, unknown>;
    return {
      smartGuides:
        typeof values['smartGuides'] === 'boolean'
          ? values['smartGuides']
          : true,
      zoomSensitivity: multiplier(values['zoomSensitivity']),
      dragPanSpeed: multiplier(values['dragPanSpeed']),
    };
  } catch {
    return defaultInteractionPreferences;
  }
}

let snapshot: InteractionPreferences | undefined;
const listeners = new Set<() => void>();
const getSnapshot = () => (snapshot ??= readInteractionPreferences());
const notify = () => listeners.forEach((listener) => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key === interactionPreferencesKey || event.key === null) {
    snapshot = readInteractionPreferences();
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

export function setInteractionPreferences(
  values: Omit<InteractionPreferences, 'smartGuides'> &
    Partial<Pick<InteractionPreferences, 'smartGuides'>>,
) {
  snapshot = {
    smartGuides: values.smartGuides ?? getSnapshot().smartGuides,
    zoomSensitivity: multiplier(values['zoomSensitivity']),
    dragPanSpeed: multiplier(values['dragPanSpeed']),
  };
  try {
    localStorage.setItem(interactionPreferencesKey, JSON.stringify(snapshot));
  } catch {
    // Preferences still apply in memory when browser storage is unavailable.
  }
  notify();
}

export const useInteractionPreferences = () =>
  useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultInteractionPreferences,
  );

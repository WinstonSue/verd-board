import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let appearance: typeof import('./appearance-preferences');
let dark = false;
let target: EventTarget;
let query: MediaQueryList;
let releases: (() => void)[];
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.resetModules();
  localStorage.removeItem('verdboard.appearance');
  delete document.documentElement.dataset.verdAppearance;
  document.documentElement.style.colorScheme = '';
  dark = false;
  target = new EventTarget();
  query = {
    get matches() {
      return dark;
    },
    addEventListener: vi.fn(target.addEventListener.bind(target)),
    removeEventListener: vi.fn(target.removeEventListener.bind(target)),
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  appearance = await import('./appearance-preferences');
  releases = [];
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  releases.forEach((release) => release());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(appearance.appearancePreferencesKey);
  delete document.documentElement.dataset.verdAppearance;
  document.documentElement.style.colorScheme = '';
});

function initialize() {
  releases.push(appearance.initializeAppearance());
}
function Probe() {
  const state = appearance.useAppearancePreference();
  return <output>{`${state.preference}:${state.appearance}`}</output>;
}
async function mount() {
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
}
async function system(value: boolean) {
  await act(async () => {
    dark = value;
    target.dispatchEvent(new Event('change'));
  });
}
async function storage(
  value: string | null,
  key: string | null = appearance.appearancePreferencesKey,
) {
  if (value === null)
    localStorage.removeItem(appearance.appearancePreferencesKey);
  else localStorage.setItem(appearance.appearancePreferencesKey, value);
  await act(async () =>
    window.dispatchEvent(new StorageEvent('storage', { key })),
  );
}

it.each([null, '', 'invalid', '"dark"', '{}'])(
  'defaults missing or invalid preferences to system: %s',
  (value) => {
    if (value !== null)
      localStorage.setItem(appearance.appearancePreferencesKey, value);
    expect(appearance.readAppearancePreference()).toBe('system');
  },
);

it('applies the saved appearance before React mounts without writing storage', () => {
  localStorage.setItem(appearance.appearancePreferencesKey, 'dark');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  initialize();
  expect(document.documentElement.dataset.verdAppearance).toBe('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(write).not.toHaveBeenCalled();
});

it('follows system changes and updates subscribed settings without saving a preference', async () => {
  dark = true;
  initialize();
  await mount();
  expect(container.textContent).toBe('system:dark');
  await system(false);
  expect(container.textContent).toBe('system:light');
  expect(document.documentElement.dataset.verdAppearance).toBe('light');
  expect(localStorage.getItem(appearance.appearancePreferencesKey)).toBeNull();
});

it('persists manual choices, ignores system changes, and resumes following system', async () => {
  await mount();
  await act(async () => appearance.setAppearancePreference('dark'));
  expect(container.textContent).toBe('dark:dark');
  expect(localStorage.getItem(appearance.appearancePreferencesKey)).toBe(
    'dark',
  );
  await system(true);
  await system(false);
  expect(container.textContent).toBe('dark:dark');
  await act(async () => appearance.setAppearancePreference('light'));
  await system(true);
  expect(container.textContent).toBe('light:light');
  await act(async () => appearance.setAppearancePreference('system'));
  expect(container.textContent).toBe('system:dark');
});

it('synchronizes other windows, ignores unrelated storage, and handles clearing or invalidating preferences', async () => {
  await mount();
  await storage('dark');
  expect(container.textContent).toBe('dark:dark');
  await storage('light', 'language');
  expect(container.textContent).toBe('dark:dark');
  await system(true);
  await storage('invalid');
  expect(container.textContent).toBe('system:dark');
  await storage('light');
  expect(container.textContent).toBe('light:light');
  await storage(null, null);
  expect(container.textContent).toBe('system:dark');
});

it('keeps choices in memory when storage reads and writes are unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  expect(appearance.readAppearancePreference()).toBe('system');
  await mount();
  await act(async () => appearance.setAppearancePreference('dark'));
  expect(container.textContent).toBe('dark:dark');
  initialize();
  await system(false);
  expect(container.textContent).toBe('dark:dark');
});

it('shares listeners across canvases and releases them only after the last subscriber', () => {
  const first = appearance.initializeAppearance();
  const second = appearance.initializeAppearance();
  expect(query.addEventListener).toHaveBeenCalledTimes(1);
  first();
  first();
  expect(query.removeEventListener).not.toHaveBeenCalled();
  second();
  expect(query.removeEventListener).toHaveBeenCalledTimes(1);
  initialize();
  expect(query.addEventListener).toHaveBeenCalledTimes(2);
});

it('uses light when the system appearance API is unavailable', () => {
  vi.stubGlobal('matchMedia', undefined);
  initialize();
  expect(document.documentElement.dataset.verdAppearance).toBe('light');
});

it('reads changes made while no component was subscribed', () => {
  const release = appearance.initializeAppearance();
  release();
  localStorage.setItem(appearance.appearancePreferencesKey, 'dark');
  initialize();
  expect(document.documentElement.dataset.verdAppearance).toBe('dark');
});

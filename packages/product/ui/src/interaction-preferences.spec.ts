import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultInteractionPreferences,
  interactionPreferencesKey,
  readInteractionPreferences,
  setInteractionPreferences,
} from './interaction-preferences';

afterEach(() => {
  localStorage.removeItem(interactionPreferencesKey);
  vi.restoreAllMocks();
});

describe('device interaction preferences', () => {
  it.each([null, '{broken', 'null', '42', '"text"'])(
    'uses defaults for missing or invalid stored data: %s',
    (value) => {
      if (value !== null)
        localStorage.setItem(interactionPreferencesKey, value);
      expect(readInteractionPreferences()).toEqual(
        defaultInteractionPreferences,
      );
    },
  );
  it('validates each setting independently and clamps numeric values', () => {
    localStorage.setItem(
      interactionPreferencesKey,
      JSON.stringify({ zoomSensitivity: 0, dragPanSpeed: 20 }),
    );
    expect(readInteractionPreferences()).toEqual({
      smartGuides: true,
      zoomSensitivity: 0.25,
      dragPanSpeed: 3,
    });
    localStorage.setItem(
      interactionPreferencesKey,
      JSON.stringify({ zoomSensitivity: '2', dragPanSpeed: 1.5 }),
    );
    expect(readInteractionPreferences()).toEqual({
      smartGuides: true,
      zoomSensitivity: 1,
      dragPanSpeed: 1.5,
    });
  });
  it('stores interaction settings separately from language and resets only speeds', () => {
    localStorage.setItem('language', 'en');
    setInteractionPreferences({ zoomSensitivity: 2, dragPanSpeed: 0.5 });
    expect(readInteractionPreferences()).toEqual({
      smartGuides: true,
      zoomSensitivity: 2,
      dragPanSpeed: 0.5,
    });
    setInteractionPreferences(defaultInteractionPreferences);
    expect(readInteractionPreferences()).toEqual(defaultInteractionPreferences);
    expect(localStorage.getItem('language')).toBe('en');
    localStorage.removeItem('language');
  });
  it('falls back safely when storage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(readInteractionPreferences()).toEqual(defaultInteractionPreferences);
    expect(() =>
      setInteractionPreferences({ zoomSensitivity: 2, dragPanSpeed: 2 }),
    ).not.toThrow();
  });
});

it('keeps smart guides disabled when restoring only the interaction speeds', () => {
  setInteractionPreferences({
    zoomSensitivity: 2,
    dragPanSpeed: 0.5,
    smartGuides: false,
  });
  setInteractionPreferences({ zoomSensitivity: 1, dragPanSpeed: 1 });
  expect(readInteractionPreferences()).toEqual({
    zoomSensitivity: 1,
    dragPanSpeed: 1,
    smartGuides: false,
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  mindPreferencesKey,
  readMindMaxWidth,
  setMindMaxWidth,
} from './mind-preferences';
beforeEach(() => localStorage.removeItem(mindPreferencesKey));
describe('Mind width preference', () => {
  it('defaults to 240 and rejects corrupt or out-of-range stored values', () => {
    expect(readMindMaxWidth()).toBe(240);
    for (const value of [
      'broken',
      '{"maxNodeWidth":0}',
      '{"maxNodeWidth":240.5}',
      '{"maxNodeWidth":"400"}',
      'null',
    ]) {
      localStorage.setItem(mindPreferencesKey, value);
      expect(readMindMaxWidth()).toBe(240);
    }
  });
  it('persists valid widths without touching interaction preferences', () => {
    localStorage.setItem(
      'verdboard.interaction-settings',
      '{"zoomSensitivity":2}',
    );
    setMindMaxWidth(320);
    expect(readMindMaxWidth()).toBe(320);
    setMindMaxWidth(5);
    expect(readMindMaxWidth()).toBe(320);
    expect(localStorage.getItem('verdboard.interaction-settings')).toBe(
      '{"zoomSensitivity":2}',
    );
  });
});

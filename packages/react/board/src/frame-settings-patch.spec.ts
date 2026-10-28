import { describe, expect, it } from 'vitest';
import { mergeSettingsPatch } from './frame-settings-patch';

describe('host settings patches', () => {
  it('preserves concurrent nested fields and applies only the requested edit', () => {
    const before = { geometry: { x: 10, width: 100 }, data: { label: 'old' } };
    const proposed = {
      ...before,
      geometry: { ...before.geometry, width: 200 },
    };
    const latest = { geometry: { x: 30, width: 100 }, data: { label: 'new' } };
    expect(mergeSettingsPatch(before, proposed, latest)).toEqual({
      geometry: { x: 30, width: 200 },
      data: { label: 'new' },
    });
    expect(latest.geometry.width).toBe(100);
  });
  it('clears an explicit override without dropping unrelated new values', () => {
    const before: Record<string, unknown> = { width: 240, color: 'blue' };
    expect(
      mergeSettingsPatch(
        before,
        { color: 'blue' },
        { ...before, opacity: 0.5 },
      ),
    ).toEqual({ color: 'blue', opacity: 0.5 });
  });
});

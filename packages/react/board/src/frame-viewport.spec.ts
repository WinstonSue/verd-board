import { describe, expect, it } from 'vitest';
import { interpolateViewport, viewportForBounds } from './frame-viewport';

describe('presentation viewport', () => {
  it('fits a wide overview below the editor minimum zoom', () => {
    const viewport = viewportForBounds(
      { x: 0, y: 0, width: 20000, height: 11250 },
      { width: 1600, height: 900 },
      undefined,
      { minZoom: 0.01, maxZoom: 8 },
    );
    expect(viewport.zoom).toBeLessThan(0.1);
    expect(viewport.zoom).toBeCloseTo(1600 / 20000);
  });

  it('starts and ends an eased camera move on the requested viewports', () => {
    const from = { zoom: 1, origination: [0, 0] as [number, number] };
    const to = { zoom: 2, origination: [40, 10] as [number, number] };
    expect(interpolateViewport(from, to, 0).zoom).toBe(1);
    expect(interpolateViewport(from, to, 1)).toEqual(to);
  });
});

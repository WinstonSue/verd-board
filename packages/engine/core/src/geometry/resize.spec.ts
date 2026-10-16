import { describe, expect, it } from 'vitest';
import { resizeNodeGeometry, rotateNodeGeometry } from './resize';
import { relativeAnchor } from './edge';
describe('native geometry editing', () => {
  const box = { x: 100, y: 50, width: 160, height: 100 };
  it('keeps the opposite corner fixed for rotated and unrotated nodes', () => {
    for (const rotation of [0, Math.PI / 2, 0.8]) {
      const original = { ...box, rotation },
        opposite = relativeAnchor(original, [1, 1]);
      const resized = resizeNodeGeometry(original, 'nw', [-30, -40]);
      const result = relativeAnchor(resized, [1, 1]);
      expect(result[0]).toBeCloseTo(opposite[0]);
      expect(result[1]).toBeCloseTo(opposite[1]);
      expect(resized.width).toBeGreaterThan(0);
      expect(resized.height).toBeGreaterThan(0);
    }
  });
  it('supports ratio locking, centered resizing and side handles with minimum bounds', () => {
    const ratio = resizeNodeGeometry(box, 'se', [80, 20], {
      preserveRatio: true,
    });
    expect(ratio.width / ratio.height).toBeCloseTo(1.6);
    const centered = resizeNodeGeometry(box, 'e', [30, 0], {
      fromCenter: true,
    });
    expect(centered).toMatchObject({ x: 70, y: 50, width: 220, height: 100 });
    expect(resizeNodeGeometry(box, 'w', [1000, 0])).toMatchObject({
      x: 252,
      width: 8,
    });
  });
  it('rotates about the center with optional fifteen degree snapping', () => {
    const rotated = rotateNodeGeometry(box, [180, 20], [230, 100]);
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotated).toMatchObject(box);
    const snapped = rotateNodeGeometry(box, [180, 20], [230, 120], true);
    expect(snapped.rotation! / (Math.PI / 12)).toBeCloseTo(
      Math.round(snapped.rotation! / (Math.PI / 12)),
    );
  });
});

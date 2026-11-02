import { expect, it } from 'vitest';
import { createSpatialIndex } from './spatial-index';
it('matches a linear broad phase on five thousand and ten thousand entries', () => {
  for (const count of [5000, 10000]) {
    const entries = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      x: (i % 100) * 40,
      y: Math.floor(i / 100) * 40,
      width: 20,
      height: 20,
    }));
    const index = createSpatialIndex(entries);
    for (const box of [
      { x: 200, y: 200, width: 80, height: 80 },
      { x: -100, y: -100, width: 110, height: 110 },
    ]) {
      const expected = entries
        .filter(
          (e) =>
            e.x <= box.x + box.width &&
            e.x + e.width >= box.x &&
            e.y <= box.y + box.height &&
            e.y + e.height >= box.y,
        )
        .map((e) => e.id)
        .sort();
      expect(index.query(box).sort()).toEqual(expected);
    }
  }
});
it('handles long edges, touching boundaries and invalid entries', () => {
  const index = createSpatialIndex([
    { id: 'edge', x: -1000, y: 0, width: 2000, height: 0 },
    { id: 'invalid', x: NaN, y: 0, width: 1, height: 1 },
  ]);
  expect(index.query({ x: 0, y: 0, width: 0, height: 0 })).toEqual(['edge']);
});

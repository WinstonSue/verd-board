import { layoutDag } from './dag-layout';
import { describe, expect, it } from 'vitest';

describe('layoutDag', () => {
  const nodes = [
    { id: 'start', width: 120, height: 48 },
    { id: 'a', width: 160, height: 72 },
    { id: 'b', width: 160, height: 72 },
  ];
  const edges = [
    { source: 'start', target: 'a' },
    { source: 'a', target: 'b' },
  ];

  it('is deterministic for the same graph', () => {
    const first = layoutDag(nodes, edges, { direction: 'LR' });
    const second = layoutDag([...nodes].reverse(), [...edges].reverse(), {
      direction: 'LR',
    });
    expect(first.positions).toEqual(second.positions);
  });

  it('supports four directions', () => {
    const lr = layoutDag(nodes, edges, { direction: 'LR' });
    const rl = layoutDag(nodes, edges, { direction: 'RL' });
    const tb = layoutDag(nodes, edges, { direction: 'TB' });
    const bt = layoutDag(nodes, edges, { direction: 'BT' });
    expect(lr.positions.start[0]).toBeLessThan(lr.positions.b[0]);
    expect(rl.positions.start[0]).toBeGreaterThan(rl.positions.b[0]);
    expect(tb.positions.start[1]).toBeLessThan(tb.positions.b[1]);
    expect(bt.positions.start[1]).toBeGreaterThan(bt.positions.b[1]);
  });

  it.each(['LR', 'RL', 'TB', 'BT'] as const)(
    'separates arbitrary node sizes and reports their complete bounds in %s',
    (direction) => {
      const sized = [
        { id: 'start', width: 400, height: 180 },
        { id: 'a', width: 250, height: 300 },
        { id: 'b', width: 600, height: 220 },
      ];
      const result = layoutDag(sized, edges, { direction, rankSep: 50 });
      const major = direction === 'LR' || direction === 'RL' ? 0 : 1;
      const dimension = major === 0 ? 'width' : 'height';
      for (const [source, target] of [
        [sized[0], sized[1]],
        [sized[1], sized[2]],
      ]) {
        const s = result.positions[source.id][major],
          t = result.positions[target.id][major];
        expect(
          direction === 'LR' || direction === 'TB'
            ? t - s - source[dimension]
            : s - t - target[dimension],
        ).toBe(50);
      }
      expect(result.width).toBe(
        Math.max(
          ...sized.map((node) => result.positions[node.id][0] + node.width),
        ),
      );
      expect(result.height).toBe(
        Math.max(
          ...sized.map((node) => result.positions[node.id][1] + node.height),
        ),
      );
      expect(layoutDag([], [], { direction })).toEqual({
        positions: {},
        width: 0,
        height: 0,
      });
    },
  );
});

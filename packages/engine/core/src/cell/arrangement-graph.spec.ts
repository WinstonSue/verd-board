import { describe, expect, it } from 'vitest';
import { graphArrangementPositions } from './arrangement-graph';

const node = (id: string, width = 80, height = 40) => ({
  id,
  bounds: { width, height },
});
const links = (pairs: string[][]) =>
  pairs.map(([source, target]) => ({ source, target }));

describe('graph arrangement', () => {
  it('removes crossings in both directions instead of retaining alphabetical columns', () => {
    const positions = graphArrangementPositions(
      [
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
      ].map((row) => row.map((id) => node(id))),
      links([
        ['a', 'd'],
        ['b', 'c'],
        ['c', 'f'],
        ['d', 'e'],
      ]),
    );
    const x = (id: string) => positions.get(id)![0];
    expect((x('a') - x('b')) * (x('d') - x('c'))).toBeGreaterThan(0);
    expect((x('c') - x('d')) * (x('f') - x('e'))).toBeGreaterThan(0);
    expect(x('a')).toBe(x('d'));
    expect(x('d')).toBe(x('e'));
  });

  it('includes skip-rank connections in ordering without producing persisted virtual nodes', () => {
    const positions = graphArrangementPositions(
      [['a', 'b'], ['c'], ['d', 'e']].map((row) => row.map((id) => node(id))),
      links([
        ['a', 'e'],
        ['b', 'd'],
      ]),
    );
    expect(positions.size).toBe(5);
    expect(
      (positions.get('a')![0] - positions.get('b')![0]) *
        (positions.get('e')![0] - positions.get('d')![0]),
    ).toBeGreaterThan(0);
  });

  it('uses actual widths, centers forks and keeps tall ranks separated', () => {
    const positions = graphArrangementPositions(
      [[node('start', 120, 88)], [node('left', 300), node('right', 80)]],
      links([
        ['start', 'left'],
        ['start', 'right'],
      ]),
    );
    const left = positions.get('left')!,
      right = positions.get('right')!;
    expect(right[0] - left[0] - 300).toBe(48);
    expect(positions.get('start')![0] + 60).toBe(
      (left[0] + 150 + right[0] + 40) / 2,
    );
    expect(left[1]).toBe(88 + 96);
  });

  it('is independent of insertion order and the initial positions', () => {
    const rows = [
      [node('a'), node('b')],
      [node('c', 100), node('d')],
      [node('e')],
    ];
    const edges = links([
      ['a', 'd'],
      ['b', 'c'],
      ['a', 'e'],
      ['c', 'e'],
    ]);
    const sorted = (map: Map<string, [number, number]>) => [...map].sort();
    expect(sorted(graphArrangementPositions(rows, edges))).toEqual(
      sorted(
        graphArrangementPositions(
          rows.map((row) => [...row].reverse()),
          [...edges].reverse(),
        ),
      ),
    );
  });
});

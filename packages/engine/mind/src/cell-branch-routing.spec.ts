import { describe, expect, it } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  portAnchor,
  terminalCurvePath,
  type EdgeCell,
  type NodeCell,
  type Point,
} from '@sue/board-core';
import { createInlineText } from '@sue/board-common';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
} from './cell-commands';
import { layoutMindCells, registerMindCells } from './cell-utils';
import { mindBranchPorts } from './cell-link';

const sample = (path: string): Point[] => {
  const p = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  return Array.from({ length: 101 }, (_, at) => {
    const t = at / 100,
      u = 1 - t;
    return [0, 1].map(
      (axis) =>
        u ** 3 * p[axis] +
        3 * u ** 2 * t * p[axis + 2] +
        3 * u * t ** 2 * p[axis + 4] +
        t ** 3 * p[axis + 6],
    ) as Point;
  });
};
describe('dense mind branch geometry', () => {
  it('keeps nine mixed-height siblings ordered in all facing layouts and preserves all nine layouts', () => {
    const registry = createCellRegistry();
    registerMindCells(registry);
    const r = createCellRuntime(
      createMindFrameSnapshot('frame', 'root'),
      registry,
    );
    for (let i = 0; i < 9; i++) {
      const child = createMindChildCell(`child-${i}`);
      if (i === 4 || i === 5)
        child.data = {
          note: createInlineText(i === 4 ? '22222' : '3333'),
          noteCollapsed: false,
        };
      if (i === 8)
        child.data = { image: { url: 'test.png', width: 120, height: 60 } };
      r.transact({
        id: `add-${i}`,
        operations: addMindChild(r.store, 'root', child, `edge-${i}`),
      });
    }
    for (const layout of [
      'right',
      'left',
      'upward',
      'downward',
      'standard',
      'right-top-indented',
      'right-bottom-indented',
      'left-top-indented',
      'left-bottom-indented',
    ]) {
      r.transact({
        id: layout,
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...r.store.cells.root,
              data: { layout, branchShape: 'bight' },
            },
          },
        ],
      });
      const before = structuredClone(r.store),
        geometry = layoutMindCells(r.store, 'frame');
      const groups = new Map<string, { offset: number; points: Point[] }[]>();
      for (let i = 0; i < 9; i++) {
        const edge = r.store.cells[`edge-${i}`] as EdgeCell;
        const ports = mindBranchPorts(r.store, edge)!;
        const source = portAnchor(geometry.get('root')!, ports.source),
          target = portAnchor(geometry.get(`child-${i}`)!, ports.target);
        const points = sample(terminalCurvePath(source, target));
        expect(points[0]).toEqual(source.point);
        expect(points.at(-1)).toEqual(target.point);
        expect(points.flat().every(Number.isFinite)).toBe(true);
        if (layout.includes('indented')) continue;
        const vertical = source.side === 'top' || source.side === 'bottom',
          axis = vertical ? 1 : 0;
        const sign =
          source.side === 'right' || source.side === 'bottom' ? 1 : -1;
        points.forEach((point, at) => {
          expect(
            (point[axis] - source.point[axis]) * sign,
          ).toBeGreaterThanOrEqual(-1e-8);
          expect(
            (target.point[axis] - point[axis]) * sign,
          ).toBeGreaterThanOrEqual(-1e-8);
          if (at)
            expect(
              (point[axis] - points[at - 1][axis]) * sign,
            ).toBeGreaterThanOrEqual(-1e-8);
          // Real measured node rectangles, including expanded notes and media.
          for (let other = 0; other < 9; other++)
            if (other !== i) {
              const g = geometry.get(`child-${other}`)!;
              expect(
                point[0] > g.x + 1e-8 &&
                  point[0] < g.x + g.width - 1e-8 &&
                  point[1] > g.y + 1e-8 &&
                  point[1] < g.y + g.height - 1e-8,
              ).toBe(false);
            }
        });
        const siblings = groups.get(source.side) ?? [];
        siblings.push({ offset: target.point[1 - axis], points });
        groups.set(source.side, siblings);
      }
      for (const [side, siblings] of groups) {
        const axis = side === 'top' || side === 'bottom' ? 0 : 1;
        siblings.sort((a, b) => a.offset - b.offset);
        for (let i = 1; i < siblings.length; i++)
          for (let at = 1; at <= 100; at++)
            expect(siblings[i].points[at][axis]).toBeGreaterThan(
              siblings[i - 1].points[at][axis],
            );
      }
      expect(r.store).toEqual(before);
      expect((r.store.cells['child-4'] as NodeCell).data).toMatchObject({
        noteCollapsed: false,
      });
    }
  });
});

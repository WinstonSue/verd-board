import { describe, expect, it } from 'vitest';
import { applyCellOperations } from './index';
import { createCellStore, createFrameCell } from './types';
import {
  convertFramePoint,
  fitFrameContent,
  frameContentBounds,
  frameContentViewport,
  frameTitleBounds,
  parentToFramePoint,
} from './frame';

describe('frame content coordinates', () => {
  it('contains the title and content in the outer shell without extending its bounds', () => {
    const nested = createFrameCell('nested', {
      x: 40,
      y: 50,
      width: 400,
      height: 300,
    });
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [{ type: 'insert_cell', parentId: 'root', cell: nested }],
    );
    expect(frameContentBounds(store, 'root')).toEqual({
      x: 40,
      y: 50,
      width: 400,
      height: 300,
    });
    expect(frameTitleBounds(nested.geometry)).toEqual({
      x: 56,
      y: 66,
      width: 368,
      height: 24,
    });
    const viewport = frameContentViewport(nested.geometry);
    expect(viewport).toEqual({ x: 56, y: 98, width: 368, height: 236 });
    const fitted = fitFrameContent(nested, {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
    expect(fitted.scale).toBe(0.236);
    expect(fitted.offset[1]).toBe(viewport.y);
    expect(store.cells.nested).toEqual(nested);
  });

  it('safely collapses the content viewport of legacy small shells', () => {
    const geometry = { x: 10, y: 20, width: 8, height: 12 };
    expect(frameTitleBounds(geometry)).toEqual({
      x: 14,
      y: 26,
      width: 0,
      height: 0,
    });
    expect(frameContentViewport(geometry)).toEqual({
      x: 14,
      y: 32,
      width: 0,
      height: 0,
    });
  });

  it('converts through centered nested shells and round trips without moving content', () => {
    const outer = createFrameCell('outer', {
      x: 200,
      y: 100,
      width: 200,
      height: 140,
    });
    const inner = createFrameCell('inner', {
      x: 40,
      y: 50,
      width: 400,
      height: 300,
    });
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        { type: 'insert_cell', cell: outer, parentId: 'root' },
        { type: 'insert_cell', cell: inner, parentId: 'outer' },
        {
          type: 'insert_cell',
          parentId: 'inner',
          cell: {
            id: 'n',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: -80, y: -20, width: 800, height: 600 },
          },
        },
      ],
    );
    const global = convertFramePoint(store, [20, 30], 'inner', 'root');
    const restored = convertFramePoint(store, global, 'root', 'inner');
    expect(restored[0]).toBeCloseTo(20);
    expect(restored[1]).toBeCloseTo(30);
    expect(store.cells.n).toMatchObject({
      geometry: { x: -80, y: -20, width: 800, height: 600 },
    });
  });
  it('includes free arrows and their control points in fit bounds', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'e',
            kind: 'arrow',
            cellType: 'edge',
            source: { point: [-20, 30] },
            target: { point: [80, 70] },
            route: {
              mode: 'fixed',
              points: [
                [-20, 30],
                [40, -50],
                [80, 70],
              ],
            },
          },
        },
      ],
    );
    expect(frameContentBounds(store, 'root')).toEqual({
      x: -20,
      y: -50,
      width: 100,
      height: 120,
    });
  });
  it('rejects inverse transforms of collapsed shells', () => {
    const transform = fitFrameContent(
      createFrameCell('f', { x: 0, y: 0, width: 0, height: 0 }),
      { x: 0, y: 0, width: 100, height: 100 },
    );
    expect(() => parentToFramePoint([0, 0], transform)).toThrow('invertible');
  });
});

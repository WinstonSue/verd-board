import { describe, expect, it } from 'vitest';
import {
  CellKind,
  createFrameCell,
  type Cell,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import {
  clampPresentationIndex,
  hasVisibleContent,
  presentationMindIds,
  presentationSteps,
  presentationTargetIds,
} from './presentation-targets';

const node = (
  id: string,
  kind: string = CellKind.mindChild,
  data?: unknown,
): NodeCell => ({
  id,
  kind,
  cellType: 'node',
  data,
  geometry: { x: 0, y: 0, width: 100, height: 40 },
});
const branch = (source: string, target: string, order = '0'): EdgeCell => ({
  id: `${source}-${target}`,
  cellType: 'edge',
  kind: CellKind.mindBranch,
  source: { cellId: source },
  target: { cellId: target },
  route: { mode: 'auto' },
  data: { order },
});
const storeOf = (...cells: Cell[]): CellStore => ({
  rootId: 'frame',
  cells: Object.fromEntries([
    [
      'frame',
      {
        ...createFrameCell('frame'),
        children: cells
          .filter((cell) => cell.cellType !== 'group')
          .map((cell) => cell.id),
        groups: cells
          .filter((cell) => cell.cellType === 'group')
          .map((cell) => cell.id),
      },
    ],
    ...cells.map((cell) => [cell.id, cell]),
  ]),
});
const summary = (
  id: string,
  parent: string,
  start: string,
  end: string,
): Cell[] => [
  node(id, CellKind.mindSummary),
  {
    ...branch(parent, id),
    kind: CellKind.mindSummaryEdge,
    data: { startSiblingId: start, endSiblingId: end },
  },
];

const multiRoot = () =>
  storeOf(
    node('root-z', CellKind.mindRoot),
    node('root-a', CellKind.mindRoot),
    node('b'),
    node('a'),
    node('c'),
    node('grandchild'),
    branch('root-z', 'b', '20'),
    branch('root-z', 'a', '10'),
    branch('root-a', 'c'),
    branch('a', 'grandchild'),
  );

describe('presentation targets', () => {
  it('does not count leftover relationship edges when the sole root is hidden', () => {
    const store = storeOf(
      { ...node('root', CellKind.mindRoot), hidden: true },
      node('a'),
      branch('root', 'a'),
      ...summary('summary', 'root', 'a', 'a'),
    );
    expect(hasVisibleContent(store)).toBe(false);
    expect(presentationSteps(store, 'frame', 'mind')).toEqual([]);
    expect(presentationTargetIds(store, 'frame', 'root-a')).toEqual([]);
    store.cells.root.hidden = false;
    (store.cells.root as NodeCell).data = { collapsed: true };
    expect(hasVisibleContent(store)).toBe(true);
    expect(presentationTargetIds(store, 'frame', 'root-a')).toEqual([]);
  });

  it('steps through first branches of every root in frame and mindChildIds order, without root steps', () => {
    expect(presentationSteps(multiRoot(), 'frame', 'mind')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('omits hidden roots/branches and descendants of hidden or collapsed topics', () => {
    const store = multiRoot();
    store.cells['root-a'].hidden = true;
    store.cells.b.hidden = true;
    (store.cells.a as NodeCell).data = { collapsed: true };
    expect(presentationSteps(store, 'frame', 'mind')).toEqual(['a']);
    expect(presentationTargetIds(store, 'frame', 'root-z')).toEqual([
      'root-z',
      'a',
    ]);
    expect(presentationTargetIds(store, 'frame', 'grandchild')).toEqual([]);
    expect(presentationTargetIds(store, 'frame', 'c')).toEqual([]);
  });

  it('includes complete visible summaries and summaries under summary topics', () => {
    const store = storeOf(
      node('root', CellKind.mindRoot),
      node('a'),
      node('b'),
      node('c'),
      node('d'),
      branch('root', 'a'),
      branch('a', 'b'),
      branch('a', 'c'),
      ...summary('s', 'a', 'b', 'c'),
      branch('s', 'd'),
      ...summary('s2', 's', 'd', 'd'),
      ...summary('outside', 'root', 'a', 'root'),
    );
    expect(presentationTargetIds(store, 'frame', 'a')).toEqual([
      'a',
      'b',
      'c',
      's',
      'd',
      's2',
    ]);
    (store.cells.a as NodeCell).data = { collapsed: true };
    expect(presentationTargetIds(store, 'frame', 'a')).toEqual(['a']);
    expect(presentationTargetIds(store, 'frame', 's')).toEqual([]);
  });

  it('filters hidden summary nodes and hidden summary edges', () => {
    const store = storeOf(
      node('root', CellKind.mindRoot),
      node('a'),
      branch('root', 'a'),
      ...summary('s', 'root', 'a', 'a'),
    );
    store.cells.s.hidden = true;
    expect(presentationMindIds(store, 'root')).toEqual(['root', 'a']);
    store.cells.s.hidden = false;
    store.cells['root-s'].hidden = true;
    expect(presentationMindIds(store, 'root')).toEqual(['root', 'a']);
  });

  it('focuses the outermost group and omits invisible members', () => {
    const store = storeOf(
      node('a', 'rectangle'),
      node('b', 'rectangle'),
      { ...node('hidden', 'rectangle'), hidden: true },
      {
        id: 'inner',
        cellType: 'group',
        kind: 'group',
        members: ['a', 'hidden'],
      },
      {
        id: 'outer',
        cellType: 'group',
        kind: 'group',
        members: ['inner', 'b'],
      },
    );
    expect(presentationTargetIds(store, 'frame', 'a')).toEqual(['a', 'b']);
    expect(presentationTargetIds(store, 'frame', 'inner')).toEqual(['a', 'b']);
    store.cells.outer.hidden = true;
    expect(presentationTargetIds(store, 'frame', 'a')).toEqual([]);
    expect(hasVisibleContent(store)).toBe(false);
  });

  it('fits an ungrouped edge with its mounted endpoints, and point edges by themselves', () => {
    const edge = { ...branch('a', 'b'), kind: 'arrow' };
    const store = storeOf(node('a', 'rectangle'), node('b', 'rectangle'), edge);
    expect(presentationTargetIds(store, 'frame', edge.id)).toEqual([
      edge.id,
      'a',
      'b',
    ]);
    store.cells.b.hidden = true;
    expect(presentationTargetIds(store, 'frame', edge.id)).toEqual([
      edge.id,
      'a',
    ]);
    store.cells[edge.id] = {
      ...edge,
      source: { point: [0, 0] },
      target: { point: [100, 50] },
    };
    expect(presentationTargetIds(store, 'frame', edge.id)).toEqual([edge.id]);
  });

  it('uses architecture layout order with stable ties and focuses layer members', () => {
    const store = storeOf(
      node('z', CellKind.architectureLayer, {
        order: '20',
        memberIds: ['module'],
      }),
      node('a', CellKind.architectureLayer, { order: '10', memberIds: [] }),
      node('tie', CellKind.architectureLayer, { order: '10', memberIds: [] }),
      {
        ...node('hidden', CellKind.architectureLayer, {
          order: '00',
          memberIds: [],
        }),
        hidden: true,
      },
      node('module', CellKind.architectureModule),
    );
    expect(presentationSteps(store, 'frame', 'architecture')).toEqual([
      'a',
      'tie',
      'z',
    ]);
    expect(presentationTargetIds(store, 'frame', 'z')).toEqual(['z', 'module']);
  });

  it('has no whiteboard/workflow steps and does not mutate the snapshot', () => {
    const store = multiRoot();
    const before = JSON.stringify(store);
    expect(presentationSteps(store, 'frame', 'whiteboard')).toEqual([]);
    expect(presentationSteps(store, 'frame', 'workflow')).toEqual([]);
    expect(presentationTargetIds(store, 'frame', 'missing')).toEqual([]);
    expect(hasVisibleContent(store, 'missing')).toBe(false);
    expect(presentationSteps(store, 'missing', 'mind')).toEqual([]);
    expect(JSON.stringify(store)).toBe(before);
  });

  it('clamps overview and navigation instead of wrapping', () => {
    expect(clampPresentationIndex(-1, 3)).toBe(0);
    expect(clampPresentationIndex(4, 3)).toBe(3);
    expect(clampPresentationIndex(1, 0)).toBe(0);
  });
});

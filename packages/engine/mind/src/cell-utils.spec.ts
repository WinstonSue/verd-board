import { describe, expect, it } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  type EdgeCell,
  type NodeCell,
  type MindSummaryData,
  type MindChildData,
} from '@sue/board-core';
import {
  registerMindCells,
  layoutMindCells,
  mindChildIds,
  MindChildNodeUtil,
} from './cell-utils';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
  reparentMindChild,
  createMindSummary,
  createMindSummaries,
  setMindSummaryRange,
} from './cell-commands';
import { mindBranchPorts, resolvedMindBranchShape } from './cell-link';
import { mindPresentation } from './cell-theme';
import { ThemeColorMode } from '@sue/board-core';
import { createInlineText, reviseBoardText } from '@sue/board-common';
import { mindSummaryGeometry } from './cell-summary';
const runtime = () => {
  const registry = createCellRegistry();
  registerMindCells(registry);
  const r = createCellRuntime(
    createMindFrameSnapshot('frame', 'root'),
    registry,
  );
  for (const id of ['a', 'b', 'c'])
    r.transact({
      id,
      operations: addMindChild(
        r.store,
        'root',
        createMindChildCell(id),
        `e-${id}`,
      ),
    });
  return r;
};
describe('native mind rules', () => {
  it('inherits child and sibling styling while keeping media and layout independent', () => {
    const r = runtime(),
      a = r.store.cells.a as NodeCell;
    const styled: NodeCell<MindChildData> = {
      ...a,
      geometry: { ...a.geometry, outline: 'underline' },
      appearance: {
        fill: '#ffff00',
        strokeColor: '#ff0000',
        strokeWidth: 3,
        strokeStyle: 'dashed',
      },
      data: {
        layout: 'upward',
        image: { url: 'media.png', width: 100, height: 50 },
        branchAppearance: {
          strokeColor: '#00ff00',
          strokeWidth: 5,
          strokeStyle: 'dotted',
        },
        branchShape: 'polyline',
      },
    };
    r.transact({
      id: 'style',
      operations: [{ type: 'replace_cell', cell: styled }],
    });
    r.transact({
      id: 'child',
      operations: addMindChild(
        r.store,
        'a',
        createMindChildCell('child'),
        'child-edge',
      ),
    });
    const child = r.store.cells.child as NodeCell<MindChildData>;
    expect(child.appearance).toEqual(styled.appearance);
    expect(child.geometry.outline).toBe('underline');
    expect(child.data?.layout).toBeUndefined();
    expect(child.data?.image).toBeUndefined();
    expect(child.data?.branchShape).toBe('polyline');
    expect((r.store.cells['child-edge'] as EdgeCell).appearance).toEqual(
      styled.data?.branchAppearance,
    );
    let sequence = 0;
    r.transact({
      id: 'sibling',
      operations: new MindChildNodeUtil().keyboard(
        r.store,
        styled,
        'Enter',
        () => `sibling-${++sequence}`,
      )!,
    });
    expect((r.store.cells['sibling-1'] as NodeCell).appearance).toEqual(
      styled.appearance,
    );
    const custom = {
      ...createMindChildCell('custom'),
      geometry: { ...child.geometry, outline: 'ellipse' },
      appearance: { fill: '#0000ff' },
      data: { branchAppearance: { strokeWidth: 1 }, branchShape: 'bight' },
    };
    r.transact({
      id: 'custom',
      operations: addMindChild(r.store, 'a', custom, 'custom-edge'),
    });
    const override = r.store.cells.custom as NodeCell<MindChildData>;
    expect(override.appearance?.fill).toBe('#0000ff');
    expect(override.appearance?.strokeColor).toBe('#ff0000');
    expect(override.geometry.outline).toBe('ellipse');
    expect(override.data?.branchAppearance).toEqual({
      strokeColor: '#00ff00',
      strokeWidth: 1,
      strokeStyle: 'dotted',
    });
    expect(override.data?.branchShape).toBe('bight');
    expect((r.store.cells.b as NodeCell).appearance?.fill).toBeUndefined();
  });
  it.each(['right', 'left', 'upward', 'downward'])(
    'reorders in %s layout using its sibling axis',
    (layout) => {
      const r = runtime(),
        root = r.store.cells.root as NodeCell;
      r.transact({
        id: 'layout',
        operations: [
          { type: 'replace_cell', cell: { ...root, data: { layout } } },
        ],
      });
      const positions = layoutMindCells(r.store, 'frame'),
        first = positions.get('a')!;
      const horizontal = layout === 'upward' || layout === 'downward';
      const point: [number, number] = horizontal
        ? [first.x - 8, first.y + first.height / 2]
        : [first.x + first.width / 2, first.y - 8];
      r.transact({
        id: 'drag',
        operations: new MindChildNodeUtil().move(
          r.store,
          r.store.cells.c,
          positions.get('c')!,
          undefined,
          { point, geometry: positions },
        ),
      });
      expect(mindChildIds(r.store, 'root')).toEqual(['c', 'a', 'b']);
    },
  );
  it('reorders a topic in a gap and normalizes summaries to the new sibling order', () => {
    const r = runtime(),
      root = r.store.cells.root as NodeCell;
    r.transact({
      id: 'layout',
      operations: [
        { type: 'replace_cell', cell: { ...root, data: { layout: 'right' } } },
      ],
    });
    r.transact({
      id: 'summary',
      operations: createMindSummary(
        r.store,
        'root',
        'a',
        'c',
        'summary',
        'range',
      ),
    });
    const positions = layoutMindCells(r.store, 'frame'),
      a = positions.get('a')!;
    const before = r.store;
    r.transact({
      id: 'drag',
      operations: new MindChildNodeUtil().move(
        r.store,
        r.store.cells.c,
        positions.get('c')!,
        undefined,
        { point: [a.x + a.width / 2, a.y - 8], geometry: positions },
      ),
    });
    expect(mindChildIds(r.store, 'root')).toEqual(['c', 'a', 'b']);
    expect((r.store.cells.range as EdgeCell).data).toEqual({
      startSiblingId: 'c',
      endSiblingId: 'b',
    });
    expect((r.store.cells.range as EdgeCell).source).toEqual({ cellId: 'c' });
    r.undo();
    expect(r.store).toEqual(before);
    r.redo();
    expect(mindChildIds(r.store, 'root')).toEqual(['c', 'a', 'b']);
  });
  it('uses the actual pointer to reparent and expands a collapsed destination in the same history entry', () => {
    const r = runtime(),
      a = r.store.cells.a as NodeCell;
    r.transact({
      id: 'collapse',
      operations: [
        { type: 'replace_cell', cell: { ...a, data: { collapsed: true } } },
      ],
    });
    const before = r.store,
      positions = layoutMindCells(r.store, 'frame'),
      target = positions.get('a')!;
    r.transact({
      id: 'drag',
      operations: new MindChildNodeUtil().move(
        r.store,
        r.store.cells.b,
        { ...positions.get('b')!, x: 10000, y: 10000 },
        undefined,
        {
          point: [target.x + target.width / 2, target.y + target.height / 2],
          geometry: positions,
        },
      ),
    });
    expect(mindChildIds(r.store, 'a')).toEqual(['b']);
    expect(
      (r.store.cells.a as NodeCell<{ collapsed: boolean }>).data?.collapsed,
    ).toBe(false);
    expect(r.index.incoming.get('b')).toHaveLength(1);
    r.undo();
    expect(r.store).toEqual(before);
  });
  it('moves between root sides without flipping other topics and rejects invalid indexes', () => {
    const r = runtime();
    r.transact({
      id: 'standard',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...r.store.cells.root,
            data: { layout: 'standard' },
          },
        },
      ],
    });
    const positions = layoutMindCells(r.store, 'frame'),
      a = positions.get('a')!,
      root = positions.get('root')!;
    r.transact({
      id: 'right',
      operations: new MindChildNodeUtil().move(
        r.store,
        r.store.cells.c,
        positions.get('c')!,
        undefined,
        { point: [a.x + a.width / 2, a.y - 8], geometry: positions },
      ),
    });
    expect(mindChildIds(r.store, 'root')).toEqual(['c', 'a', 'b']);
    expect(
      (r.store.cells.root as NodeCell<{ rightNodeCount: number }>).data
        ?.rightNodeCount,
    ).toBe(3);
    r.transact({
      id: 'left',
      operations: reparentMindChild(r.store, 'a', 'root', undefined, 'left'),
    });
    expect(mindChildIds(r.store, 'root')).toEqual(['c', 'b', 'a']);
    const after = layoutMindCells(r.store, 'frame');
    expect(after.get('a')!.x).toBeLessThan(root.x);
    expect(after.get('b')!.x).toBeGreaterThan(root.x);
    expect(after.get('c')!.x).toBeGreaterThan(root.x);
    expect(() => reparentMindChild(r.store, 'b', 'root', -1)).toThrow('index');
    expect(() => reparentMindChild(r.store, 'b', 'root', 0.5)).toThrow('index');
  });
  it('does not count a summary as an ordinary branch for left/right distribution', () => {
    const r = runtime();
    r.transact({
      id: 'standard',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...r.store.cells.root,
            data: { layout: 'standard' },
          },
        },
      ],
    });
    r.transact({
      id: 'remove-c',
      operations: [{ type: 'remove_cell', cellId: 'c' }],
    });
    const before = layoutMindCells(r.store, 'frame'),
      root = before.get('root')!;
    const sides = (layout: ReturnType<typeof layoutMindCells>) =>
      ['a', 'b'].map((id) => layout.get(id)!.x > layout.get('root')!.x);
    r.transact({
      id: 'summary',
      operations: createMindSummary(
        r.store,
        'root',
        'a',
        'a',
        'summary',
        'summary-edge',
      ),
    });
    expect(sides(layoutMindCells(r.store, 'frame'))).toEqual(sides(before));
    expect(sides(before)).toEqual([true, false]);
    expect(root.x).toBe(0);
  });
  it('keeps a summary spanning the standard split on the side holding most of its range', () => {
    const r = runtime();
    r.transact({
      id: 'standard',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...r.store.cells.root,
            data: { layout: 'standard' },
          },
        },
      ],
    });
    // Three topics split 2 right / 1 left; a summary over all three used to
    // index the combined range inside one branch and crash the layout.
    r.transact({
      id: 'summary',
      operations: createMindSummary(
        r.store,
        'root',
        'a',
        'c',
        'summary',
        'summary-edge',
      ),
    });
    const positions = layoutMindCells(r.store, 'frame');
    const summary = positions.get('summary')!;
    expect(summary).toBeDefined();
    // Two of the three covered topics sit on the right, so the summary node
    // slots on the right branch of the split.
    expect(summary.x).toBeGreaterThanOrEqual(positions.get('root')!.x);
    const bracket = mindSummaryGeometry(
      r.store,
      r.store.cells['summary-edge'] as EdgeCell<MindSummaryData>,
      (id) => positions.get(id),
    )!;
    expect(bracket.start).toBeTruthy();
  });
  it('adjusts stable summary endpoints atomically and restores range history', () => {
    const r = runtime();
    r.transact({
      id: 'summary',
      operations: createMindSummary(
        r.store,
        'root',
        'a',
        'b',
        'summary',
        'summary-edge',
      ),
    });
    r.transact({
      id: 'range',
      operations: setMindSummaryRange(r.store, 'summary-edge', 'b', 'c'),
    });
    expect((r.store.cells['summary-edge'] as EdgeCell).source).toEqual({
      cellId: 'b',
    });
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'b',
      endSiblingId: 'c',
    });
    expect(
      Object.values(r.store.cells).filter(
        (cell) => cell.kind === 'mind-branch',
      ),
    ).toHaveLength(3);
    const before = r.store;
    expect(() =>
      setMindSummaryRange(r.store, 'summary-edge', 'c', 'a'),
    ).toThrow('Invalid');
    r.transact({
      id: 'child',
      operations: addMindChild(
        r.store,
        'a',
        createMindChildCell('nested'),
        'nested-edge',
      ),
    });
    expect(() =>
      setMindSummaryRange(r.store, 'summary-edge', 'nested', 'c'),
    ).toThrow('Invalid');
    r.undo();
    expect(r.store).toEqual(before);
    r.undo();
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'a',
      endSiblingId: 'b',
    });
    r.redo();
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'b',
      endSiblingId: 'c',
    });
    r.transact({
      id: 'delete-range',
      operations: [
        { type: 'remove_cell', cellId: 'b' },
        { type: 'remove_cell', cellId: 'c' },
      ],
    });
    expect(r.store.cells['summary-edge']).toBeUndefined();
    expect(r.store.cells.summary).toBeUndefined();
    r.undo();
    expect(r.store.cells.summary).toBeDefined();
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'b',
      endSiblingId: 'c',
    });
  });
  it.each(['right', 'left', 'upward', 'downward'])(
    'draws a %s summary bracket around full visible subtrees',
    (layout) => {
      const r = runtime();
      const root = r.store.cells.root as NodeCell;
      r.transact({
        id: 'layout',
        operations: [
          { type: 'replace_cell', cell: { ...root, data: { layout } } },
        ],
      });
      r.transact({
        id: 'descendant',
        operations: addMindChild(
          r.store,
          'a',
          createMindChildCell('nested'),
          'nested-edge',
        ),
      });
      r.transact({
        id: 'summary',
        operations: createMindSummary(
          r.store,
          'root',
          'a',
          'b',
          'summary',
          'summary-edge',
        ),
      });
      const positions = layoutMindCells(r.store, 'frame');
      const bracket = mindSummaryGeometry(
        r.store,
        r.store.cells['summary-edge'] as EdgeCell<MindSummaryData>,
        (id) => positions.get(id),
      )!;
      expect(bracket).toBeDefined();
      expect(bracket.path).not.toMatch(/NaN|Infinity/);
      const nested = positions.get('nested')!,
        branch = bracket.branches.get('a')!;
      expect(branch.x).toBeLessThanOrEqual(nested.x);
      expect(branch.x + branch.width).toBeGreaterThanOrEqual(
        nested.x + nested.width,
      );
      expect(branch.y).toBeLessThanOrEqual(nested.y);
      expect(branch.y + branch.height).toBeGreaterThanOrEqual(
        nested.y + nested.height,
      );
      if (layout === 'right' || layout === 'left') {
        expect(bracket.start[0]).toBe(bracket.end[0]);
        expect(bracket.end[1]).toBeGreaterThan(bracket.start[1]);
      } else {
        expect(bracket.start[1]).toBe(bracket.end[1]);
        expect(bracket.end[0]).toBeGreaterThan(bracket.start[0]);
      }
    },
  );
  it('lays out branches from edges and protects the last center', () => {
    const r = runtime();
    const before = structuredClone(r.store);
    expect(layoutMindCells(r.store, 'frame').size).toBe(4);
    expect(r.store).toEqual(before);
    expect(() =>
      r.transact({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'root' }],
      }),
    ).toThrow('last');
  });
  it('rejects reparenting cycles atomically', () => {
    const r = runtime();
    r.transact({
      id: 'move-b',
      operations: reparentMindChild(r.store, 'b', 'a'),
    });
    expect(() =>
      r.transact({
        id: 'cycle',
        operations: reparentMindChild(r.store, 'a', 'b'),
      }),
    ).toThrow('cycle');
  });
  it('shrinks a summary range after deleting its first sibling and restores it on undo', () => {
    const r = runtime();
    r.transact({
      id: 'summary',
      operations: createMindSummary(
        r.store,
        'root',
        'a',
        'c',
        'summary',
        'summary-edge',
      ),
    });
    r.transact({
      id: 'delete-a',
      operations: [{ type: 'remove_cell', cellId: 'a' }],
    });
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'b',
      endSiblingId: 'c',
    });
    r.undo();
    expect((r.store.cells['summary-edge'] as EdgeCell).data).toEqual({
      startSiblingId: 'a',
      endSiblingId: 'c',
    });
  });
  it('chooses ports for all nine layouts and underlines the horizontal end', () => {
    const expected = {
      right: ['right', 'left'],
      left: ['left', 'right'],
      upward: ['top', 'bottom'],
      downward: ['bottom', 'top'],
      'right-bottom-indented': ['right', 'left'],
      'right-top-indented': ['right', 'left'],
      'left-top-indented': ['left', 'right'],
      'left-bottom-indented': ['left', 'right'],
    } as const;
    for (const [layout, [source, target]] of Object.entries(expected)) {
      const r = runtime();
      r.transact({
        id: layout,
        operations: [
          {
            type: 'replace_cell',
            cell: { ...r.store.cells.root, data: { layout } },
          },
        ],
      });
      const edge = Object.values(r.store.cells).find(
        (cell): cell is EdgeCell =>
          cell.cellType === 'edge' &&
          'cellId' in cell.target &&
          cell.target.cellId === 'a',
      )!;
      expect(mindBranchPorts(r.store, edge)).toEqual({
        source: { side: source, offset: 0.5 },
        target: { side: target, offset: 0.5 },
      });
    }
    const bilateral = runtime();
    bilateral.transact({
      id: 'standard',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...bilateral.store.cells.root,
            data: { layout: 'standard', rightNodeCount: 1 },
          },
        },
      ],
    });
    const side = (id: string) => {
      const edge = Object.values(bilateral.store.cells).find(
        (cell): cell is EdgeCell =>
          cell.cellType === 'edge' &&
          'cellId' in cell.target &&
          cell.target.cellId === id,
      )!;
      return mindBranchPorts(bilateral.store, edge)?.source.side;
    };
    expect(side('a')).toBe('right');
    expect(side('b')).toBe('left');
    const underlined = runtime();
    const child = underlined.store.cells.a as NodeCell;
    underlined.transact({
      id: 'underline',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...child,
            geometry: { ...child.geometry, outline: 'underline' },
          },
        },
      ],
    });
    const edge = Object.values(underlined.store.cells).find(
      (cell): cell is EdgeCell =>
        cell.cellType === 'edge' &&
        'cellId' in cell.target &&
        cell.target.cellId === 'a',
    )!;
    expect(mindBranchPorts(underlined.store, edge)).toEqual({
      source: { side: 'right', offset: 0.5 },
      target: { side: 'left', offset: 1 },
    });
  });
  it('uses left and right ports for fourteen right-layout branches and inherits the root branch shape', () => {
    const r = runtime();
    for (let index = 0; index < 11; index++)
      r.transact({
        id: `extra-${index}`,
        operations: addMindChild(
          r.store,
          'root',
          createMindChildCell(`n${index}`),
          `en-${index}`,
        ),
      });
    const root = r.store.cells.root as NodeCell;
    r.transact({
      id: 'shape',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...root, data: { layout: 'right', branchShape: 'polyline' } },
        },
      ],
    });
    const children = mindChildIds(r.store, 'root');
    expect(children).toHaveLength(14);
    children.forEach((id) => {
      const edge = Object.values(r.store.cells).find(
        (cell): cell is EdgeCell =>
          cell.cellType === 'edge' &&
          'cellId' in cell.target &&
          cell.target.cellId === id,
      )!;
      expect(mindBranchPorts(r.store, edge)).toEqual({
        source: { side: 'right', offset: 0.5 },
        target: { side: 'left', offset: 0.5 },
      });
      expect(resolvedMindBranchShape(r.store, id)).toBe('polyline');
    });
    const positions = layoutMindCells(r.store, 'frame');
    expect(positions.get(children[0])!.x).toBeGreaterThan(
      positions.get('root')!.x,
    );
  });
  it('expands a collapsed parent in the same transaction as a new child', () => {
    const r = runtime();
    const child = r.store.cells.a as NodeCell;
    r.transact({
      id: 'collapse',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...child, data: { collapsed: true } },
        },
      ],
    });
    r.transact({
      id: 'add',
      operations: addMindChild(
        r.store,
        'a',
        createMindChildCell('added'),
        'added-edge',
      ),
    });
    expect(
      (r.store.cells.a as NodeCell<{ collapsed?: boolean }>).data?.collapsed,
    ).toBe(false);
    expect(r.store.cells.added).toBeDefined();
    r.undo();
    expect(
      (r.store.cells.a as NodeCell<{ collapsed?: boolean }>).data?.collapsed,
    ).toBe(true);
    expect(r.store.cells.added).toBeUndefined();
  });
  it('splits a standard summary that crosses both sides', () => {
    const r = runtime();
    r.transact({
      id: 'standard',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...r.store.cells.root,
            data: { layout: 'standard', rightNodeCount: 2 },
          },
        },
      ],
    });
    let n = 0;
    r.transact({
      id: 'summaries',
      operations: createMindSummaries(
        r.store,
        'root',
        ['a', 'b', 'c'],
        () => `id-${n++}`,
      ),
    });
    const summaries = Object.values(r.store.cells).filter(
      (cell) => cell.kind === 'mind-summary-edge',
    );
    expect(summaries).toHaveLength(2);
    r.undo();
    expect(
      Object.values(r.store.cells).some(
        (cell) => cell.kind === 'mind-summary-edge',
      ),
    ).toBe(false);
  });
  it('uses a dark topic color on a light root when migrated fill is missing', () => {
    const r = runtime();
    const root = {
      ...(r.store.cells.root as NodeCell),
      appearance: undefined,
    };
    r.transact({
      id: 'clear-fill',
      operations: [{ type: 'replace_cell', cell: root }],
    });
    const frame = r.store.cells.frame as NodeCell & {
      view?: { theme?: { themeColorMode?: string } };
    };
    r.transact({
      id: 'theme',
      history: false,
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...frame,
            view: { theme: { themeColorMode: ThemeColorMode.default } },
          },
        },
      ],
    });
    expect(
      mindPresentation(r.store, r.store.cells.root as NodeCell, 'frame'),
    ).toEqual({
      fill: '#f5f5f5',
      stroke: '#64748b',
      color: '#333333',
    });
  });
  it('keeps unedited marks through a text edit, undo and snapshot restore', () => {
    const r = runtime();
    const marks = [
      { type: 'bold' },
      { type: 'textStyle', attrs: { color: '#ff0000' } },
      { type: 'link', attrs: { href: 'https://example.com' } },
    ];
    const text = createInlineText('Hello');
    text.content.content![0].content![0].marks = marks;
    const child = r.store.cells.a as NodeCell;
    r.transact({
      id: 'format',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...child,
            content: { label: 'Hello', text },
          },
        },
      ],
    });
    const formatted = r.store.cells.a as NodeCell;
    const revised = reviseBoardText(
      formatted.content!.text as typeof text,
      'Hello!',
    );
    r.transact({
      id: 'edit',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...formatted,
            content: { label: 'Hello!', text: revised },
          },
        },
      ],
    });
    r.undo();
    const restored = (r.store.cells.a as NodeCell).content!.text as typeof text;
    expect(restored.content.content![0].content![0]).toMatchObject({
      text: 'Hello',
      marks,
    });
    const snapshot = JSON.parse(JSON.stringify(r.store));
    r.replace({ store: snapshot });
    expect(
      ((r.store.cells.a as NodeCell).content!.text as typeof text).content
        .content![0].content![0].marks,
    ).toEqual(marks);
  });
});

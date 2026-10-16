import { describe, expect, it } from 'vitest';
import {
  arrangeCells,
  arrangementAvailability,
  copyCellFragment,
  createCellRegistry,
  createCellRuntime,
  deleteCells,
  groupCells,
  planCellPaste,
  type NodeCell,
  type FrameCell,
} from '@sue/board-core';
import {
  addArchitectureModule,
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  materializeArchitecturePositions,
  moveArchitectureModuleToLayer,
} from './cell-commands';
import {
  layoutArchitectureCells,
  registerArchitectureCells,
} from './cell-utils';

const fixture = () => {
  const registry = createCellRegistry();
  registerArchitectureCells(registry);
  const runtime = createCellRuntime(
    createArchitectureFrameSnapshot('frame', 'layer'),
    registry,
  );
  runtime.transact({
    id: 'other',
    operations: [
      {
        type: 'insert_cell',
        parentId: 'frame',
        cell: createArchitectureLayerCell('other', '0001'),
      },
    ],
  });
  for (const [id, owner] of [
    ['a', 'layer'],
    ['b', 'layer'],
    ['c', 'other'],
  ])
    runtime.transact({
      id,
      operations: addArchitectureModule(
        runtime.store,
        owner,
        createArchitectureModuleCell(id),
      ),
    });
  return runtime;
};
describe('architecture arrangement and domain groups', () => {
  it('creates fixed modules and idempotently materializes legacy positions while keeping derived layer envelopes', () => {
    const runtime = fixture();
    const cell = runtime.store.cells.a as NodeCell;
    expect(cell.geometry.derived).toBe(false);
    const legacy = {
      ...runtime.store,
      cells: {
        ...runtime.store.cells,
        a: {
          ...cell,
          geometry: { ...cell.geometry, x: 0, y: 0, derived: true },
          data: { shape: 'box' },
        },
      },
    };
    const converted = materializeArchitecturePositions(legacy);
    expect((converted.cells.a as NodeCell).geometry).toEqual({
      ...layoutArchitectureCells(legacy, 'frame').get('a'),
      derived: false,
    });
    expect(converted.cells.layer).toBe(legacy.cells.layer);
    expect(materializeArchitecturePositions(converted)).toBe(converted);
  });

  it('keeps group creation order and domain ownership, and limits layer layout for cross-layer groups', () => {
    const runtime = fixture();
    const order = (runtime.store.cells.frame as FrameCell).children;
    runtime.transact({
      id: 'group',
      operations: groupCells(runtime.store, 'frame', ['a', 'c'], 'group'),
    });
    expect((runtime.store.cells.frame as FrameCell).children).toEqual(order);
    expect(runtime.index.domainOwnerOf.get('a')).toBe('layer');
    expect(runtime.index.domainOwnerOf.get('c')).toBe('other');
    expect(
      arrangementAvailability(runtime.store, 'frame', [], {
        type: 'layout',
        style: 'layers',
      }),
    ).toMatchObject({
      enabled: false,
      reason: 'A group crosses architecture layers',
    });
    const before = runtime.store.cells.b;
    runtime.transact({
      id: 'layout',
      operations: arrangeCells(
        runtime.store,
        'frame',
        ['group', 'b'],
        'vertical',
      ),
    });
    expect(runtime.index.domainOwnerOf.get('c')).toBe('other');
    runtime.undo();
    expect(runtime.store.cells.b).toEqual(before);
  });

  it('restores every original owner on paste and rejects deleted owners atomically', () => {
    const runtime = fixture();
    runtime.transact({
      id: 'group',
      operations: groupCells(runtime.store, 'frame', ['a', 'c'], 'group'),
    });
    const fragment = copyCellFragment(runtime.store, ['group']);
    const plan = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
      fragment,
      registry: runtime.registry,
      allocateId: (id) => `copy-${id}`,
    });
    runtime.transact({ id: 'paste', operations: plan.operations });
    expect(runtime.index.domainOwnerOf.get('copy-a')).toBe('layer');
    expect(runtime.index.domainOwnerOf.get('copy-c')).toBe('other');
    runtime.transact({
      id: 'delete-layer',
      operations: deleteCells(runtime.store, ['other']),
    });
    const before = runtime.store;
    expect(() =>
      planCellPaste({
        store: runtime.store,
        frameId: 'frame',
        selectionIds: [],
        fragment,
        registry: runtime.registry,
        allocateId: (id) => `more-${id}`,
      }),
    ).toThrow('Original paste owner');
    expect(runtime.store).toBe(before);
  });
});

it('explicit membership selection places only the chosen module inside its target layer', () => {
  const runtime = fixture();
  const beforeB = runtime.store.cells.b,
    beforeC = runtime.store.cells.c;
  runtime.transact({
    id: 'reparent',
    operations: moveArchitectureModuleToLayer(runtime.store, 'a', 'other', {
      position: 'inside-layer',
    }),
  });
  expect(runtime.index.domainOwnerOf.get('a')).toBe('other');
  expect((runtime.store.cells.a as NodeCell).geometry.y).toBe(
    (runtime.store.cells.c as NodeCell).geometry.y,
  );
  expect(runtime.store.cells.b).toEqual(beforeB);
  expect(runtime.store.cells.c).toEqual(beforeC);
});

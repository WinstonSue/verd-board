import { describe, expect, it } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  createFrameCell,
  planCellPaste,
  type CellStore,
  type NodeCell,
  type ArchitectureLayerData,
} from '@sue/board-core';
import {
  registerArchitectureCells,
  architectureLayerIds,
  layoutArchitectureCells,
} from './cell-utils';
import {
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  addArchitectureModule,
  reorderArchitectureLayers,
  moveArchitectureModuleToLayer,
} from './cell-commands';

describe('architectureLayerIds', () => {
  it('sorts direct layers by order and preserves child order for equal or missing keys', () => {
    const frame = createFrameCell('frame');
    frame.children = ['last', 'z-tie', 'missing', 'a-tie', 'empty'];
    const missing = createArchitectureLayerCell('missing');
    delete missing.data;
    const store: CellStore = {
      rootId: frame.id,
      cells: {
        frame,
        last: createArchitectureLayerCell('last', '0002'),
        'z-tie': createArchitectureLayerCell('z-tie', '0001'),
        missing,
        'a-tie': createArchitectureLayerCell('a-tie', '0001'),
        empty: createArchitectureLayerCell('empty', ''),
      },
    };
    const before = structuredClone(store);
    const ids = architectureLayerIds(store, frame.id);
    expect(ids).toEqual(['missing', 'empty', 'z-tie', 'a-tie', 'last']);
    const layout = layoutArchitectureCells(store, frame.id);
    expect([...layout.keys()]).toEqual(ids);
    expect(ids.map((id) => layout.get(id)!.y)).toEqual([0, 176, 352, 528, 704]);
    expect(store).toEqual(before);
  });

  it('ignores modules, missing children, nested layers and layers in other frames', () => {
    const frame = createFrameCell('frame');
    const nested = createFrameCell('nested');
    nested.children = ['nested-layer'];
    frame.children = ['module', 'missing', 'nested', 'layer'];
    const store: CellStore = {
      rootId: frame.id,
      cells: {
        frame,
        nested,
        module: createArchitectureModuleCell('module'),
        layer: createArchitectureLayerCell('layer', '0002'),
        'nested-layer': createArchitectureLayerCell('nested-layer', '0000'),
        'other-layer': createArchitectureLayerCell('other-layer', '0001'),
      },
    };
    expect(architectureLayerIds(store, frame.id)).toEqual(['layer']);
    expect(architectureLayerIds(store, nested.id)).toEqual(['nested-layer']);
    expect([...layoutArchitectureCells(store, frame.id).keys()]).toEqual([
      'layer',
    ]);
  });

  it('returns no layers or layout for missing, non-frame and empty frames', () => {
    const frame = createFrameCell('empty');
    const store: CellStore = {
      rootId: frame.id,
      cells: { empty: frame, module: createArchitectureModuleCell('module') },
    };
    for (const id of ['missing', 'module', 'empty']) {
      expect(architectureLayerIds(store, id)).toEqual([]);
      expect(layoutArchitectureCells(store, id)).toEqual(new Map());
    }
  });
});

describe('native architecture rules', () => {
  it('reorders layers and transfers a dragged module atomically while preserving fixed positions and history', () => {
    const registry = createCellRegistry();
    registerArchitectureCells(registry);
    const r = createCellRuntime(
      createArchitectureFrameSnapshot('frame', 'layer'),
      registry,
    );
    r.transact({
      id: 'setup',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: createArchitectureLayerCell('other', '0001'),
        },
        ...addArchitectureModule(
          r.store,
          'layer',
          createArchitectureModuleCell('module'),
        ),
      ],
    });
    const legacyModule = r.store.cells.module as NodeCell;
    r.transact({
      id: 'legacy-derived',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...legacyModule,
            geometry: { ...legacyModule.geometry, derived: true },
            data: { ...(legacyModule.data as object), placed: false },
          },
        },
      ],
    });
    r.transact({
      id: 'order',
      operations: reorderArchitectureLayers(r.store, 'frame', [
        'other',
        'layer',
      ]),
    });
    const geometry = layoutArchitectureCells(r.store, 'frame');
    expect(geometry.get('other')!.y).toBeLessThan(geometry.get('layer')!.y);
    const before = structuredClone(r.store);
    const module = r.store.cells.module as NodeCell;
    const bounds = geometry.get('other')!;
    const position = { ...module.geometry, x: bounds.x + 20, y: bounds.y + 44 };
    const util = r.registry.get('architecture-module')!;
    r.transact({
      id: 'move',
      operations: util.move!(r.store, module, position, undefined, {
        point: [position.x + 5, position.y + 5],
        geometry,
      }),
    });
    expect(
      (r.store.cells.layer as NodeCell<ArchitectureLayerData>).data!.memberIds,
    ).toEqual([]);
    expect(
      (r.store.cells.other as NodeCell<ArchitectureLayerData>).data!.memberIds,
    ).toEqual(['module']);
    expect(
      layoutArchitectureCells(r.store, 'frame').get('module'),
    ).toMatchObject({ x: position.x, y: position.y, derived: false });
    r.undo();
    expect(r.store).toEqual(before);
    r.redo();
    expect(r.index.membersOf.get('module')).toBe('other');
    expect(() =>
      reorderArchitectureLayers(r.store, 'frame', ['other', 'other']),
    ).toThrow('exactly once');
    expect(moveArchitectureModuleToLayer(r.store, 'module', 'other')).toEqual(
      [],
    );
  });
  it('protects the last layer and cascades deleting other layers', () => {
    const registry = createCellRegistry();
    registerArchitectureCells(registry);
    const r = createCellRuntime(
      createArchitectureFrameSnapshot('frame', 'layer'),
      registry,
    );
    expect(() =>
      r.transact({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'layer' }],
      }),
    ).toThrow('last');
    r.transact({
      id: 'add-layer',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: createArchitectureLayerCell('other', '0001'),
        },
      ],
    });
    r.transact({
      id: 'add-module',
      operations: addArchitectureModule(
        r.store,
        'layer',
        createArchitectureModuleCell('module'),
      ),
    });
    r.transact({
      id: 'delete-layer',
      operations: [{ type: 'remove_cell', cellId: 'layer' }],
    });
    expect(r.store.cells.module).toBeUndefined();
    r.undo();
    expect(r.store.cells.module).toBeTruthy();
  });
  it('computes empty bands and respects explicit module positions', () => {
    const registry = createCellRegistry();
    registerArchitectureCells(registry);
    const r = createCellRuntime(
      createArchitectureFrameSnapshot('frame', 'layer'),
      registry,
    );
    expect(layoutArchitectureCells(r.store, 'frame').get('layer')?.width).toBe(
      280,
    );
    const module = createArchitectureModuleCell('module');
    module.geometry = { ...module.geometry, x: 300, y: 200, derived: false };
    r.transact({
      id: 'add',
      operations: addArchitectureModule(r.store, 'layer', module),
    });
    expect(
      layoutArchitectureCells(r.store, 'frame').get('module'),
    ).toMatchObject({ x: 300, y: 200 });
  });
  it('pastes a module into the selected layer at its displayed position and appends a whole layer', () => {
    const registry = createCellRegistry();
    registerArchitectureCells(registry);
    const runtime = createCellRuntime(
      createArchitectureFrameSnapshot('frame', 'layer'),
      registry,
    );
    const module = createArchitectureModuleCell('module');
    expect(() =>
      planCellPaste({
        store: runtime.store,
        frameId: 'frame',
        selectionIds: [],
        fragment: { cells: { module }, ids: ['module'] },
        allocateId: (id) => `p-${id}`,
        registry,
        intent: 'paste',
      }),
    ).toThrow('Select a target first');
    const planned = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: ['layer'],
      fragment: { cells: { module }, ids: ['module'] },
      allocateId: (id) => `p-${id}`,
      offset: [10, 0],
      geometry: new Map([['module', { ...module.geometry, x: 40, y: 50 }]]),
      registry,
      intent: 'paste',
    });
    runtime.transact({ id: 'paste', operations: planned.operations });
    expect(runtime.store.cells['p-module']).toMatchObject({
      geometry: { x: 50, y: 50, derived: false },
      data: { placed: true },
    });
    expect(
      (runtime.store.cells.layer as NodeCell<ArchitectureLayerData>).data!
        .memberIds,
    ).toContain('p-module');
    const layer = createArchitectureLayerCell('extra', '0001');
    const whole = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
      fragment: { cells: { extra: layer }, ids: ['extra'] },
      allocateId: (id) => `l-${id}`,
      registry,
      intent: 'paste',
    });
    runtime.transact({ id: 'layer', operations: whole.operations });
    expect(
      (runtime.store.cells['l-extra'] as NodeCell<ArchitectureLayerData>).data!
        .order > '0000',
    ).toBe(true);
  });
});

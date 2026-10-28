import { describe, expect, it, vi } from 'vitest';
import { copyCellFragment, pasteCellFragment } from './clipboard';
import { applyCellOperations } from './index';
import {
  createCellRegistry,
  UnregisteredCellKindsError,
  type CellPlugin,
} from './registry';
import { createCellRuntime } from './runtime';
import {
  createCellStore,
  createFrameCell,
  type CellStore,
  type NodeCell,
} from './types';
const node = (id: string, kind = 'custom-node'): NodeCell => ({
  id,
  kind,
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 40, height: 30 },
});
const plugin = (): CellPlugin => ({
  id: 'custom',
  install(registry) {
    registry.register({
      kind: 'custom-node',
      validate: (_store, cell) =>
        cell.hidden ? 'Custom validation failed' : undefined,
    });
  },
  deletionClosure(_store, cell) {
    return cell.id === 'owner' ? ['dependent'] : [];
  },
});
const populated = (
  registry = createCellRegistry({ plugins: [plugin()] }),
): CellStore =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    [
      { type: 'insert_cell', parentId: 'root', cell: node('owner') },
      { type: 'insert_cell', parentId: 'root', cell: node('dependent') },
    ],
    registry,
  );
describe('explicit cell plugins', () => {
  it('rejects duplicate plugin ids and conflicting kinds', () => {
    expect(() => createCellRegistry({ plugins: [plugin(), plugin()] })).toThrow(
      'Duplicate cell plugin id',
    );
    expect(() =>
      createCellRegistry({
        plugins: [plugin(), { ...plugin(), id: 'conflicting' }],
      }),
    ).toThrow('Conflicting cell kind');
  });
  it('keeps registries isolated and refuses files before mutation', () => {
    const value = { store: populated() },
      original = structuredClone(value);
    expect(() => createCellRuntime(value)).toThrow(UnregisteredCellKindsError);
    expect(value).toEqual(original);
    const registry = createCellRegistry({ plugins: [plugin()] });
    expect(createCellRuntime(value, registry).store).toEqual(value.store);
    expect(createCellRegistry().get('custom-node')).toBeUndefined();
  });
  it('keeps failed transactions out of state, history and notifications', () => {
    const registry = createCellRegistry({ plugins: [plugin()] });
    const runtime = createCellRuntime({ store: populated(registry) }, registry);
    const before = runtime.store,
      history = runtime.history,
      notify = vi.fn();
    runtime.subscribe(notify);
    expect(() =>
      runtime.transact({
        id: 'bad',
        operations: [
          {
            type: 'replace_cell',
            cell: { ...runtime.store.cells.owner, hidden: true },
          },
        ],
      }),
    ).toThrow('Custom validation failed');
    expect(runtime.store).toBe(before);
    expect(runtime.history).toBe(history);
    expect(notify).not.toHaveBeenCalled();
    expect(() => registry.register({ kind: 'late' })).toThrow('sealed');
  });
  it('uses the same deletion policy for independent helpers and the runtime', () => {
    const registry = createCellRegistry({ plugins: [plugin()] }),
      store = populated(registry);
    const operations = [{ type: 'remove_cell' as const, cellId: 'owner' }];
    const expected = applyCellOperations(store, operations, registry),
      runtime = createCellRuntime({ store }, registry);
    runtime.transact({ id: 'delete', operations });
    expect(runtime.store).toEqual(expected);
    expect(runtime.store.cells.dependent).toBeUndefined();
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
  it('copies a custom domain without a core change', () => {
    const registry = createCellRegistry({ plugins: [plugin()] }),
      store = populated(registry);
    const fragment = copyCellFragment(store, ['owner'], registry);
    const operations = pasteCellFragment(
      fragment,
      'root',
      (id) => `copy-${id}`,
      [10, 20],
      undefined,
      undefined,
      registry,
    );
    const next = applyCellOperations(store, operations, registry);
    expect((next.cells['copy-owner'] as NodeCell).geometry).toMatchObject({
      x: 10,
      y: 20,
    });
  });
});

import { expect, it } from 'vitest';
import { createTestCellRegistry } from '../../../../../tests/fixtures/core/registry';
import {
  createCellStore,
  createFrameCell,
  type NodeCell,
  type EdgeCell,
} from './types';
import { createCellRuntime } from './runtime';
import { updateCellAppearance } from './commands';
import { copyCellFragment } from './clipboard';
import { validateCellStore } from './validation';

it('persists style families through transactions, clipboard, reset and undo without changing custom fields', () => {
  const frame = createFrameCell('f');
  const store = createCellStore(frame);
  const node: NodeCell = {
    id: 'n',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 60 },
    appearance: { fill: '#ffffff', colorSources: { fill: 'custom' } },
  };
  const edge: EdgeCell = {
    id: 'e',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: 'n' },
    target: { point: [200, 0] },
    route: { mode: 'auto' },
  };
  store.cells.n = node;
  store.cells.e = edge;
  frame.children = ['n', 'e'];
  const registry = createTestCellRegistry();
  const runtime = createCellRuntime({ store }, registry);
  runtime.transact({
    id: 'family',
    operations: updateCellAppearance(runtime.store, ['n', 'e'], {
      styleColor: 'series-3',
    }),
  });
  const saved = JSON.parse(JSON.stringify(runtime.store));
  expect(saved.cells.n.appearance).toEqual({
    ...node.appearance,
    styleColor: 'series-3',
  });
  expect(saved.cells.e.appearance?.styleColor).toBeUndefined();
  expect(
    copyCellFragment(runtime.store, ['n'], registry).cells.n,
  ).toMatchObject({ appearance: { styleColor: 'series-3' } });
  runtime.transact({
    id: 'auto',
    operations: updateCellAppearance(runtime.store, ['n'], {
      styleColor: undefined,
    }),
  });
  expect(
    (runtime.store.cells.n as NodeCell).appearance?.styleColor,
  ).toBeUndefined();
  runtime.undo();
  expect((runtime.store.cells.n as NodeCell).appearance?.styleColor).toBe(
    'series-3',
  );
  runtime.undo();
  expect((runtime.store.cells.n as NodeCell).appearance).toEqual(
    node.appearance,
  );
  runtime.redo();
  expect((runtime.store.cells.n as NodeCell).appearance?.styleColor).toBe(
    'series-3',
  );
  saved.cells.n.appearance.styleColor = 'not-a-family';
  expect(validateCellStore(saved, registry)).toContainEqual({
    cellId: 'n',
    message: 'Invalid style color family',
  });
});

import {
  anchorFromPoint,
  availablePorts,
  createCellRuntime,
  createCellStore,
  createEdgeRoutingContext,
  createFrameCell,
  edgeRoutePoints,
  frameContentBounds,
  portKey,
  resolveAnchor,
  resolvePort,
  resolveTerminal,
  selectionAllows,
  terminalKey,
  type Anchor,
  type FrameSnapshot,
  type NodeCell,
  type Port,
  type PortRef,
  type Terminal,
  type TerminalRef,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameCanvasProps,
} from '@sue/board-react';
const value: FrameSnapshot = {
  store: createCellStore(createFrameCell('consumer-root')),
};
const runtime = createCellRuntime(value);
const attachment: Anchor = [0.25, 0];
const consumerPort: Port = { id: 'out', direction: 'output', side: 'right' };
const consumerNode: NodeCell = {
  id: 'connection-node',
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 100, height: 100 },
  ports: [consumerPort],
};
const connectionStore = {
  ...value.store,
  cells: { ...value.store.cells, [consumerNode.id]: consumerNode },
};
const terminal: Terminal = {
  cellId: consumerNode.id,
  portId: consumerPort.id,
  anchor: attachment,
};
const portRef: PortRef = {
  kind: 'node',
  nodeId: consumerNode.id,
  portId: consumerPort.id,
};
const terminalRef: TerminalRef = {
  kind: 'edge',
  edgeId: 'connection',
  end: 'source',
};
const resolved = resolveTerminal(connectionStore, terminal);
if (
  !resolved ||
  resolved.point[0] !== 25 ||
  resolved.side !== 'right' ||
  resolvePort(consumerNode.geometry, consumerPort).point[0] !== 100 ||
  anchorFromPoint(
    consumerNode.geometry,
    resolveAnchor(consumerNode.geometry, attachment).point,
  )[0] !== 0.25 ||
  availablePorts(connectionStore, consumerNode, 'source').length !== 1 ||
  portKey(portRef.nodeId, portRef.portId) ===
    terminalKey(terminalRef.edgeId, terminalRef.end)
)
  throw new Error(
    'Public connection models or attachment resolution are missing',
  );
if (
  selectionAllows(
    value.store,
    [value.store.rootId],
    runtime.registry,
    'move',
  ) ||
  selectionAllows(
    value.store,
    [value.store.rootId],
    runtime.registry,
    'move',
    value.store.rootId,
  )
)
  throw new Error('Mounted root capabilities are not protected');
const routing = createEdgeRoutingContext(
  value.store,
  value.store.rootId,
  undefined,
  undefined,
  runtime.registry,
);
createEdgeRoutingContext(
  value.store,
  value.store.rootId,
  undefined,
  routing,
  runtime.registry,
);
const points = edgeRoutePoints(
  {
    id: 'route',
    kind: 'arrow',
    cellType: 'edge',
    source: { point: [0, 0] },
    target: { point: [200, 0] },
    route: { mode: 'auto' },
  },
  { point: [0, 0], side: 'right' },
  { point: [200, 0], side: 'left' },
  routing,
);
if (
  points.length !== 2 ||
  frameContentBounds(value.store, value.store.rootId, routing).width !== 0
)
  throw new Error('Shared routing API is missing');
if (!runtime.store.cells['consumer-root'] || !FrameCanvas)
  throw new Error('Cell/Frame consumer API is missing');
export const canvasProps: FrameCanvasProps = {
  value,
  onChange: ({ snapshot, transaction }) => {
    if (!snapshot.store || !transaction.id)
      throw new Error('Invalid FrameChange');
  },
};
export const readController = (controller: FrameCanvasController) =>
  controller.runtime.snapshot;
export const consumerReady = true;

// SDK migration contracts: these compile against actual public declarations.
import { createActionRegistry, type ActionDefinition } from '@sue/board-common';
import {
  ActionScope,
  CommandPalette,
  ActionHelp,
} from '@sue/board-react-actions';
import type { FrameUIPlugin } from '@sue/board-react';
import '@sue/board-react-actions/style.css';
const consumerAction: ActionDefinition<{ selected: boolean }> = {
  id: 'consumer.inspect',
  label: 'Inspect',
  category: 'consumer',
  effect: 'view',
  shortcuts: [{ key: 'i', mod: true }],
  shortcutWhen: (context) => context.selected,
  execute: () => ({ status: 'completed' }),
};
const consumerActions = createActionRegistry({
  getContext: () => ({ selected: true }),
});
consumerActions.register(consumerAction);
consumerActions.seal();
if (
  !ActionScope ||
  !CommandPalette ||
  !ActionHelp ||
  !consumerActions
    .actions()[0]
    .capture()
    .shortcutEnabled({ key: 'i', mod: true })
)
  throw new Error('Shared React action package is incomplete');
export const actionPlugin: FrameUIPlugin = {
  id: 'consumer-actions',
  engine: { id: 'consumer-actions', install() {} },
  actions: [
    {
      id: 'consumer.tool',
      label: 'Custom tool',
      category: 'consumer',
      effect: 'view',
      execute: () => ({ status: 'completed' }),
    },
  ],
  tools: [{ id: 'consumer.tool', actionId: 'consumer.tool' }],
};
export function verifyActionMigration(controller: FrameCanvasController) {
  controller.getActionState('canvas.selection.group');
  void controller.executeAction('canvas.view.fit');
  controller.actions().map((action) => action.capture());
  // @ts-expect-error Removed in the next SDK major: use getActionState(actionId).
  controller.selectionCommandState({ type: 'group' });
  // @ts-expect-error Removed in the next SDK major: use executeAction(actionId).
  void controller.executeSelectionCommand({ type: 'group' });
  // @ts-expect-error Reveal requests use typed targets and an async outcome.
  controller.revealCell('legacy');
}

export function verifyTypedActionHandle() {
  const registry = createActionRegistry({ getContext: () => ({}) });
  const setName = registry.register({
    id: 'consumer.set-name',
    label: 'Set name',
    category: 'consumer',
    effect: 'view',
    validateArgs: (args): args is { name: string } =>
      !!args &&
      typeof args === 'object' &&
      'name' in args &&
      typeof args.name === 'string',
    beforeQueue: async (_context, args, execution) => {
      const name: string = args.name;
      const invocationId: number = execution.invocationId;
      if (!name || !invocationId)
        return { status: 'rejected', code: 'invalid-preparation' };
      return execution.checkpoint();
    },
    execute: (_context, args) =>
      args.name ? { status: 'completed' } : { status: 'noop' },
  });
  void setName.execute({ name: 'Valid' });
  setName.capture().getState({ name: 'Captured' });
  // @ts-expect-error Typed handles require their declared argument shape.
  void setName.execute({ name: 5 });
  // @ts-expect-error Required action arguments cannot be omitted from typed handles.
  void setName.capture().execute();
  return setName;
}

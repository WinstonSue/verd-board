import {
  createCellStore,
  createFrameCell,
  createCellRuntime,
  createEdgeRoutingContext,
  edgeRoutePoints,
  frameContentBounds,
  selectionAllows,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasProps,
  type FrameCanvasController,
} from '@sue/board-react';
const value: FrameSnapshot = {
  store: createCellStore(createFrameCell('consumer-root')),
};
const runtime = createCellRuntime(value);
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
const routing = createEdgeRoutingContext(value.store, value.store.rootId);
createEdgeRoutingContext(value.store, value.store.rootId, undefined, routing);
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

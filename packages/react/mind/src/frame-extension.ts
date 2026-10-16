import {
  layoutMindCells,
  type MindMetricsOptions,
  mindPresentation,
  registerMindCells,
  resolveMindChildMove,
} from '@sue/board-mind';
import {
  isEdgeCell,
  type Cell,
  type CellRegistry,
  type CellStore,
  type NodeGeometry,
  type RectangleClient,
} from '@sue/board-core';
import { measureBoardText } from '@sue/board-react';
import type {
  FramePresentation,
  FrameRenderContext,
  FrameRenderExtension,
  FrameMovePreviewContext,
} from '@sue/board-react';
import { mindCellTextBounds, renderMindCellShape } from './mind-cell-renderer';
import { renderMindControls } from './mind-controls';
import { createElement } from 'react';
import { MindSummaryEdge } from './mind-summary-edge';
import { renderMindBranch } from './mind-branch';
export const createMindFrameExtensions = (
  registry: CellRegistry,
  options: MindMetricsOptions = {},
): FrameRenderExtension[] => {
  const metricsOptions = { measureText: measureBoardText, ...options };
  registerMindCells(registry);
  const caches = new WeakMap<
    CellStore,
    Map<string, Map<string, NodeGeometry>>
  >();
  // The store, cell and derived geometry are immutable. Camera changes do not
  // alter these inputs, so keep content measurements out of the zoom path.
  const nodeCaches = new WeakMap<
    CellStore,
    WeakMap<
      Cell,
      Map<
        string,
        {
          geometry?: NodeGeometry;
          textBounds?: RectangleClient;
          presentation?: FramePresentation;
        }
      >
    >
  >();
  // Text bounds depend on this cell and its actual geometry, not sibling edits.
  const textBounds = new WeakMap<
    Cell,
    WeakMap<NodeGeometry, RectangleClient>
  >();
  const nodeCache = ({
    store,
    cell,
    geometry,
    frameId,
  }: FrameRenderContext) => {
    let cells = nodeCaches.get(store);
    if (!cells) {
      cells = new WeakMap();
      nodeCaches.set(store, cells);
    }
    let frames = cells.get(cell);
    if (!frames) {
      frames = new Map();
      cells.set(cell, frames);
    }
    let result = frames.get(frameId);
    if (!result || result.geometry !== geometry) {
      result = { geometry };
      frames.set(frameId, result);
    }
    return result;
  };
  const layout = (store: CellStore, frameId: string) => {
    let frames = caches.get(store);
    if (!frames) {
      frames = new Map();
      caches.set(store, frames);
    }
    let result = frames.get(frameId);
    if (!result) {
      result = layoutMindCells(store, frameId, metricsOptions);
      frames.set(frameId, result);
    }
    return result;
  };
  return [
    {
      layout,
      visible: ({ store, cell, frameId }) => {
        if (!cell.kind.startsWith('mind-')) return true;
        const nodes = layout(store, frameId);
        return isEdgeCell(cell)
          ? 'cellId' in cell.source &&
              'cellId' in cell.target &&
              nodes.has(cell.source.cellId) &&
              nodes.has(cell.target.cellId)
          : nodes.has(cell.id);
      },
    },
    ...['mind-root', 'mind-child', 'mind-summary'].map((kind) => ({
      kind,
      previewMove:
        kind === 'mind-child'
          ? (context: FrameMovePreviewContext) => {
              const plan = resolveMindChildMove(
                context.store,
                context.cell,
                context.preview,
                undefined,
                context,
              );
              if (!plan.parentId) return { operations: plan.operations };
              const members = new Set([context.cell.id]);
              const edges = Object.values(context.store.cells).filter(
                isEdgeCell,
              );
              let changed = true;
              while (changed) {
                changed = false;
                for (const edge of edges) {
                  if (
                    edge.kind !== 'mind-branch' ||
                    !('cellId' in edge.source) ||
                    !('cellId' in edge.target)
                  )
                    continue;
                  if (
                    members.has(edge.source.cellId) &&
                    !members.has(edge.target.cellId)
                  ) {
                    members.add(edge.target.cellId);
                    changed = true;
                  }
                }
              }
              for (const edge of edges) {
                if (
                  edge.kind !== 'mind-summary-edge' ||
                  !('cellId' in edge.target)
                )
                  continue;
                const data = edge.data as
                  | { startSiblingId?: string; endSiblingId?: string }
                  | undefined;
                if (
                  data?.startSiblingId &&
                  data.endSiblingId &&
                  members.has(data.startSiblingId) &&
                  members.has(data.endSiblingId)
                ) {
                  members.add(edge.target.cellId);
                  members.add(edge.id);
                }
              }
              for (const edge of edges)
                if (
                  edge.kind === 'mind-branch' &&
                  'cellId' in edge.target &&
                  members.has(edge.target.cellId) &&
                  (('cellId' in edge.source &&
                    members.has(edge.source.cellId)) ||
                    edge.target.cellId === context.cell.id)
                )
                  members.add(edge.id);
              return {
                operations: plan.operations,
                ghost: { parentId: plan.parentId, cellIds: [...members] },
              };
            }
          : undefined,
      renderShape: (context: FrameRenderContext) =>
        renderMindCellShape(context, metricsOptions),
      textBounds: (context: FrameRenderContext) => {
        if (!context.geometry)
          return mindCellTextBounds(context, metricsOptions);
        let geometries = textBounds.get(context.cell);
        if (!geometries)
          textBounds.set(context.cell, (geometries = new WeakMap()));
        let bounds = geometries.get(context.geometry);
        if (!bounds)
          geometries.set(
            context.geometry,
            (bounds = mindCellTextBounds(context, metricsOptions)),
          );
        return bounds;
      },
      presentation: (context: FrameRenderContext) => {
        const { store, cell, frameId } = context;
        if (cell.cellType !== 'node') return undefined;
        const cached = nodeCache(context);
        return (cached.presentation ??= mindPresentation(store, cell, frameId));
      },
      renderControls: kind === 'mind-summary' ? undefined : renderMindControls,
    })),
    {
      kind: 'mind-summary-edge',
      render: (context) => createElement(MindSummaryEdge, context),
    },
    { kind: 'mind-branch', render: renderMindBranch },
  ];
};

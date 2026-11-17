import {
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  type Cell,
  type CellRegistry,
  type CellStore,
  type NodeGeometry,
  type RectangleClient,
} from '@sue/board-core';
import {
  layoutMindCells,
  mindPresentation,
  mindBranchColor,
  resolveMindChildMove,
  type MindMetricsOptions,
} from '@sue/board-mind';
import type {
  FrameMovePreviewContext,
  FramePresentation,
  FrameRenderContext,
  FrameRenderExtension,
  FrameThemeAppearanceContext,
  FrameViewProjection,
} from '@sue/board-react';
import { canonicalFrameProjection, measureBoardText } from '@sue/board-react';
import { createElement } from 'react';
import { renderMindBranch } from './mind-branch';
import { mindCellTextBounds, renderMindCellShape } from './mind-cell-renderer';
import { renderMindControls } from './mind-controls';
import { MindSummaryEdge } from './mind-summary-edge';
export const createMindFrameExtensions = (
  registry: CellRegistry,
  options: MindMetricsOptions = {},
): FrameRenderExtension[] => {
  if (!registry.plugins.some((plugin) => plugin.id === 'mind'))
    throw new Error(
      'Install createMindPlugin() through createCellRegistry before creating render extensions',
    );
  const metricsOptions = { measureText: measureBoardText, ...options };

  const caches = new WeakMap<
    object,
    WeakMap<CellStore, Map<string, Map<string, NodeGeometry>>>
  >();
  // The store, cell and derived geometry are immutable. Camera changes do not
  // alter these inputs, so keep content measurements out of the zoom path.
  const nodeCaches = new WeakMap<
    object,
    WeakMap<
      CellStore,
      WeakMap<
        Cell,
        Map<
          string,
          {
            geometry?: NodeGeometry;
            textBounds?: RectangleClient;
            presentation?: FramePresentation;
            appearance?: FrameRenderContext['appearance'];
          }
        >
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
    viewProjection,
  }: FrameRenderContext) => {
    let stores = nodeCaches.get(viewProjection.identity);
    if (!stores)
      nodeCaches.set(viewProjection.identity, (stores = new WeakMap()));
    let cells = stores.get(store);
    if (!cells) {
      cells = new WeakMap();
      stores.set(store, cells);
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
  const layout = (
    store: CellStore,
    frameId: string,
    projection: FrameViewProjection = canonicalFrameProjection,
  ) => {
    let stores = caches.get(projection.identity);
    if (!stores) caches.set(projection.identity, (stores = new WeakMap()));
    let frames = stores.get(store);
    if (!frames) {
      frames = new Map();
      stores.set(store, frames);
    }
    let result = frames.get(frameId);
    if (!result) {
      result = layoutMindCells(store, frameId, {
        ...metricsOptions,
        expandedCellIds:
          projection.purpose === 'export'
            ? undefined
            : projection.expandedCellIds,
      });
      frames.set(frameId, result);
    }
    return result;
  };
  return [
    {
      layout,
      // Other domains can virtualize even when the Mind plugin is installed.
      virtualizable: (store, frameId) => {
        const frame = store.cells[frameId];
        return (
          isFrameCell(frame) &&
          !frame.children.some((id) =>
            store.cells[id]?.kind.startsWith('mind-'),
          )
        );
      },
      layoutCacheKey: (store, frameId) => {
        const frame = store.cells[frameId];
        return isFrameCell(frame)
          ? [
              JSON.stringify(frame),
              ...frame.children.map((id) => store.cells[id]),
            ]
          : [frame];
      },
      visible: ({ store, cell, frameId, viewProjection }) => {
        if (!cell.kind.startsWith('mind-')) return true;
        const nodes = layout(store, frameId, viewProjection);
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
      themeAppearance: ({
        store,
        cell,
        frameId,
        theme,
      }: FrameThemeAppearanceContext) => {
        if (cell.cellType !== 'node' || !theme.adaptive) return undefined;
        const value = mindPresentation(store, cell, frameId, theme.appearance);
        return {
          fill: value.fill,
          strokeColor: value.stroke,
          textColor: value.color,
          styleFamily: value.styleFamily,
          styleLevel: value.styleLevel,
        };
      },
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
        if (!cached.presentation || cached.appearance !== context.appearance) {
          cached.appearance = context.appearance;
          cached.presentation = mindPresentation(
            store,
            cell,
            frameId,
            context.appearance,
          );
        }
        return cached.presentation;
      },
      renderControls: kind === 'mind-summary' ? undefined : renderMindControls,
    })),
    {
      kind: 'mind-summary-edge',
      themeAppearance: ({ store, cell, frameId, theme }) => {
        if (!isEdgeCell(cell) || !('cellId' in cell.source)) return undefined;
        const source = store.cells[cell.source.cellId];
        if (!isNodeCell(source)) return undefined;
        const value = mindPresentation(
          store,
          source,
          frameId,
          theme.adaptive ? theme.appearance : undefined,
        );
        return {
          strokeColor: value.stroke,
          styleFamily: value.styleFamily,
          styleLevel: 'node',
        };
      },
      render: (context) => createElement(MindSummaryEdge, context),
    },
    {
      kind: 'mind-branch',
      render: renderMindBranch,
      themeAppearance: ({ store, cell, frameId, theme }) =>
        isEdgeCell(cell) && 'cellId' in cell.target
          ? {
              strokeColor: mindBranchColor(
                store,
                cell.target.cellId,
                frameId,
                theme.adaptive ? theme.appearance : undefined,
              ),
            }
          : undefined,
    },
  ];
};

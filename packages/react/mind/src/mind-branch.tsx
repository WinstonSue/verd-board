import {
  edgeRoutePoints,
  isEdgeCell,
  isNodeCell,
  polylinePath,
  resolvePort,
  terminalCurvePath,
  resolveThemeColor,
  resolveBoardTheme,
  type NodeGeometry,
} from '@sue/board-core';
import {
  mindBranchColor,
  mindBranchPorts,
  resolvedMindBranchShape,
} from '@sue/board-mind';
import type { FrameRenderContext } from '@sue/board-react';
import { memo, useMemo } from 'react';

const branchDrawing = (
  context: Pick<
    FrameRenderContext,
    | 'store'
    | 'cell'
    | 'getGeometry'
    | 'frameId'
    | 'selected'
    | 'appearance'
    | 'theme'
  >,
) => {
  const { store, cell, getGeometry, frameId } = context;
  if (
    !isEdgeCell(cell) ||
    !('cellId' in cell.target) ||
    !('cellId' in cell.source)
  )
    return null;
  const targetNode = store.cells[cell.target.cellId];
  const sourceNode = store.cells[cell.source.cellId];
  if (!isNodeCell(targetNode) || !isNodeCell(sourceNode)) return null;
  const geometry = new Map<string, NodeGeometry>();
  for (const id of [cell.source.cellId, cell.target.cellId]) {
    const bounds = getGeometry(id);
    if (bounds) geometry.set(id, bounds);
  }
  const sourceBounds = geometry.get(sourceNode.id) ?? sourceNode.geometry;
  const targetBounds = geometry.get(targetNode.id) ?? targetNode.geometry;
  const ports = mindBranchPorts(store, cell);
  const source = ports
    ? resolvePort(sourceBounds, ports.source)
    : {
        point: [
          sourceBounds.x + sourceBounds.width,
          sourceBounds.y + sourceBounds.height / 2,
        ] as [number, number],
        side: 'right' as const,
      };
  const target = ports
    ? resolvePort(targetBounds, ports.target)
    : {
        point: [targetBounds.x, targetBounds.y + targetBounds.height / 2] as [
          number,
          number,
        ],
        side: 'left' as const,
      };
  const shape =
    resolvedMindBranchShape(store, targetNode.id) ??
    (cell.route.mode === 'orthogonal' || cell.route.mode === 'straight'
      ? 'polyline'
      : 'bight');
  const path =
    shape === 'bight'
      ? terminalCurvePath(source, target)
      : polylinePath(
          edgeRoutePoints(
            { ...cell, route: { mode: 'orthogonal' } },
            source,
            target,
          ),
        );
  const stroke = resolveThemeColor(
    cell.appearance?.strokeColor,
    cell.appearance?.colorSources?.strokeColor,
    mindBranchColor(store, targetNode.id, frameId, context.appearance) ??
      (context.theme ?? resolveBoardTheme()).stroke,
    context.theme ?? resolveBoardTheme(),
  );
  const width =
    (
      targetNode.data as
        { branchAppearance?: { strokeWidth?: number } } | undefined
    )?.branchAppearance?.strokeWidth ??
    cell.appearance?.strokeWidth ??
    2;
  const style = (
    targetNode.data as
      { branchAppearance?: { strokeStyle?: string } } | undefined
  )?.branchAppearance?.strokeStyle;
  return {
    path,
    stroke,
    width,
    style,
    shape,
    sourceSide: source.side,
    targetSide: target.side,
    cellId: cell.id,
  };
};
const VisibleBranch = memo(function VisibleBranch({
  drawing,
}: {
  drawing: NonNullable<ReturnType<typeof branchDrawing>>;
}) {
  return (
    <path
      d={drawing.path}
      data-frame-node-outline
      fill="none"
      stroke={drawing.stroke}
      strokeWidth={drawing.width}
      strokeDasharray={
        drawing.style === 'dashed'
          ? '8 4'
          : drawing.style === 'dotted'
            ? '2 4'
            : undefined
      }
    />
  );
});
function MindBranch(context: FrameRenderContext) {
  const {
    store,
    cell,
    getGeometry,
    frameId,
    selected,
    scale,
    appearance,
    theme,
  } = context;
  const drawing = useMemo(
    () =>
      branchDrawing({
        store,
        cell,
        getGeometry,
        frameId,
        selected,
        appearance,
        theme,
      }),
    [store, cell, getGeometry, frameId, selected, appearance, theme],
  );
  if (!drawing) return null;
  return (
    <g
      data-mind-branch-shape={drawing.shape}
      data-mind-source-side={drawing.sourceSide}
      data-mind-target-side={drawing.targetSide}
    >
      <VisibleBranch drawing={drawing} />
      <path
        d={drawing.path}
        fill="none"
        stroke="transparent"
        strokeWidth={12 / Math.max(0.02, scale)}
        data-edge-hit={drawing.cellId}
      />
    </g>
  );
}
export const renderMindBranch = (context: FrameRenderContext) => (
  <MindBranch {...context} />
);

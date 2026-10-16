import type { RectangleClient } from '../interfaces/rectangle-client';
import type { Point } from '../interfaces/point';
import {
  isFrameCell,
  isNodeCell,
  isEdgeCell,
  type CellStore,
  type CellId,
  type FrameCell,
} from './types';
import { sceneAnchorKind } from './kinds';
import {
  createEdgeRoutingContext,
  edgePolyline,
  type EdgeRoutingContext,
} from '../geometry/edge';
import { edgeLabelLayout } from '../geometry/edge-label';

export interface FrameTransform {
  scale: number;
  offset: Point;
}
export const frameTitleHeight = 24;
export const frameTitleGap = 8;
export const frameMinimumSize = 80;
export const frameTitleBounds = (
  geometry: FrameCell['geometry'],
  padding = 16,
): RectangleClient => ({
  x: geometry.x + Math.min(padding, geometry.width / 2),
  y: geometry.y + Math.min(padding, geometry.height / 2),
  width: Math.max(0, geometry.width - padding * 2),
  height: Math.min(
    frameTitleHeight,
    Math.max(0, geometry.height - padding * 2),
  ),
});
/** The same rectangle is used for content fit, clipping and the visible plate. */
export const frameContentViewport = (
  geometry: FrameCell['geometry'],
  padding = 16,
): RectangleClient => {
  const title = frameTitleBounds(geometry, padding);
  const y = Math.min(
    geometry.y + geometry.height,
    title.y + title.height + frameTitleGap,
  );
  return {
    x: title.x,
    y,
    width: title.width,
    height: Math.max(0, geometry.y + geometry.height - padding - y),
  };
};
export const frameVisualBounds = (
  geometry: FrameCell['geometry'],
): RectangleClient => ({ ...geometry });
export const frameScene = (store: CellStore, frameId: CellId) => {
  const frame = store.cells[frameId];
  return frame && isFrameCell(frame)
    ? sceneAnchorKind(
        frame.children.flatMap((id) =>
          store.cells[id] ? [store.cells[id].kind] : [],
        ),
      )
    : undefined;
};
export const frameContentBounds = (
  store: CellStore,
  frameId: string,
  routing?: EdgeRoutingContext,
): RectangleClient => {
  const frame = store.cells[frameId];
  const nodes =
    frame && isFrameCell(frame)
      ? frame.children
          .map((id) => store.cells[id])
          .filter(
            (cell) =>
              cell &&
              isNodeCell(cell) &&
              !cell.hidden &&
              [
                cell.geometry.x,
                cell.geometry.y,
                cell.geometry.width,
                cell.geometry.height,
              ].every(Number.isFinite),
          )
      : [];
  routing ??= createEdgeRoutingContext(store, frameId);
  const extraPoints =
    frame && isFrameCell(frame)
      ? frame.children.flatMap((id) => {
          const edge = store.cells[id];
          if (!isEdgeCell(edge) || edge.hidden) return [];
          if (
            (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal') &&
            !('points' in edge.route && edge.route.points?.length) &&
            edge.kind !== 'mind-branch' &&
            edge.kind !== 'mind-summary-edge'
          ) {
            const points = edgePolyline(store, edge, undefined, routing);
            return [
              ...points,
              ...(edge.labels ?? []).flatMap((_, at): Point[] => {
                const { bounds } = edgeLabelLayout(edge, at, points, routing);
                return [
                  [bounds.x, bounds.y],
                  [bounds.x + bounds.width, bounds.y + bounds.height],
                ];
              }),
            ];
          }
          return [
            ...('point' in edge.source ? [edge.source.point] : []),
            ...('point' in edge.target ? [edge.target.point] : []),
            ...('points' in edge.route ? (edge.route.points ?? []) : []),
          ].filter((point) => point.every(Number.isFinite));
        })
      : [];
  if (!nodes.length && !extraPoints.length)
    return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(
    ...nodes.map((cell) => (isNodeCell(cell) ? cell.geometry.x : 0)),
    ...extraPoints.map((point) => point[0]),
  );
  const top = Math.min(
    ...nodes.map((cell) => (isNodeCell(cell) ? cell.geometry.y : 0)),
    ...extraPoints.map((point) => point[1]),
  );
  const right = Math.max(
    ...nodes.map((cell) =>
      isNodeCell(cell) ? cell.geometry.x + cell.geometry.width : 0,
    ),
    ...extraPoints.map((point) => point[0]),
  );
  const bottom = Math.max(
    ...nodes.map((cell) =>
      isNodeCell(cell) ? cell.geometry.y + cell.geometry.height : 0,
    ),
    ...extraPoints.map((point) => point[1]),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
};
export const fitFrameContent = (
  frame: FrameCell,
  content: RectangleClient,
  padding = 16,
): FrameTransform => {
  const viewport = frameContentViewport(frame.geometry, padding);
  const scale = Math.min(
    1,
    content.width > 0 ? viewport.width / content.width : 1,
    content.height > 0 ? viewport.height / content.height : 1,
  );
  return {
    scale,
    offset: [
      viewport.x +
        (viewport.width - content.width * scale) / 2 -
        content.x * scale,
      viewport.y +
        (viewport.height - content.height * scale) / 2 -
        content.y * scale,
    ],
  };
};
export const frameToParentPoint = (
  point: Point,
  transform: FrameTransform,
): Point => [
  point[0] * transform.scale + transform.offset[0],
  point[1] * transform.scale + transform.offset[1],
];
export const parentToFramePoint = (
  point: Point,
  transform: FrameTransform,
): Point => {
  if (transform.scale <= 0 || !Number.isFinite(transform.scale))
    throw new Error('Frame transform is not invertible');
  return [
    (point[0] - transform.offset[0]) / transform.scale,
    (point[1] - transform.offset[1]) / transform.scale,
  ];
};

/** Resolve canonical content coordinates independently of any mounted detail viewport. */
export const convertFramePoint = (
  store: CellStore,
  point: Point,
  sourceFrameId: string,
  targetFrameId: string,
): Point => {
  const parents = new Map<string, string>();
  Object.values(store.cells)
    .filter(isFrameCell)
    .forEach((frame) =>
      frame.children.forEach((id) => {
        if (isFrameCell(store.cells[id])) parents.set(id, frame.id);
      }),
    );
  const path = (id: string) => {
    const result: string[] = [];
    while (true) {
      if (!isFrameCell(store.cells[id]) || result.includes(id))
        throw new Error('Invalid frame coordinate path');
      result.push(id);
      const parent = parents.get(id);
      if (!parent) return result;
      id = parent;
    }
  };
  const source = path(sourceFrameId),
    target = path(targetFrameId);
  const shared = source.find((id) => target.includes(id));
  if (!shared) throw new Error('Frames have no shared coordinate space');
  let converted: Point = [...point];
  for (const id of source.slice(0, source.indexOf(shared)))
    converted = frameToParentPoint(
      converted,
      fitFrameContent(
        store.cells[id] as FrameCell,
        frameContentBounds(store, id),
      ),
    );
  for (const id of target.slice(0, target.indexOf(shared)).reverse())
    converted = parentToFramePoint(
      converted,
      fitFrameContent(
        store.cells[id] as FrameCell,
        frameContentBounds(store, id),
      ),
    );
  return converted;
};

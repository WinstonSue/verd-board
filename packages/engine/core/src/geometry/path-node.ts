import type { NodeCell, NodeGeometry } from '../cell/types';
import type { Point } from '../interfaces/point';
import { curvePath, flattenCurve } from './edge';
import { distanceToPolyline, polylinePath } from './polyline';
import { unrotateNodePoint } from './node';

export interface VectorLineData {
  points: Point[];
  shape: 'straight' | 'curve';
}
export const isClosedPath = (points: readonly Point[]) =>
  points.length > 2 &&
  points[0][0] === points.at(-1)![0] &&
  points[0][1] === points.at(-1)![1];
export function pathNodePoints(
  cell: NodeCell<VectorLineData>,
  geometry: NodeGeometry = cell.geometry,
): Point[] {
  return cell.data!.points.map(([x, y]) => [
    geometry.x + (x * geometry.width) / cell.geometry.width,
    geometry.y + (y * geometry.height) / cell.geometry.height,
  ]);
}
export function vectorLinePath(
  points: readonly Point[],
  shape: VectorLineData['shape'],
): string {
  return (
    (shape === 'curve' ? curvePath(points) : polylinePath(points)) +
    (isClosedPath(points) ? ' Z' : '')
  );
}
export function hitVectorLine(
  cell: NodeCell<VectorLineData>,
  point: Point,
  tolerance = 6,
): boolean {
  const points = pathNodePoints(cell),
    outline = cell.data!.shape === 'curve' ? flattenCurve(points) : points;
  const local = unrotateNodePoint(cell.geometry, point);
  if (
    distanceToPolyline(local, outline) <=
    tolerance + (cell.appearance?.strokeWidth ?? 2) / 2
  )
    return true;
  if (
    !isClosedPath(points) ||
    !cell.appearance?.fill ||
    ['none', 'transparent'].includes(cell.appearance.fill)
  )
    return false;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i],
      b = outline[j];
    if (
      a[1] > local[1] !== b[1] > local[1] &&
      local[0] < ((b[0] - a[0]) * (local[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Rebase authored points while retaining their world positions, even after rotation. */
export function replaceVectorLinePoints(
  cell: NodeCell<VectorLineData>,
  points: Point[],
): NodeCell<VectorLineData> {
  if (
    points.length < 2 ||
    points.some(
      (point) =>
        point.length !== 2 || point.some((value) => !Number.isFinite(value)),
    )
  )
    throw new Error('Vector line requires finite points');
  const sampled = cell.data!.shape === 'curve' ? flattenCurve(points) : points;
  const x = Math.min(...sampled.map((p) => p[0])),
    y = Math.min(...sampled.map((p) => p[1]));
  const width = Math.max(1, Math.max(...sampled.map((p) => p[0])) - x),
    height = Math.max(1, Math.max(...sampled.map((p) => p[1])) - y);
  const dx = cell.geometry.x + cell.geometry.width / 2 - (x + width / 2),
    dy = cell.geometry.y + cell.geometry.height / 2 - (y + height / 2),
    angle = cell.geometry.rotation ?? 0;
  const tx = dx - dx * Math.cos(angle) + dy * Math.sin(angle),
    ty = dy - dx * Math.sin(angle) - dy * Math.cos(angle);
  return {
    ...cell,
    geometry: { ...cell.geometry, x: x + tx, y: y + ty, width, height },
    data: { ...cell.data!, points: points.map(([px, py]) => [px - x, py - y]) },
  };
}
export function moveVectorLinePoint(
  cell: NodeCell<VectorLineData>,
  index: number,
  point: Point,
  insert = false,
  snapTolerance = 0,
): NodeCell<VectorLineData> {
  const points = pathNodePoints(cell),
    closed = isClosedPath(points);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= points.length ||
    (insert && index === points.length - 1)
  )
    throw new Error('Missing vector line point');
  if (insert) points.splice(index + 1, 0, [...point]);
  else {
    const other = index === 0 ? points.at(-1)! : points[0];
    const end = index === 0 || index === points.length - 1;
    const next: Point =
      !closed &&
      end &&
      Math.hypot(point[0] - other[0], point[1] - other[1]) <= snapTolerance
        ? [...other]
        : [...point];
    points[index] = next;
    if (closed && end) {
      points[0] = [...next];
      points[points.length - 1] = [...next];
    }
  }
  return replaceVectorLinePoints(cell, points);
}
export function removeVectorLinePoint(
  cell: NodeCell<VectorLineData>,
  index: number,
): NodeCell<VectorLineData> {
  const points = pathNodePoints(cell),
    closed = isClosedPath(points),
    count = points.length - (closed ? 1 : 0);
  if (count <= 2 || index < 0 || index >= count)
    throw new Error('Vector line requires two vertices');
  points.splice(index, 1);
  if (closed) points[points.length - 1] = [...points[0]];
  return replaceVectorLinePoints(cell, points);
}

export function vectorLineMidpoints(
  points: readonly Point[],
  shape: VectorLineData['shape'],
): Point[] {
  if (shape === 'curve' && points.length > 2)
    return flattenCurve(points, 2).filter((_, index) => index % 2 === 1);
  return points
    .slice(1)
    .map((point, index) => [
      (points[index][0] + point[0]) / 2,
      (points[index][1] + point[1]) / 2,
    ]);
}
export function setVectorLineShape(
  cell: NodeCell<VectorLineData>,
  shape: VectorLineData['shape'],
): NodeCell<VectorLineData> {
  return replaceVectorLinePoints(
    { ...cell, data: { ...cell.data!, shape } },
    pathNodePoints(cell),
  );
}

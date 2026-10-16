import type { Point } from '../interfaces/point';
import type { NodeCell, NodeGeometry } from '../cell/types';
import type { NodeOutline } from './shape';
import {
  createDefaultShapeGeometryRegistry,
  type ShapeGeometryRegistry,
} from './registry';
import { pathGeometry } from './shape-path';

const shapes = createDefaultShapeGeometryRegistry();
export const nodeShapeGeometry = (
  outline: NodeOutline = 'rectangle',
  registry: ShapeGeometryRegistry = shapes,
) => {
  const kind = typeof outline === 'object' ? outline.kind : outline;
  if (
    typeof outline === 'object' &&
    outline.radius !== undefined &&
    ['rectangle', 'roundRectangle', 'terminal'].includes(kind)
  ) {
    return pathGeometry(({ x, y, width: w, height: h }, p) => {
      const r = Math.max(0, Math.min(outline.radius!, w / 2, h / 2));
      p.move(x + r, y)
        .line(x + w - r, y)
        .arc(r, r, false, true, x + w, y + r)
        .line(x + w, y + h - r)
        .arc(r, r, false, true, x + w - r, y + h)
        .line(x + r, y + h)
        .arc(r, r, false, true, x, y + h - r)
        .line(x, y + r)
        .arc(r, r, false, true, x + r, y)
        .close();
    });
  }
  return registry.get(kind);
};
export const unrotateNodePoint = (
  geometry: NodeGeometry,
  point: Point,
): Point => {
  const angle = -(geometry.rotation ?? 0),
    cx = geometry.x + geometry.width / 2,
    cy = geometry.y + geometry.height / 2;
  return [
    cx + (point[0] - cx) * Math.cos(angle) - (point[1] - cy) * Math.sin(angle),
    cy + (point[0] - cx) * Math.sin(angle) + (point[1] - cy) * Math.cos(angle),
  ];
};
export const hitNodeShape = (
  cell: NodeCell,
  point: Point,
  tolerance = 6,
  geometry = cell.geometry,
) => {
  const fill = cell.appearance?.fill ?? '#fff';
  return (nodeShapeGeometry(geometry.outline) ?? shapes.get('rectangle')!).hit(
    geometry,
    unrotateNodePoint(geometry, point),
    !['none', 'transparent'].includes(fill),
    tolerance,
  );
};

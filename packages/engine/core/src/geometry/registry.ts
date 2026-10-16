import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import { distanceToPolyline } from './polyline';
import { builtinShapeGeometries } from './builtin-shapes';
import type { GeometrySide } from './side';

export interface ShapePathPart {
  d: string;
  fill?: 'none';
  strokeDasharray?: string;
}

export interface ShapeGeometry {
  path(bounds: RectangleClient): string;
  parts?(bounds: RectangleClient): ShapePathPart[];
  textBounds?(bounds: RectangleClient): RectangleClient;
  nearest?(bounds: RectangleClient, point: Point): Point;
  anchor?(bounds: RectangleClient, side: GeometrySide, offset: number): Point;
  hit(
    bounds: RectangleClient,
    point: Point,
    filled: boolean,
    tolerance?: number,
  ): boolean;
}
export const createShapeGeometryRegistry = () => {
  const shapes = new Map<string, ShapeGeometry>();
  return {
    register(kind: string, geometry: ShapeGeometry) {
      if (shapes.has(kind)) throw new Error(`Duplicate geometry: ${kind}`);
      shapes.set(kind, geometry);
    },
    get(kind: string) {
      return shapes.get(kind);
    },
    kinds() {
      return [...shapes.keys()];
    },
  };
};
export type ShapeGeometryRegistry = ReturnType<
  typeof createShapeGeometryRegistry
>;
export const polygonGeometry = (
  normalized: readonly Point[],
): ShapeGeometry => {
  const points = (bounds: RectangleClient): Point[] =>
    normalized.map(([x, y]) => [
      bounds.x + x * bounds.width,
      bounds.y + y * bounds.height,
    ]);
  return {
    path(bounds) {
      return (
        points(bounds)
          .map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`)
          .join(' ') + ' Z'
      );
    },
    hit(bounds, point, filled, tolerance = 6) {
      const polygon = points(bounds);
      if (distanceToPolyline(point, [...polygon, polygon[0]]) <= tolerance)
        return true;
      if (!filled) return false;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i],
          b = polygon[j];
        if (
          a[1] > point[1] !== b[1] > point[1] &&
          point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
        )
          inside = !inside;
      }
      return inside;
    },
  };
};
export const regularPolygonGeometry = (
  sides: number,
  star = false,
): ShapeGeometry =>
  polygonGeometry(
    Array.from({ length: star ? sides * 2 : sides }, (_, i) => {
      const angle =
          -Math.PI / 2 + (i * Math.PI * 2) / (star ? sides * 2 : sides),
        radius = star && i % 2 ? 0.22 : 0.5;
      return [
        0.5 + Math.cos(angle) * radius,
        0.5 + Math.sin(angle) * radius,
      ] as Point;
    }),
  );
export const ellipseGeometry: ShapeGeometry = {
  path({ x, y, width: w, height: h }) {
    return `M ${x + w} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 0 ${x} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 0 ${x + w} ${y + h / 2} Z`;
  },
  hit(bounds, point, filled, tolerance = 6) {
    const rx = bounds.width / 2,
      ry = bounds.height / 2;
    if (!rx || !ry) return false;
    const norm = Math.hypot(
      (point[0] - bounds.x - rx) / rx,
      (point[1] - bounds.y - ry) / ry,
    );
    return filled
      ? norm <= 1 + tolerance / Math.min(rx, ry)
      : Math.abs(norm - 1) <= tolerance / Math.min(rx, ry);
  },
};
export const createDefaultShapeGeometryRegistry = (): ShapeGeometryRegistry => {
  const registry = createShapeGeometryRegistry();
  Object.entries(builtinShapeGeometries).forEach(([kind, geometry]) =>
    registry.register(kind, geometry),
  );
  return registry;
};

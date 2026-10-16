import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { ShapeGeometry, ShapePathPart } from './registry';
import { distanceToPolyline } from './polyline';
import { sideAnchor, type GeometrySide } from './side';

interface Contour {
  commands: string[];
  points: Point[];
  closed: boolean;
  fill: boolean;
}
const insidePolygon = (point: Point, points: Point[]) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};

/** SVG commands and their sampled contours come from the same geometry. No DOM is needed. */
export class ShapePath {
  readonly contours: Contour[] = [];
  private get current() {
    return this.contours[this.contours.length - 1];
  }
  private get point() {
    return this.current.points[this.current.points.length - 1];
  }
  move(x: number, y: number, fill = true) {
    this.contours.push({
      commands: [`M ${x} ${y}`],
      points: [[x, y]],
      closed: false,
      fill,
    });
    return this;
  }
  line(x: number, y: number) {
    this.current.commands.push(`L ${x} ${y}`);
    this.current.points.push([x, y]);
    return this;
  }
  cubic(ax: number, ay: number, bx: number, by: number, x: number, y: number) {
    const [sx, sy] = this.point;
    this.current.commands.push(`C ${ax} ${ay} ${bx} ${by} ${x} ${y}`);
    const steps = Math.max(
      8,
      Math.min(
        2048,
        Math.ceil(
          (Math.hypot(ax - sx, ay - sy) +
            Math.hypot(bx - ax, by - ay) +
            Math.hypot(x - bx, y - by)) /
            3,
        ),
      ),
    );
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      this.current.points.push([
        u ** 3 * sx + 3 * u ** 2 * t * ax + 3 * u * t ** 2 * bx + t ** 3 * x,
        u ** 3 * sy + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * y,
      ]);
    }
    return this;
  }
  quad(ax: number, ay: number, x: number, y: number) {
    const [sx, sy] = this.point;
    return this.cubic(
      sx + (2 / 3) * (ax - sx),
      sy + (2 / 3) * (ay - sy),
      x + (2 / 3) * (ax - x),
      y + (2 / 3) * (ay - y),
      x,
      y,
    );
  }
  /** Axis-aligned SVG endpoint arc, including the mandatory radius correction. */
  arc(
    rx: number,
    ry: number,
    large: boolean,
    sweep: boolean,
    x: number,
    y: number,
  ) {
    const [sx, sy] = this.point;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) return this.line(x, y);
    if (sx === x && sy === y) return this;
    this.current.commands.push(
      `A ${rx} ${ry} 0 ${large ? 1 : 0} ${sweep ? 1 : 0} ${x} ${y}`,
    );
    const dx = (sx - x) / 2,
      dy = (sy - y) / 2;
    const scale = Math.sqrt(dx ** 2 / rx ** 2 + dy ** 2 / ry ** 2);
    if (scale > 1) {
      rx *= scale;
      ry *= scale;
    }
    const numerator = Math.max(
      0,
      rx ** 2 * ry ** 2 - rx ** 2 * dy ** 2 - ry ** 2 * dx ** 2,
    );
    const denominator = rx ** 2 * dy ** 2 + ry ** 2 * dx ** 2;
    const factor =
      (large === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
    const cx = (sx + x) / 2 + (factor * rx * dy) / ry;
    const cy = (sy + y) / 2 - (factor * ry * dx) / rx;
    const start = Math.atan2((sy - cy) / ry, (sx - cx) / rx);
    let delta = Math.atan2((y - cy) / ry, (x - cx) / rx) - start;
    if (sweep && delta < 0) delta += Math.PI * 2;
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    const steps = Math.max(
      8,
      Math.min(2048, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / 3)),
    );
    for (let i = 1; i <= steps; i++) {
      const angle = start + (delta * i) / steps;
      this.current.points.push([
        cx + rx * Math.cos(angle),
        cy + ry * Math.sin(angle),
      ]);
    }
    this.current.points[this.current.points.length - 1] = [x, y];
    return this;
  }
  close() {
    this.current.commands.push('Z');
    this.current.points.push(this.current.points[0]);
    this.current.closed = true;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, fill = true) {
    return this.move(x, y, fill)
      .line(x + w, y)
      .line(x + w, y + h)
      .line(x, y + h)
      .close();
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, fill = true) {
    return this.move(cx + rx, cy, fill)
      .arc(rx, ry, false, true, cx - rx, cy)
      .arc(rx, ry, false, true, cx + rx, cy)
      .close();
  }
  parts(): ShapePathPart[] {
    return this.contours.map((contour) => ({
      d: contour.commands.join(' '),
      fill: contour.closed && contour.fill ? undefined : 'none',
    }));
  }
  hit(point: Point, filled: boolean, tolerance: number) {
    return this.contours.some(
      (contour) =>
        distanceToPolyline(point, contour.points) <= tolerance ||
        (filled &&
          contour.closed &&
          contour.fill &&
          insidePolygon(point, contour.points)),
    );
  }
  nearest(point: Point): Point {
    let result = point,
      distance = Infinity;
    this.contours.forEach(({ points }) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
              (dx ** 2 + dy ** 2 || 1),
          ),
        );
        const p: Point = [a[0] + dx * t, a[1] + dy * t];
        const d = Math.hypot(point[0] - p[0], point[1] - p[1]);
        if (d < distance) {
          distance = d;
          result = p;
        }
      }
    });
    return result;
  }
  anchor(bounds: RectangleClient, side: GeometrySide, offset: number): Point {
    const point = sideAnchor(bounds, side, offset),
      horizontal = side === 'left' || side === 'right';
    const intersections: Point[] = [];
    this.contours.forEach(({ points }) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          axis = horizontal ? 1 : 0;
        if (a[axis] === b[axis]) {
          if (Math.abs(point[axis] - a[axis]) < 1e-8) intersections.push(a, b);
          continue;
        }
        const t = (point[axis] - a[axis]) / (b[axis] - a[axis]);
        if (t >= 0 && t <= 1)
          intersections.push([
            a[0] + t * (b[0] - a[0]),
            a[1] + t * (b[1] - a[1]),
          ]);
      }
    });
    const coordinate = horizontal ? 0 : 1,
      direction = side === 'left' || side === 'top' ? 1 : -1;
    intersections.sort((a, b) => direction * (a[coordinate] - b[coordinate]));
    return intersections[0] ?? this.nearest(point);
  }
}

export const pathGeometry = (
  draw: (bounds: RectangleClient, path: ShapePath) => void,
  textBounds?: (bounds: RectangleClient) => RectangleClient,
  strokeDasharray?: string,
): ShapeGeometry => {
  const build = (bounds: RectangleClient) => {
    const path = new ShapePath();
    draw(bounds, path);
    return path;
  };
  return {
    path: (bounds) =>
      build(bounds)
        .parts()
        .map((part) => part.d)
        .join(' '),
    parts: (bounds) =>
      build(bounds)
        .parts()
        .map((part) => ({ ...part, strokeDasharray })),
    hit: (bounds, point, filled, tolerance = 6) =>
      build(bounds).hit(point, filled, tolerance),
    nearest: (bounds, point) => build(bounds).nearest(point),
    anchor: (bounds, side, offset) =>
      build(bounds).anchor(bounds, side, offset),
    textBounds,
  };
};

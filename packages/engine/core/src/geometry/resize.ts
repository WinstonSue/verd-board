import type { NodeGeometry } from '../cell/types';
import type { Point } from '../interfaces/point';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const resizeHandles: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];
export const resizeHandleDirection = (handle: ResizeHandle): Point => [
  handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
  handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0,
];
export const resizeHandlePoint = (
  g: NodeGeometry,
  handle: ResizeHandle,
): Point => {
  const [hx, hy] = resizeHandleDirection(handle);
  return [g.x + (g.width * (hx + 1)) / 2, g.y + (g.height * (hy + 1)) / 2];
};
/** Keeps the opposite edge/corner fixed, even when the node is rotated. */
export const resizeNodeGeometry = (
  g: NodeGeometry,
  handle: ResizeHandle,
  delta: Point,
  options: {
    preserveRatio?: boolean;
    fromCenter?: boolean;
    minSize?: number;
  } = {},
): NodeGeometry => {
  const angle = g.rotation ?? 0,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const [hx, hy] = resizeHandleDirection(handle),
    dx = delta[0] * cos + delta[1] * sin,
    dy = -delta[0] * sin + delta[1] * cos;
  const multiplier = options.fromCenter ? 2 : 1,
    min = options.minSize ?? 8;
  let width = hx ? Math.max(min, g.width + hx * dx * multiplier) : g.width;
  let height = hy ? Math.max(min, g.height + hy * dy * multiplier) : g.height;
  if (options.preserveRatio && g.width > 0 && g.height > 0) {
    const scale =
      hx && hy
        ? Math.abs(width / g.width - 1) >= Math.abs(height / g.height - 1)
          ? width / g.width
          : height / g.height
        : hx
          ? width / g.width
          : height / g.height;
    const safeScale = Math.max(min / g.width, min / g.height, scale);
    width = g.width * safeScale;
    height = g.height * safeScale;
  }
  const localX = options.fromCenter ? 0 : (hx * (width - g.width)) / 2;
  const localY = options.fromCenter ? 0 : (hy * (height - g.height)) / 2;
  return {
    ...g,
    x: g.x + g.width / 2 + localX * cos - localY * sin - width / 2,
    y: g.y + g.height / 2 + localX * sin + localY * cos - height / 2,
    width,
    height,
    derived: false,
  };
};
export const rotateNodeGeometry = (
  g: NodeGeometry,
  from: Point,
  to: Point,
  snap = false,
): NodeGeometry => {
  const cx = g.x + g.width / 2,
    cy = g.y + g.height / 2;
  let rotation =
    (g.rotation ?? 0) +
    Math.atan2(to[1] - cy, to[0] - cx) -
    Math.atan2(from[1] - cy, from[0] - cx);
  if (snap) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
  rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
  if (!Number.isFinite(rotation)) return { ...g, derived: false };
  return { ...g, rotation, derived: false };
};

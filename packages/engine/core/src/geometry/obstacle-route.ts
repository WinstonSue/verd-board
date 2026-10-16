import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { GeometrySide } from './side';
import { routeOrthogonal, simplifyOrthogonal } from './route';

export interface RoutingObstacle extends RectangleClient {
  id: string;
}

export interface OrthogonalRoutingOptions {
  sourceId?: string;
  targetId?: string;
  clearance?: number;
  strokeWidth?: number;
  bendPenalty?: number;
  /** Previously planned edges are soft obstacles, never impassable walls. */
  occupied?: readonly RoutingSegment[];
}

export interface RoutingSegment {
  start: Point;
  end: Point;
}

const laneGap = 12;
const overlapLength = (a: number, b: number, c: number, d: number) =>
  Math.max(
    0,
    Math.min(Math.max(a, b), Math.max(c, d)) -
      Math.max(Math.min(a, b), Math.min(c, d)),
  );

/** Length-weighted congestion and discrete crossing cost. */
export const routingSegmentPenalty = (
  a: Point,
  b: Point,
  segments: readonly RoutingSegment[],
) => {
  const horizontal = a[1] === b[1],
    axis = horizontal ? 0 : 1,
    across = 1 - axis;
  let penalty = 0;
  for (const { start, end } of segments) {
    if ((start[1] === end[1]) === horizontal) {
      const gap = Math.abs(a[across] - start[across]);
      if (gap < laneGap)
        penalty +=
          overlapLength(a[axis], b[axis], start[axis], end[axis]) *
          (gap < epsilon ? 8 : 2 * (1 - gap / laneGap));
    } else if (
      start[axis] > Math.min(a[axis], b[axis]) &&
      start[axis] <= Math.max(a[axis], b[axis]) &&
      a[across] > Math.min(start[across], end[across]) &&
      a[across] < Math.max(start[across], end[across])
    )
      penalty += 160;
  }
  return penalty;
};

export interface OrthogonalRoutingResult {
  points: Point[];
  status: 'clear' | 'routed' | 'blocked';
}

const directions: GeometrySide[] = ['right', 'bottom', 'left', 'top'];
const epsilon = 1e-8;
const inside = (point: Point, box: RectangleClient) =>
  point[0] > box.x + epsilon &&
  point[0] < box.x + box.width - epsilon &&
  point[1] > box.y + epsilon &&
  point[1] < box.y + box.height - epsilon;

/** Touching a clearance boundary is allowed; crossing its interior is not. */
const crosses = (a: Point, b: Point, box: RectangleClient) => {
  if (a[1] === b[1])
    return (
      a[1] > box.y + epsilon &&
      a[1] < box.y + box.height - epsilon &&
      Math.max(a[0], b[0]) > box.x + epsilon &&
      Math.min(a[0], b[0]) < box.x + box.width - epsilon
    );
  return (
    a[0] > box.x + epsilon &&
    a[0] < box.x + box.width - epsilon &&
    Math.max(a[1], b[1]) > box.y + epsilon &&
    Math.min(a[1], b[1]) < box.y + box.height - epsilon
  );
};

const outwardSegment = (a: Point, b: Point, side: GeometrySide) => {
  switch (side) {
    case 'right':
      return a[1] === b[1] && b[0] > a[0];
    case 'left':
      return a[1] === b[1] && b[0] < a[0];
    case 'bottom':
      return a[0] === b[0] && b[1] > a[1];
    case 'top':
      return a[0] === b[0] && b[1] < a[1];
  }
};

const clearRoute = (
  points: readonly Point[],
  boxes: readonly RoutingObstacle[],
  sourceSide: GeometrySide,
  targetSide: GeometrySide,
  options: OrthogonalRoutingOptions,
) =>
  points.slice(1).every((b, index) => {
    const a = points[index];
    return boxes.every(
      (box) =>
        !crosses(a, b, box) ||
        (box.id === options.sourceId &&
          index === 0 &&
          outwardSegment(a, b, sourceSide)) ||
        (box.id === options.targetId &&
          index === points.length - 2 &&
          outwardSegment(b, a, targetSide)),
    );
  });

const escape = (
  point: Point,
  side: GeometrySide,
  boxes: readonly RoutingObstacle[],
  ownId?: string,
): Point | undefined => {
  const axis = side === 'left' || side === 'right' ? 0 : 1;
  const sign = side === 'right' || side === 'bottom' ? 1 : -1;
  const own = boxes.find((box) => box.id === ownId);
  const bounds = (box: RectangleClient, at: number) =>
    at === 0 ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
  const boundary = own ? bounds(own, axis)[sign === 1 ? 1 : 0] : point[axis];
  const minimum = Math.max(0, (boundary - point[axis]) * sign);
  let distance = Math.max(24, minimum);
  for (const box of boxes) {
    if (box.id === ownId) continue;
    if (inside(point, box)) return undefined;
    const across = bounds(box, 1 - axis);
    if (point[1 - axis] <= across[0] || point[1 - axis] >= across[1]) continue;
    const ahead = bounds(box, axis)[sign === 1 ? 0 : 1];
    const gap = (ahead - point[axis]) * sign;
    if (gap < 0) continue;
    if (gap < minimum) return undefined;
    // A fixed 24px jetty can seal an otherwise routable narrow exit.
    distance = Math.min(distance, Math.max(minimum, gap / 2));
  }
  const escaped: Point = [...point];
  escaped[axis] =
    own && distance === minimum ? boundary : point[axis] + distance * sign;
  return escaped;
};

interface QueueEntry {
  state: number;
  cost: number;
  estimate: number;
}
const less = (a: QueueEntry, b: QueueEntry) =>
  a.estimate < b.estimate ||
  (a.estimate === b.estimate &&
    (a.cost < b.cost || (a.cost === b.cost && a.state < b.state)));
class Queue {
  private items: QueueEntry[] = [];
  push(value: QueueEntry) {
    let at = this.items.length;
    this.items.push(value);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!less(value, this.items[parent])) break;
      this.items[at] = this.items[parent];
      at = parent;
    }
    this.items[at] = value;
  }
  pop(): QueueEntry | undefined {
    const first = this.items[0],
      last = this.items.pop();
    if (!this.items.length || !last) return first;
    let at = 0;
    while (at * 2 + 1 < this.items.length) {
      let child = at * 2 + 1;
      if (
        child + 1 < this.items.length &&
        less(this.items[child + 1], this.items[child])
      )
        child++;
      if (!less(this.items[child], last)) break;
      this.items[at] = this.items[child];
      at = child;
    }
    this.items[at] = last;
    return first;
  }
}

/** Compressed rectilinear visibility grid. Rectangle range updates avoid
 * testing every candidate segment against every obstacle (O(n²) setup). */
const visibility = (
  xs: number[],
  ys: number[],
  boxes: readonly RoutingObstacle[],
) => {
  const width = xs.length,
    height = ys.length,
    stride = width + 1;
  const horizontal = new Int32Array(stride * (height + 1));
  const vertical = new Int32Array(horizontal.length);
  const xi = new Map(xs.map((value, index) => [value, index]));
  const yi = new Map(ys.map((value, index) => [value, index]));
  const mark = (
    grid: Int32Array,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => {
    if (left > right || top > bottom) return;
    grid[top * stride + left]++;
    grid[top * stride + right + 1]--;
    grid[(bottom + 1) * stride + left]--;
    grid[(bottom + 1) * stride + right + 1]++;
  };
  for (const box of boxes) {
    const left = xi.get(box.x)!,
      right = xi.get(box.x + box.width)!;
    const top = yi.get(box.y)!,
      bottom = yi.get(box.y + box.height)!;
    mark(horizontal, left, top + 1, right - 1, bottom - 1);
    mark(vertical, left + 1, top, right - 1, bottom - 1);
  }
  for (const grid of [horizontal, vertical]) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * stride + x;
        grid[at] +=
          (x ? grid[at - 1] : 0) +
          (y ? grid[at - stride] : 0) -
          (x && y ? grid[at - stride - 1] : 0);
      }
    }
  }
  return { horizontal, vertical, stride, xi, yi };
};

const findRoute = (
  source: Point,
  sourceSide: GeometrySide,
  target: Point,
  targetSide: GeometrySide,
  boxes: readonly RoutingObstacle[],
  options: OrthogonalRoutingOptions,
): Point[] | undefined => {
  const start = escape(source, sourceSide, boxes, options.sourceId);
  const end = escape(target, targetSide, boxes, options.targetId);
  if (!start || !end) return undefined;
  if (boxes.some((box) => inside(start, box) || inside(end, box))) return;
  if (
    !clearRoute([source, start], boxes, sourceSide, targetSide, {
      sourceId: options.sourceId,
    }) ||
    !clearRoute([end, target], boxes, sourceSide, targetSide, {
      targetId: options.targetId,
    })
  )
    return;
  const coordinates = (axis: 0 | 1) => {
    const values = [start[axis], end[axis]];
    for (const box of boxes)
      values.push(
        axis === 0 ? box.x : box.y,
        axis === 0 ? box.x + box.width : box.y + box.height,
      );
    values.push(Math.min(...values) - 24, Math.max(...values) + 24);
    // A bounded set of extra channels lets parallel edges separate without
    // growing a dense diagram's visibility grid for every previously routed edge.
    const channels = [
      ...new Set(
        (options.occupied ?? []).flatMap((segment) =>
          segment.start[axis] === segment.end[axis]
            ? [segment.start[axis] - laneGap, segment.start[axis] + laneGap]
            : [],
        ),
      ),
    ]
      .sort(
        (a, b) =>
          Math.min(Math.abs(a - start[axis]), Math.abs(a - end[axis])) -
            Math.min(Math.abs(b - start[axis]), Math.abs(b - end[axis])) ||
          a - b,
      )
      .slice(0, 24);
    values.push(...channels);
    return [...new Set(values)].sort((a, b) => a - b);
  };
  const xs = coordinates(0),
    ys = coordinates(1),
    width = xs.length,
    height = ys.length;
  const grid = visibility(xs, ys, boxes);
  const congestion = {
    horizontal: new Float64Array(width * height),
    vertical: new Float64Array(width * height),
  };
  for (const segment of options.occupied ?? []) {
    const horizontal = segment.start[1] === segment.end[1];
    const along = horizontal ? xs : ys,
      across = horizontal ? ys : xs;
    const axis = horizontal ? 0 : 1,
      other = 1 - axis;
    const parallel = horizontal ? congestion.horizontal : congestion.vertical;
    const crossing = horizontal ? congestion.vertical : congestion.horizontal;
    const at = (a: number, b: number) =>
      horizontal ? b * width + a : a * width + b;
    const coordinate = segment.start[other];
    for (let b = 0; b < across.length; b++) {
      const gap = Math.abs(across[b] - coordinate);
      if (gap < laneGap)
        for (let a = 0; a + 1 < along.length; a++)
          parallel[at(a, b)] +=
            overlapLength(
              along[a],
              along[a + 1],
              segment.start[axis],
              segment.end[axis],
            ) * (gap < epsilon ? 8 : 2 * (1 - gap / laneGap));
      if (
        b + 1 < across.length &&
        coordinate > across[b] &&
        coordinate <= across[b + 1]
      )
        for (let a = 0; a < along.length; a++)
          if (
            along[a] > Math.min(segment.start[axis], segment.end[axis]) &&
            along[a] < Math.max(segment.start[axis], segment.end[axis])
          )
            crossing[at(a, b)] += 160;
    }
  }
  const firstNode = grid.yi.get(start[1])! * width + grid.xi.get(start[0])!;
  const lastNode = grid.yi.get(end[1])! * width + grid.xi.get(end[0])!;
  const first = firstNode * 4 + directions.indexOf(sourceSide);
  const finalDirection = (directions.indexOf(targetSide) + 2) % 4;
  const distances = new Float64Array(width * height * 4).fill(Infinity);
  const previous = new Int32Array(distances.length).fill(-1);
  const queue = new Queue(),
    bendPenalty = options.bendPenalty ?? 24;
  distances[first] = 0;
  queue.push({
    state: first,
    cost: 0,
    estimate: Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1]),
  });
  let entry: QueueEntry | undefined;
  while ((entry = queue.pop())) {
    const { state, cost } = entry;
    if (cost !== distances[state]) continue;
    const node = Math.floor(state / 4),
      direction = state % 4;
    if (node === lastNode) {
      const points: Point[] = [target];
      for (let at = state; at >= 0; at = previous[at]) {
        const id = Math.floor(at / 4);
        points.push([xs[id % width], ys[Math.floor(id / width)]]);
      }
      points.push(source);
      return simplifyOrthogonal(points.reverse());
    }
    const x = node % width,
      y = Math.floor(node / width),
      at = y * grid.stride + x;
    const neighbors = [
      x + 1 < width && !grid.horizontal[at] ? node + 1 : -1,
      y + 1 < height && !grid.vertical[at] ? node + width : -1,
      x > 0 && !grid.horizontal[at - 1] ? node - 1 : -1,
      y > 0 && !grid.vertical[at - grid.stride] ? node - width : -1,
    ];
    for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
      const next = neighbors[nextDirection];
      if (next < 0) continue;
      const nx = next % width,
        ny = Math.floor(next / width),
        nextState = next * 4 + nextDirection;
      const nextCost =
        cost +
        Math.abs(xs[nx] - xs[x]) +
        Math.abs(ys[ny] - ys[y]) +
        (nextDirection % 2 === 0
          ? congestion.horizontal[y * width + Math.min(x, nx)]
          : congestion.vertical[Math.min(y, ny) * width + x]) +
        (direction === nextDirection ? 0 : bendPenalty) +
        (next === lastNode && nextDirection !== finalDirection
          ? bendPenalty
          : 0);
      if (nextCost >= distances[nextState]) continue;
      distances[nextState] = nextCost;
      previous[nextState] = state;
      queue.push({
        state: nextState,
        cost: nextCost,
        estimate:
          nextCost + Math.abs(xs[nx] - end[0]) + Math.abs(ys[ny] - end[1]),
      });
    }
  }
  return undefined;
};

export const routeOrthogonalAvoiding = (
  source: Point,
  sourceSide: GeometrySide,
  target: Point,
  targetSide: GeometrySide,
  obstacles: readonly RoutingObstacle[],
  options: OrthogonalRoutingOptions = {},
): OrthogonalRoutingResult => {
  const original = routeOrthogonal(source, sourceSide, target, targetSide);
  const minimum = Math.max(0, options.strokeWidth ?? 2) / 2 + 1;
  for (const clearance of new Set([
    Math.max(minimum, options.clearance ?? 12),
    minimum,
  ])) {
    const boxes = obstacles.map((box) => ({
      ...box,
      x: box.x - clearance,
      y: box.y - clearance,
      width: box.width + clearance * 2,
      height: box.height + clearance * 2,
    }));
    if (
      clearRoute(original, boxes, sourceSide, targetSide, options) &&
      !original
        .slice(1)
        .some(
          (point, at) =>
            routingSegmentPenalty(original[at], point, options.occupied ?? []) >
            0,
        )
    )
      return { points: original, status: 'clear' };
    const points = findRoute(
      source,
      sourceSide,
      target,
      targetSide,
      boxes,
      options,
    );
    if (points) return { points, status: 'routed' };
  }
  return { points: original, status: 'blocked' };
};

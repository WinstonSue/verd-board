import type { Point } from '../interfaces/point';

export const shortenPolyline = (
  points: readonly Point[],
  amount: number,
  whenShorter: 'clamp' | 'keep' = 'clamp',
): Point[] => {
  const copy = points.map((point) => [point[0], point[1]] as Point);
  if (copy.length < 2 || amount <= 0) {
    return copy;
  }
  const end = copy[copy.length - 1];
  const previous = copy[copy.length - 2];
  const dx = end[0] - previous[0];
  const dy = end[1] - previous[1];
  const length = Math.hypot(dx, dy);
  if (length <= amount) {
    if (whenShorter === 'keep' || length === 0) {
      return copy;
    }
  }
  const safe = length || 1;
  copy[copy.length - 1] = [
    end[0] - (dx / safe) * Math.min(amount, safe),
    end[1] - (dy / safe) * Math.min(amount, safe),
  ];
  return copy;
};

export const polylinePath = (
  points: readonly Point[],
  options: { commandGap?: boolean } = {},
): string => {
  const gap = options.commandGap ? ' ' : '';
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${gap}${point[0]} ${point[1]}`,
    )
    .join(' ');
};

export const arrowHeadPoints = (
  points: readonly Point[],
  options: { size?: number; wing?: number } = {},
): string => {
  if (points.length < 2) {
    return '';
  }
  const size = options.size ?? 8;
  const wing = options.wing ?? size * 0.45;
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  const dx = end[0] - previous[0];
  const dy = end[1] - previous[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const baseX = end[0] - ux * size;
  const baseY = end[1] - uy * size;
  return [
    `${end[0]},${end[1]}`,
    `${baseX + px * wing},${baseY + py * wing}`,
    `${baseX - px * wing},${baseY - py * wing}`,
  ].join(' ');
};

const distanceToSegment = (point: Point, start: Point, end: Point) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy),
  );
};

export const distanceToPolyline = (point: Point, points: readonly Point[]) => {
  if (points.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(
      best,
      distanceToSegment(point, points[index - 1], points[index]),
    );
  }
  return best;
};

export const polylinePointAt = (
  points: readonly Point[],
  position = 0.5,
): Point => {
  if (!points.length) {
    return [0, 0];
  }
  if (points.length === 1) {
    return points[0];
  }
  let length = 0;
  const segments: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
    segments.push(segment);
    length += segment;
  }
  let remaining = length * Math.max(0, Math.min(1, position));
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (remaining <= segment) {
      const start = points[index];
      const end = points[index + 1];
      const ratio = segment === 0 ? 0 : remaining / segment;
      return [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ];
    }
    remaining -= segment;
  }
  return points[points.length - 1];
};

/** 最长一段的中点。架构边标签用这个，避免落在很短的拐角上。 */
export const longestSegmentMidpoint = (points: readonly Point[]): Point => {
  let best = points[0] ?? [0, 0];
  let bestLength = -1;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length > bestLength) {
      bestLength = length;
      best = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    }
  }
  return best;
};

export const polylineMidpoint = (points: readonly Point[]): Point =>
  polylinePointAt(points);

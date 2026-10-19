import type { EdgeCell } from '../cell/types';
import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { EdgeRoutingContext } from './edge';
import { polylinePointAt } from './polyline';
import { routingBatches, copyLabelLayouts } from './routing-cache';

export interface EdgeLabelLayout {
  /** Point on the route, also used as the label drag origin. */
  point: Point;
  bounds: RectangleClient;
}

const overlap = (a: RectangleClient, b: RectangleClient) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
const crosses = (a: Point, b: Point, box: RectangleClient) => {
  if (a[1] === b[1])
    return (
      a[1] > box.y &&
      a[1] < box.y + box.height &&
      Math.max(a[0], b[0]) > box.x &&
      Math.min(a[0], b[0]) < box.x + box.width
    );
  if (a[0] === b[0])
    return (
      a[0] > box.x &&
      a[0] < box.x + box.width &&
      Math.max(a[1], b[1]) > box.y &&
      Math.min(a[1], b[1]) < box.y + box.height
    );
  return false;
};

const place = (
  edge: EdgeCell,
  index: number,
  points: readonly Point[],
  obstacles: readonly RectangleClient[],
  routes: readonly (readonly Point[])[],
): EdgeLabelLayout => {
  const label = edge.labels?.[index];
  if (edge.kind === 'uml-message' && points.length >= 2) {
    const width = Math.max(
      140,
      Math.min(
        400,
        points[0][0] === points.at(-1)![0]
          ? 200
          : Math.abs(points.at(-1)![0] - points[0][0]) - 32,
      ),
    );
    const lines = (label?.text ?? '')
      .split('\n')
      .reduce(
        (sum, line) =>
          sum +
          Math.max(
            1,
            Math.ceil(
              [...line].reduce(
                (n, c) => n + (c.charCodeAt(0) > 255 ? 16 : 8),
                0,
              ) / width,
            ),
          ),
        0,
      );
    const height = lines * 20 + 12;
    const point: Point = [(points[0][0] + points[1][0]) / 2, points[0][1]];
    return {
      point,
      bounds: {
        x: point[0] - width / 2,
        y: point[1] - height - 8,
        width,
        height,
      },
    };
  }
  const midpoint = polylinePointAt(points, label?.position ?? 0.5);
  if (
    label?.position !== undefined ||
    points.length < 2 ||
    !['auto', 'orthogonal'].includes(edge.route.mode) ||
    ('points' in edge.route && edge.route.points?.length)
  )
    return {
      point: midpoint,
      bounds: {
        x: midpoint[0] - 100,
        y: midpoint[1] - 26,
        width: 200,
        height: 36,
      },
    };
  const width = Math.max(
    48,
    Math.min(
      200,
      16 +
        [...(label?.text ?? '')].reduce(
          (sum, char) => sum + (char.charCodeAt(0) > 255 ? 16 : 8),
          0,
        ),
    ),
  );
  const height = 36;
  let best: { layout: EdgeLabelLayout; score: number } | undefined;
  for (let at = 1; at < points.length; at++) {
    const start = points[at - 1],
      end = points[at];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (!length) continue;
    const horizontal =
      Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]);
    for (const fraction of [0.5, 0.3, 0.7]) {
      const point: Point = [
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ];
      for (const side of [-1, 1]) {
        const bounds = horizontal
          ? {
              x: point[0] - width / 2,
              y: point[1] + (side === -1 ? -height - 6 : 6),
              width,
              height,
            }
          : {
              x: point[0] + (side === -1 ? 8 : -width - 8),
              y: point[1] - height / 2,
              width,
              height,
            };
        const score =
          obstacles.filter((box) => overlap(bounds, box)).length * 1e6 +
          routes.reduce(
            (sum, route) =>
              sum +
              route.slice(1).filter((p, i) => crosses(route[i], p, bounds))
                .length,
            0,
          ) *
            1000 +
          Math.max(0, (horizontal ? width : height) + 16 - length) * 10 +
          100 / length +
          Math.hypot(point[0] - midpoint[0], point[1] - midpoint[1]) / 1000;
        if (!best || score < best.score)
          best = { layout: { point, bounds }, score };
      }
    }
  }
  return (
    best?.layout ?? {
      point: midpoint,
      bounds: {
        x: midpoint[0] - width / 2,
        y: midpoint[1] - height - 6,
        width,
        height,
      },
    }
  );
};

/** Automatic labels share deterministic, collision-aware placement across a Frame.
 * Explicit positions retain their authored distance along the path. */
export function edgeLabelLayout(
  edge: EdgeCell,
  index: number,
  points: readonly Point[],
  routing?: EdgeRoutingContext,
): EdgeLabelLayout {
  routing?.prepare?.();
  if (!routing || edge.labels?.[index]?.position !== undefined)
    return place(edge, index, points, routing?.obstacles ?? [], []);
  if (!routing.labelLayouts) {
    const obstacles: RectangleClient[] = [...routing.obstacles];
    const routes = [...routing.routes.values()];
    routes.sort((a, b) => a.edge.id.localeCompare(b.edge.id));
    const signature = JSON.stringify([
      routing.obstacles,
      routes.map(({ edge, result }) => [
        edge.id,
        result.points,
        edge.route.mode,
        'points' in edge.route && !!edge.route.points?.length,
        edge.labels?.map((label) => [label.text, label.position]),
      ]),
    ]);
    const batch = routingBatches.get(routing);
    const previous = batch?.labels ?? batch?.previousLabels;
    if (previous?.signature === signature) {
      routing.labelLayouts = copyLabelLayouts(previous.layouts);
      if (batch) batch.labels = previous;
    } else {
      routing.labelLayouts = new Map();
      for (const route of routes.sort((a, b) =>
        a.edge.id.localeCompare(b.edge.id),
      ))
        route.edge.labels?.forEach((_, at) => {
          const layout = place(
            route.edge,
            at,
            route.result.points,
            obstacles,
            routes.map((value) => value.result.points),
          );
          routing.labelLayouts!.set(`${route.edge.id}:${at}`, layout);
          obstacles.push(layout.bounds);
        });
      if (batch)
        batch.labels = {
          signature,
          layouts: copyLabelLayouts(routing.labelLayouts),
        };
    }
  }
  const cached = routing.routes.get(edge.id);
  return (
    (cached?.edge === edge &&
      routing.labelLayouts.get(`${edge.id}:${index}`)) ||
    place(
      edge,
      index,
      points,
      routing.obstacles,
      [...routing.routes.values()].map((route) => route.result.points),
    )
  );
}

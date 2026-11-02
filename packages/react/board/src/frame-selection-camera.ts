import {
  fitFrameContent,
  frameContentBounds,
  frameToParentPoint,
  frameVisualBounds,
  isFrameCell,
  isEdgeCell,
  edgePolyline,
  flattenCurve,
  edgeLabelLayout,
  isGroupCell,
  isNodeCell,
  type CellStore,
  type EdgeRoutingContext,
  type NodeGeometry,
  type Point,
  type RectangleClient,
} from '@sue/board-core';

interface CameraLayout {
  store: CellStore;
  routing: EdgeRoutingContext;
  fitBounds?: RectangleClient;
  getGeometry(id: string): NodeGeometry | undefined;
}

/** Resolve selection targets from scene geometry, including unmounted cells. */
export function frameSelectionWorldBounds({
  svg,
  world,
  store,
  frameId,
  ids,
  parentOf,
  layouts,
  includeEdges = false,
  allowUnmounted = false,
}: {
  svg: SVGSVGElement;
  world: SVGGElement | null;
  store: CellStore;
  frameId: string;
  ids: readonly string[];
  parentOf: ReadonlyMap<string, string>;
  layouts(id: string): CameraLayout;
  includeEdges?: boolean;
  allowUnmounted?: boolean;
}): RectangleClient | null {
  if (!ids.length) return null;
  const elements = new Map(
    Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-cell-id]'))
      .filter((element) => element.closest('svg') === svg)
      .map((element) => [element.getAttribute('data-cell-id')!, element]),
  );
  const visited = new Set<string>();
  const points: Point[] = [];
  const collect = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const cell = store.cells[id];
    if (!cell || cell.hidden) return;
    if (isGroupCell(cell)) {
      cell.members.forEach(collect);
      return;
    }
    const element = elements.get(id);
    if (
      (!isNodeCell(cell) && !isEdgeCell(cell)) ||
      (!element && !allowUnmounted)
    )
      return;
    const owner = parentOf.get(id);
    if (!owner) return;
    const layout = layouts(owner);
    let geometry: NodeGeometry;
    if (isEdgeCell(cell)) {
      if (!includeEdges) return;
      const displayed = layout.store.cells[id];
      if (!isEdgeCell(displayed)) return;
      const path = edgePolyline(
        layout.store,
        displayed,
        undefined,
        layout.routing,
      );
      const route =
        displayed.route.mode === 'curve' ? flattenCurve(path) : path;
      if (!route.length) return;
      const padding = Math.max(
        12,
        (displayed.appearance?.strokeWidth ?? 2) * 2,
      );
      const boxes = [
        ...route.map(([x, y]) => ({
          x: x - padding,
          y: y - padding,
          width: padding * 2,
          height: padding * 2,
        })),
        ...(displayed.labels ?? []).map(
          (_, i) => edgeLabelLayout(displayed, i, path, layout.routing).bounds,
        ),
      ];
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      geometry = {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    } else geometry = layout.getGeometry(id) ?? cell.geometry;
    if (
      ![
        geometry.x,
        geometry.y,
        geometry.width,
        geometry.height,
        geometry.rotation ?? 0,
      ].every(Number.isFinite)
    )
      return;
    const bounds = isFrameCell(cell) ? frameVisualBounds(geometry) : geometry;
    let corners: Point[] = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height],
    ];
    try {
      const matrix = element?.getScreenCTM?.();
      const inverse = world?.getScreenCTM?.()?.inverse();
      if (matrix && inverse) {
        const transform = (point: Point, value: DOMMatrix): Point => [
          point[0] * value.a + point[1] * value.c + value.e,
          point[0] * value.b + point[1] * value.d + value.f,
        ];
        const transformed = corners.map((point) =>
          transform(transform(point, matrix), inverse),
        );
        if (transformed.every((point) => point.every(Number.isFinite))) {
          points.push(...transformed);
          return;
        }
      }
    } catch {
      // A temporarily unavailable/non-invertible SVG matrix uses scene geometry.
    }
    if (!isFrameCell(cell) && geometry.rotation) {
      const cx = geometry.x + geometry.width / 2,
        cy = geometry.y + geometry.height / 2,
        cosine = Math.cos(geometry.rotation),
        sine = Math.sin(geometry.rotation);
      corners = corners.map(([x, y]) => [
        cx + (x - cx) * cosine - (y - cy) * sine,
        cy + (x - cx) * sine + (y - cy) * cosine,
      ]);
    }
    let current = owner;
    const ancestors = new Set<string>();
    while (current !== frameId) {
      if (ancestors.has(current)) return;
      ancestors.add(current);
      const frame = store.cells[current],
        parent = parentOf.get(current);
      if (!isFrameCell(frame) || !parent) return;
      const layout = layouts(current);
      const placement = fitFrameContent(
        {
          ...frame,
          geometry: layouts(parent).getGeometry(current) ?? frame.geometry,
        },
        layout.fitBounds ??
          frameContentBounds(layout.store, current, layout.routing),
      );
      corners = corners.map((point) => frameToParentPoint(point, placement));
      current = parent;
    }
    if (corners.every((point) => point.every(Number.isFinite)))
      points.push(...corners);
  };
  ids.forEach(collect);
  if (!points.length) return null;
  const x = Math.min(...points.map((point) => point[0])),
    y = Math.min(...points.map((point) => point[1]));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point[0])) - x,
    height: Math.max(...points.map((point) => point[1])) - y,
  };
}

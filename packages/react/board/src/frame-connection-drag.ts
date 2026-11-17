import {
  anchorFromPoint,
  availablePorts,
  hitNodeShape,
  isFrameCell,
  isNodeCell,
  nodeShapeGeometry,
  resolvePort,
  unrotateNodePoint,
  type Anchor,
  type CellRegistry,
  type CellStore,
  type EdgeCell,
  type NodeCell,
  type NodeGeometry,
  type Point,
  type RectangleClient,
  type Terminal,
  type TerminalEnd,
} from '@sue/board-core';

export const CONNECTION_SNAP_RADIUS = 10;
export const CONNECTION_RELEASE_RADIUS = 14;
export const CONNECTION_TARGET_RADIUS = 18;

/** Gesture-local state; preview anchors never become authored terminals. */
export interface ConnectionDragState {
  nodeId?: string;
  snappedPortId?: string;
  lastSnappedPortId?: string;
  anchor?: Anchor;
}

export function connectionDragState(terminal: Terminal): ConnectionDragState {
  return 'cellId' in terminal
    ? {
        nodeId: terminal.cellId,
        snappedPortId: terminal.portId,
        lastSnappedPortId: terminal.portId,
        anchor: terminal.anchor,
      }
    : {};
}

/** Radial projection stays continuous across corners, unlike nearest-edge projection. */
export function projectConnectionOutline(
  geometry: NodeGeometry,
  pointer: Point,
  previous?: Anchor,
): Anchor {
  const shape =
    nodeShapeGeometry(geometry.outline) ?? nodeShapeGeometry('rectangle')!;
  const center: Point = [
    geometry.x + geometry.width / 2,
    geometry.y + geometry.height / 2,
  ];
  if (
    geometry.width <= 0 ||
    geometry.height <= 0 ||
    !shape.hit(geometry, center, true, 0)
  )
    return anchorFromPoint(geometry, pointer, { snapToOutline: true });
  const local = unrotateNodePoint(geometry, pointer);
  let dx = local[0] - center[0],
    dy = local[1] - center[1];
  if (Math.hypot(dx, dy) < 1e-8) {
    if (previous) return previous;
    dx = 0;
    dy = -1;
  }
  const length = Math.hypot(dx, dy);
  const extent = Math.hypot(geometry.width, geometry.height) + 1;
  dx = (dx / length) * extent;
  dy = (dy / length) * extent;
  let inside = 0,
    outside = 1;
  for (let index = 0; index < 24; index++) {
    const middle = (inside + outside) / 2;
    if (
      shape.hit(
        geometry,
        [center[0] + dx * middle, center[1] + dy * middle],
        true,
        0,
      )
    )
      inside = middle;
    else outside = middle;
  }
  return [
    (center[0] + dx * inside - geometry.x) / geometry.width,
    (center[1] + dy * inside - geometry.y) / geometry.height,
  ];
}

/** Follow the pointer in the interior, blending into the contour near its edge. */
export function connectionPreviewAnchor(
  geometry: NodeGeometry,
  pointer: Point,
  scale: number,
  previous?: Anchor,
): Anchor {
  const shape =
    nodeShapeGeometry(geometry.outline) ?? nodeShapeGeometry('rectangle')!;
  const local = unrotateNodePoint(geometry, pointer);
  if (shape.nearest && shape.hit(geometry, local, true, 0)) {
    const nearest = shape.nearest(geometry, local);
    const distance =
      Math.hypot(local[0] - nearest[0], local[1] - nearest[1]) * scale;
    const inner = Math.min(
      18,
      Math.min(geometry.width, geometry.height) * scale * 0.2,
    );
    const outer = Math.min(6, inner / 3);
    const pointerAnchor = anchorFromPoint(geometry, pointer);
    if (inner <= 1e-8 || distance >= inner) return pointerAnchor;
    if (distance > outer) {
      const contour = projectConnectionOutline(geometry, pointer, previous);
      const progress = (distance - outer) / (inner - outer);
      const weight = progress * progress * (3 - 2 * progress);
      return [
        contour[0] + (pointerAnchor[0] - contour[0]) * weight,
        contour[1] + (pointerAnchor[1] - contour[1]) * weight,
      ];
    }
  }
  return projectConnectionOutline(geometry, pointer, previous);
}

export function resolveConnectionDrag(options: {
  store: CellStore;
  frameId: string;
  edge: EdgeCell;
  end: TerminalEnd;
  point: Point;
  scale: number;
  registry: CellRegistry;
  state: ConnectionDragState;
  commit?: boolean;
  query(bounds: RectangleClient): readonly string[];
  getGeometry(id: string): NodeGeometry | undefined;
  locked(id: string): boolean;
}): { terminal: Terminal | null; nodeId: string | null } {
  const { store, frameId, edge, end, point, registry, state, commit } = options;
  const scale = Math.max(1e-8, options.scale);
  const radius = CONNECTION_TARGET_RADIUS / scale;
  const candidates = options.query({
    x: point[0] - radius,
    y: point[1] - radius,
    width: 2 * radius,
    height: 2 * radius,
  });
  const frame = store.cells[frameId];
  const valid = (terminal: Terminal) => {
    if (!isFrameCell(frame)) return false;
    const next = { ...edge, [end]: terminal };
    const candidate = {
      ...store,
      cells: {
        ...store.cells,
        [edge.id]: next,
        [frameId]: frame.children.includes(edge.id)
          ? frame
          : { ...frame, children: [...frame.children, edge.id] },
      },
    };
    return !registry.validateEdge(candidate, next);
  };
  let blocked: NodeCell | undefined;
  let node = [...candidates]
    .reverse()
    .map((id) => store.cells[id])
    .find((cell) => {
      if (
        !isNodeCell(cell) ||
        isFrameCell(cell) ||
        !cell.ports?.length ||
        cell.hidden ||
        cell.locked ||
        options.locked(cell.id) ||
        !isFrameCell(frame) ||
        !frame.children.includes(cell.id) ||
        registry.get(edge.kind)?.canConnect?.(cell) === false
      )
        return false;
      const geometry = options.getGeometry(cell.id) ?? cell.geometry;
      const hit =
        hitNodeShape(cell, point, radius, geometry) ||
        cell.ports.some((port) => {
          const position = resolvePort(geometry, port).point;
          return (
            Math.hypot(position[0] - point[0], position[1] - point[1]) <= radius
          );
        });
      if (!hit) return false;
      if (
        !availablePorts(store, cell, end, edge.id).some((port) =>
          valid({ cellId: cell.id, portId: port.id }),
        )
      ) {
        blocked ??= cell;
        return false;
      }
      return true;
    });
  node ??= blocked;
  if (!isNodeCell(node)) {
    state.nodeId = state.snappedPortId = state.lastSnappedPortId = undefined;
    state.anchor = undefined;
    const terminal: Terminal = { point: [...point] };
    return {
      terminal: commit && !valid(terminal) ? null : terminal,
      nodeId: null,
    };
  }
  if (state.nodeId !== node.id) {
    state.nodeId = node.id;
    state.snappedPortId = state.lastSnappedPortId = undefined;
    state.anchor = undefined;
  }
  const geometry = options.getGeometry(node.id) ?? node.geometry;
  const ports = availablePorts(store, node, end, edge.id)
    .filter((port) => valid({ cellId: node.id, portId: port.id }))
    .map((port) => {
      const position = resolvePort(geometry, port).point;
      return {
        port,
        distance:
          Math.hypot(position[0] - point[0], position[1] - point[1]) * scale,
      };
    })
    .sort((a, b) =>
      Math.abs(a.distance - b.distance) > 1e-6
        ? a.distance - b.distance
        : Number(b.port.id === state.lastSnappedPortId) -
            Number(a.port.id === state.lastSnappedPortId) ||
          a.port.id.localeCompare(b.port.id),
    );
  if (commit)
    return {
      terminal: ports[0] ? { cellId: node.id, portId: ports[0].port.id } : null,
      nodeId: node.id,
    };
  const held = ports.find(
    ({ port, distance }) =>
      port.id === state.snappedPortId && distance <= CONNECTION_RELEASE_RADIUS,
  );
  const snapped =
    held ??
    (ports[0]?.distance <= CONNECTION_SNAP_RADIUS ? ports[0] : undefined);
  state.snappedPortId = snapped?.port.id;
  if (snapped) {
    state.lastSnappedPortId = snapped.port.id;
    state.anchor = anchorFromPoint(
      geometry,
      resolvePort(geometry, snapped.port).point,
    );
    return {
      terminal: { cellId: node.id, portId: snapped.port.id },
      nodeId: node.id,
    };
  }
  state.anchor = connectionPreviewAnchor(geometry, point, scale, state.anchor);
  return {
    terminal: { cellId: node.id, anchor: state.anchor },
    nodeId: node.id,
  };
}

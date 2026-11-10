import { anchorFromPoint } from '../anchor';
import {
  isFrameCell,
  isNodeCell,
  type CellStore,
  type EdgeCell,
} from '../cell/types';
import { createCellRegistry, type CellRegistry } from '../cell/registry';
import { hitNodeShape } from '../geometry/node';
import type { Point } from '../interfaces/point';
import { availablePorts, resolvePort } from '../port';
import { resolveTerminal } from './resolve';
import type { Terminal, TerminalEnd } from './types';

/** Only direct siblings are eligible: snapping can never create a cross-Frame edge. */
export const snapTerminal = (
  store: CellStore,
  frameId: string,
  point: Point,
  end: TerminalEnd,
  kind: string,
  tolerance = 12,
  registry: CellRegistry = createCellRegistry(),
  candidates?: readonly string[],
  opposite?: { terminal: Terminal; edgeId?: string },
): Terminal => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing edge frame');
  for (const id of [...(candidates ?? frame.children)].reverse()) {
    const node = store.cells[id];
    if (!isNodeCell(node) || isFrameCell(node) || node.hidden || node.locked)
      continue;
    if (registry.get(kind)?.canConnect?.(node) === false) continue;
    const ports = availablePorts(store, node, end, opposite?.edgeId);
    const nearest = ports
      .map((port) => {
        const [x, y] = resolvePort(node.geometry, port).point;
        return { port, distance: Math.hypot(x - point[0], y - point[1]) };
      })
      .sort((a, b) => a.distance - b.distance);
    const inside = hitNodeShape(node, point, tolerance);
    if (nearest[0]?.distance <= tolerance)
      return { cellId: node.id, portId: nearest[0].port.id };
    if (
      nearest.length &&
      registry.get(kind)?.freeTerminals !== true &&
      inside
    ) {
      const other =
        opposite && 'cellId' in opposite.terminal
          ? store.cells[opposite.terminal.cellId]
          : undefined;
      const preferred = isNodeCell(other)
        ? registry
            .get(kind)
            ?.preferredPortSide?.(node.geometry, other.geometry, end)
        : undefined;
      const candidate =
        nearest.find(({ port }) => port.side === preferred) ?? nearest[0];
      return { cellId: node.id, portId: candidate.port.id };
    }
    if (registry.get(kind)?.freeTerminals !== true || !inside) continue;
    const g = node.geometry;
    return {
      cellId: node.id,
      anchor: anchorFromPoint(g, point, { snapToOutline: true }),
    };
  }
  return { point: [...point] };
};
export const replaceTerminal = (
  store: CellStore,
  edge: EdgeCell,
  end: TerminalEnd,
  terminal: Terminal,
): EdgeCell => {
  const next = { ...edge, [end]: terminal };
  if (
    next.route.mode !== 'orthogonal' &&
    'points' in next.route &&
    next.route.points
  ) {
    const points = next.route.points.map((p) => [...p] as Point);
    const position = resolveTerminal(
      store,
      terminal,
      end === 'source' ? next.target : next.source,
    );
    if (!position) throw new Error('Missing edge endpoint');
    points[end === 'source' ? 0 : points.length - 1] = position.point;
    next.route = { ...next.route, points };
  }
  return next;
};

/** Capture derived attachment points only when an automatic connector becomes
 * an authored path. Otherwise its endpoints would snap back to side midpoints. */
export const bindRouteTerminals = (
  store: CellStore,
  edge: EdgeCell,
  route: readonly Point[],
): EdgeCell => {
  if (
    !['auto', 'orthogonal'].includes(edge.route.mode) ||
    ('points' in edge.route && edge.route.points?.length) ||
    route.length < 2
  )
    return edge;
  let next = edge;
  for (const end of ['source', 'target'] as const) {
    const terminal = edge[end];
    if (!('cellId' in terminal) || terminal.portId || terminal.anchor) continue;
    const node = store.cells[terminal.cellId];
    if (
      !isNodeCell(node) ||
      node.geometry.width <= 0 ||
      node.geometry.height <= 0
    )
      continue;
    const position = end === 'source' ? route[0] : route.at(-1)!;
    next = {
      ...next,
      [end]: {
        ...terminal,
        anchor: anchorFromPoint(node.geometry, position),
      },
    };
  }
  return next;
};

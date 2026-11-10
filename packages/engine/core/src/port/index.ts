import type { ResolvedAnchor } from '../anchor';
import {
  isEdgeCell,
  type CellStore,
  type NodeCell,
  type NodeGeometry,
} from '../cell/types';
import { nodeShapeGeometry } from '../geometry/node';
import {
  rotateGeometrySide,
  sideAnchor,
  type GeometrySide,
} from '../geometry/side';
import type { TerminalEnd } from '../terminal/types';

export type PortDirection = 'input' | 'output' | 'both';
export type PortSide = GeometrySide;

export interface Port {
  id: string;
  direction: PortDirection;
  side: PortSide;
  offset?: number;
  maxConnections?: number;
}

export interface PortRef {
  kind: 'node';
  nodeId: string;
  portId: string;
}

export const portKey = (nodeId: string, portId: string) =>
  JSON.stringify(['node', nodeId, portId]);

export const findPort = (node: NodeCell, portId: string | undefined) =>
  node.ports?.find((port) => port.id === portId);

export const availablePorts = (
  store: CellStore,
  node: NodeCell,
  end: TerminalEnd,
  excludingEdgeId?: string,
): Port[] =>
  (node.ports ?? []).filter((port) => {
    if (port.direction === (end === 'source' ? 'input' : 'output'))
      return false;
    if (port.maxConnections === undefined) return true;
    const count = Object.values(store.cells).filter(
      (edge) =>
        isEdgeCell(edge) &&
        edge.id !== excludingEdgeId &&
        [edge.source, edge.target].some(
          (terminal) =>
            'cellId' in terminal &&
            terminal.cellId === node.id &&
            terminal.portId === port.id,
        ),
    ).length;
    return count < port.maxConnections;
  });

export const resolvePort = (
  geometry: NodeGeometry,
  port: Pick<Port, 'side' | 'offset'>,
): ResolvedAnchor => {
  const point =
    nodeShapeGeometry(geometry.outline)?.anchor?.(
      geometry,
      port.side,
      port.offset ?? 0.5,
    ) ?? sideAnchor(geometry, port.side, port.offset ?? 0.5);
  const rotation = geometry.rotation ?? 0;
  if (!rotation) return { point, side: port.side };
  const cx = geometry.x + geometry.width / 2,
    cy = geometry.y + geometry.height / 2;
  const cos = Math.cos(rotation),
    sin = Math.sin(rotation),
    dx = point[0] - cx,
    dy = point[1] - cy;
  return {
    point: [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos],
    side: rotateGeometrySide(port.side, rotation),
  };
};

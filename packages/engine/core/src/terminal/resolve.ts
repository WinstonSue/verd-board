import { resolveAnchor, type ResolvedAnchor } from '../anchor';
import { isNodeCell, type CellStore, type NodeGeometry } from '../cell/types';
import { facingSides, rectangleCenter } from '../geometry/side';
import { findPort, resolvePort } from '../port';
import type { Terminal } from './types';

export interface TerminalResolveOptions {
  geometry?: ReadonlyMap<string, NodeGeometry>;
  /** Detaching content historically uses its node center for automatic ends. */
  automatic?: 'facing' | 'center';
}

/** Resolve logical attachment only. Scene preferences and route fan-out follow. */
export const resolveTerminal = (
  store: CellStore,
  terminal: Terminal,
  other?: Terminal,
  options?: TerminalResolveOptions,
): ResolvedAnchor | undefined => {
  if ('point' in terminal) return { point: terminal.point, side: 'right' };
  const node = store.cells[terminal.cellId];
  if (!isNodeCell(node)) return undefined;
  const bounds = options?.geometry?.get(node.id) ?? node.geometry;
  const port = findPort(node, terminal.portId);
  if (port) {
    const position = resolvePort(bounds, port);
    return {
      point: terminal.anchor
        ? resolveAnchor(bounds, terminal.anchor).point
        : position.point,
      side: position.side,
    };
  }
  if (terminal.anchor) return resolveAnchor(bounds, terminal.anchor);
  if (options?.automatic === 'center')
    return { point: rectangleCenter(bounds), side: 'right' };
  if (!other) return undefined;
  const otherNode = 'cellId' in other ? store.cells[other.cellId] : undefined;
  const otherBounds = isNodeCell(otherNode)
    ? (options?.geometry?.get(otherNode.id) ?? otherNode.geometry)
    : {
        x: 'point' in other ? other.point[0] : 0,
        y: 'point' in other ? other.point[1] : 0,
        width: 0,
        height: 0,
      };
  return resolvePort(bounds, {
    side: facingSides(bounds, otherBounds).sourceSide,
  });
};

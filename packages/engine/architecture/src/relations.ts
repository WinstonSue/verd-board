import {
  isEdgeCell,
  isFrameCell,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import type { ArchitectureEdgeData } from './types';

/** Semantics determine notation; endpoint level only changes the default weight. */
export function layoutArchitectureEdges(
  store: CellStore,
  frameId: string,
): Map<string, EdgeCell> {
  const result = new Map<string, EdgeCell>();
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return result;
  for (const id of frame.children) {
    const edge = store.cells[id];
    if (!isEdgeCell(edge) || edge.kind !== 'architecture-edge') continue;
    const data = edge.data as ArchitectureEdgeData | undefined;
    if (!data?.relation) {
      result.set(id, edge);
      continue;
    }
    const layer =
      'cellId' in edge.source &&
      store.cells[edge.source.cellId]?.kind === 'architecture-layer';
    result.set(id, {
      ...edge,
      appearance: {
        ...edge.appearance,
        strokeWidth: edge.appearance?.strokeWidth ?? (layer ? 2.5 : 1.5),
        strokeStyle: data.relation === 'dependency' ? 'dashed' : 'solid',
      },
      data: {
        ...data,
        sourceMarker: 'none',
        targetMarker:
          data.relation === 'dependency' ? 'arrow' : 'solid-triangle',
      },
    });
  }
  return result;
}

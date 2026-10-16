import {
  CellKind,
  groupAncestors,
  groupLeafMembers,
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type ArchitectureLayerData,
  type CellStore,
  type MindChildData,
  type MindSummaryData,
  type NodeCell,
} from '@sue/board-core';
import { architectureLayerIds } from '@sue/board-architecture';
import { mindChildIds } from '@sue/board-mind';

export type PresentationScene =
  'whiteboard' | 'mind' | 'workflow' | 'architecture';

const isMind = (cell: CellStore['cells'][string] | undefined) =>
  cell?.kind === CellKind.mindRoot ||
  cell?.kind === CellKind.mindChild ||
  cell?.kind === CellKind.mindSummary;

const collapsed = (cell: CellStore['cells'][string] | undefined) =>
  isNodeCell(cell) && !!(cell.data as MindChildData | undefined)?.collapsed;

const isMindRelation = (cell: CellStore['cells'][string] | undefined) =>
  isEdgeCell(cell) &&
  (cell.kind === CellKind.mindBranch || cell.kind === CellKind.mindSummaryEdge);

const visible = (store: CellStore, id: string) =>
  !!store.cells[id] &&
  !store.cells[id].hidden &&
  !groupAncestors(store, id).some((owner) => store.cells[owner]?.hidden);

/** Visible topics and summaries in a subtree; never changes the snapshot. */
export function presentationMindIds(
  store: CellStore,
  rootId: string,
): string[] {
  const ids = new Set<string>();
  const visit = (id: string) => {
    const cell = store.cells[id];
    if (ids.has(id) || !isMind(cell) || !visible(store, id)) return;
    ids.add(id);
    if (!collapsed(cell)) mindChildIds(store, id).forEach(visit);
  };
  visit(rootId);
  // A summary belongs to the target only when its complete sibling range is
  // visible there. Repeat to include summaries whose own topics have summaries.
  let added = true;
  while (added) {
    added = false;
    for (const edge of Object.values(store.cells)) {
      if (
        !isEdgeCell(edge) ||
        edge.kind !== CellKind.mindSummaryEdge ||
        !('cellId' in edge.target) ||
        !visible(store, edge.id)
      )
        continue;
      const range = edge.data as MindSummaryData | undefined;
      const id = edge.target.cellId;
      if (
        !ids.has(id) &&
        range &&
        ids.has(range.startSiblingId) &&
        ids.has(range.endSiblingId) &&
        visible(store, id)
      ) {
        const before = ids.size;
        visit(id);
        added ||= ids.size > before;
      }
    }
  }
  return [...ids];
}

const frameVisibleIds = (store: CellStore, frameId: string): Set<string> => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame) || frame.hidden) return new Set();
  const ids = new Set(
    frame.children.filter(
      (id) =>
        visible(store, id) &&
        !isMind(store.cells[id]) &&
        !isMindRelation(store.cells[id]),
    ),
  );
  for (const id of frame.children) {
    if (store.cells[id]?.kind === CellKind.mindRoot)
      presentationMindIds(store, id).forEach((member) => ids.add(member));
  }
  // Relationship edges are drawable only while both topics are mounted. They
  // must not make an otherwise invisible/collapsed tree count as content.
  for (const id of frame.children) {
    const edge = store.cells[id];
    if (
      isEdgeCell(edge) &&
      isMindRelation(edge) &&
      visible(store, id) &&
      'cellId' in edge.source &&
      ids.has(edge.source.cellId) &&
      'cellId' in edge.target &&
      ids.has(edge.target.cellId)
    )
      ids.add(id);
  }
  return ids;
};

export const hasVisibleContent = (
  store: CellStore,
  frameId = store.rootId,
): boolean => frameVisibleIds(store, frameId).size > 0;

/** First-level branches of each visible root, preserving root and branch order. */
export function presentationSteps(
  store: CellStore,
  frameId: string,
  scene: PresentationScene,
): string[] {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame) || frame.hidden) return [];
  const shown = frameVisibleIds(store, frameId);
  if (scene === 'architecture')
    return architectureLayerIds(store, frameId).filter((id) => shown.has(id));
  if (scene !== 'mind') return [];
  const roots = frame.children.filter(
    (id) => store.cells[id]?.kind === CellKind.mindRoot && shown.has(id),
  );
  return roots.flatMap((id) =>
    collapsed(store.cells[id])
      ? []
      : mindChildIds(store, id).filter((child) => shown.has(child)),
  );
}

/** Resolve a tap/step again against live data so refits follow external edits. */
export function presentationTargetIds(
  store: CellStore,
  frameId: string,
  cellId: string,
): string[] {
  const shown = frameVisibleIds(store, frameId);
  const cell = store.cells[cellId];
  if (!cell || !visible(store, cellId)) return [];
  if (isMind(cell))
    return shown.has(cellId)
      ? presentationMindIds(store, cellId).filter((id) => shown.has(id))
      : [];
  // Group membership wins over an edge's terminals, so clicking any member
  // focuses the outermost group as a single unit.
  const owners = groupAncestors(store, cellId);
  const outerId = owners.at(-1) ?? cellId;
  if (isGroupCell(store.cells[outerId]))
    return groupLeafMembers(store, outerId).filter((id) => shown.has(id));
  if (!shown.has(cellId)) return [];
  if (isEdgeCell(cell)) {
    const endpoints = [cell.source, cell.target].flatMap((terminal) =>
      'cellId' in terminal && shown.has(terminal.cellId)
        ? [terminal.cellId]
        : [],
    );
    return [...new Set([cellId, ...endpoints])];
  }
  if (cell.kind === CellKind.architectureLayer) {
    const members =
      (cell as NodeCell<ArchitectureLayerData>).data?.memberIds ?? [];
    return [cellId, ...members.filter((id) => shown.has(id))];
  }
  return [cellId];
}

/** Zero is overview; steps occupy 1..count and never wrap around. */
export const clampPresentationIndex = (index: number, count: number): number =>
  Math.max(0, Math.min(count, index));

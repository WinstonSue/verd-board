import type { CellId } from '@sue/board-core';
import type { FrameFileV2 } from './frame-files';

/** @deprecated Read compatibility only. All diagrams are independent files. */
export type FrameOrganization =
  { kind: 'standalone' } | { kind: 'subgraph'; ownerFrameId?: CellId };

export type DiagramKind =
  | 'canvas'
  | 'mind'
  | 'workflow'
  | 'architecture'
  | 'uml-class'
  | 'uml-sequence';

const ANCHORS: Record<string, DiagramKind> = {
  'mind-root': 'mind',
  'workflow-start': 'workflow',
  'architecture-layer': 'architecture',
  'uml-class-root': 'uml-class',
  'uml-sequence-root': 'uml-sequence',
};

/** Diagram type comes from scene anchors already stored on the file. */
export const diagramKindOf = (file: FrameFileV2): DiagramKind => {
  for (const id of file.frame.children) {
    const kind = file.cells[id]?.kind;
    if (kind && ANCHORS[kind]) return ANCHORS[kind];
  }
  return 'canvas';
};

export const isSpecializedDiagram = (file: FrameFileV2) =>
  diagramKindOf(file) !== 'canvas';

export const isRegularCanvas = (file: FrameFileV2) =>
  diagramKindOf(file) === 'canvas';

/** Save, conflict, and history compare. Organization is part of the file. */
export const sameFrameFile = (left: FrameFileV2, right: FrameFileV2) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Runtime sync compare. Camera, selection, and tools ignore organization. */
export const sameFrameContent = (left: FrameFileV2, right: FrameFileV2) =>
  JSON.stringify({ frame: left.frame, cells: left.cells }) ===
  JSON.stringify({ frame: right.frame, cells: right.cells });

export interface ReferenceSourceGroup {
  fileId: CellId;
  refIds: CellId[];
}

/** Reference shells grouped by the canvas that contains them. */
export const referenceSourcesOf = (
  files: FrameFileV2[],
  targetId: CellId,
): ReferenceSourceGroup[] => {
  const groups = new Map<CellId, CellId[]>();
  files.forEach((file) => {
    Object.values(file.cells).forEach((cell) => {
      if (
        cell.kind === 'frame-reference' &&
        (cell as { data?: { targetFrameId?: CellId } }).data?.targetFrameId ===
          targetId
      ) {
        const list = groups.get(file.frame.id) ?? [];
        list.push(cell.id);
        groups.set(file.frame.id, list);
      }
    });
  });
  return [...groups.entries()]
    .map(([fileId, refIds]) => ({ fileId, refIds }))
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
};

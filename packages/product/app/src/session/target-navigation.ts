import type { WorkspaceTarget } from '@sue/board-common';
import type { CellSelection, Point } from '@sue/board-core';
import type { FrameFileV2 } from '../frames/frame-files';
import type { BoardTextSelection as DocumentSelection } from '@sue/board-common';

export interface WorkspaceNavigationRequest {
  requestId: number;
  target: WorkspaceTarget;
  origin?: NavigationOrigin;
  signal?: AbortSignal;
  frameReference?: {
    targetFrameId: string;
    occurrence: number;
    revision: string;
  };
}
export type NavigationOrigin = {
  fileId: string;
  groupId?: string;
} & (
  | {
      kind: 'canvas';
      sourceFileId?: string;
      selection: CellSelection;
      camera: { zoom: number; origination: Point };
      occurrenceId?: string;
      appearancePath?: readonly string[];
      embeddedDocument?: { cellId: string; state: unknown };
      reference?: { fileId: string; cellId: string };
    }
  | {
      kind: 'document';
      selection: DocumentSelection | null;
      revision: string;
      scroll: { top: number; left: number };
    }
);

/** Derived from validated live files. Ambiguous identities are never resolved. */
export function cellOwnerIndex(
  files: Iterable<FrameFileV2>,
): ReadonlyMap<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const file of files)
    for (const id of [file.frame.id, ...Object.keys(file.cells)])
      owners.set(id, owners.has(id) ? null : file.frame.id);
  return owners;
}
export function resolveWorkspaceTarget(
  target: WorkspaceTarget,
  files: ReadonlyMap<string, { file: FrameFileV2 }>,
  documents: ReadonlyMap<string, unknown>,
):
  | { status: 'resolved'; target: WorkspaceTarget }
  | { status: 'unavailable'; code: string; fallback?: WorkspaceTarget } {
  if (target.kind === 'cell') {
    const owner = cellOwnerIndex(
      [...files.values()].map((entry) => entry.file),
    ).get(target.cellId);
    if (owner === null)
      return { status: 'unavailable', code: 'ambiguous-cell' };
    if (owner)
      return { status: 'resolved', target: { ...target, fileId: owner } };
    return {
      status: 'unavailable',
      code: 'missing-cell',
      ...(files.has(target.fileId)
        ? { fallback: { kind: 'file' as const, fileId: target.fileId } }
        : {}),
    };
  }
  if (!files.has(target.fileId) && !documents.has(target.fileId))
    return { status: 'unavailable', code: 'missing-file' };
  if (target.kind === 'heading' && !documents.has(target.fileId))
    return { status: 'unavailable', code: 'wrong-file-type' };
  return { status: 'resolved', target };
}

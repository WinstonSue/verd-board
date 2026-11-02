import type { BoardTextNode } from '@sue/board-common';
import { isDocumentCell, isFrameReferenceCell } from '@sue/board-core';
import { workspaceFileId, type WorkspaceFile } from './document-files';

/** Runtime addresses of direct embeds. Never written into files or verd:// links. */
export type ReferenceLocation = {
  sourceFileId: string;
  targetFileId: string;
  ordinal: number;
  name?: string;
} & (
  | { kind: 'canvas'; refId: string }
  | {
      kind: 'document';
      occurrence: number;
      revision: string;
      targetBlockId?: string;
    }
);

type UnnumberedLocation<T = ReferenceLocation> = T extends ReferenceLocation
  ? Omit<T, 'ordinal'>
  : never;

export function isReferenceLocation(
  value: unknown,
): value is ReferenceLocation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReferenceLocation>;
  return (
    typeof item.sourceFileId === 'string' &&
    typeof item.targetFileId === 'string' &&
    typeof item.ordinal === 'number' &&
    Number.isInteger(item.ordinal) &&
    item.ordinal > 0 &&
    (item.kind === 'canvas'
      ? typeof item.refId === 'string'
      : item.kind === 'document' &&
        Number.isInteger(item.occurrence) &&
        item.occurrence! >= 0 &&
        typeof item.revision === 'string')
  );
}

export function buildReferenceLocations(
  files: readonly WorkspaceFile[],
): ReadonlyMap<string, readonly ReferenceLocation[]> {
  const index = new Map<string, ReferenceLocation[]>();
  for (const file of files) {
    const sourceFileId = workspaceFileId(file);
    const counts = new Map<string, number>();
    const add = (targetFileId: string, location: UnnumberedLocation) => {
      const ordinal = (counts.get(targetFileId) ?? 0) + 1;
      counts.set(targetFileId, ordinal);
      const locations = index.get(targetFileId) ?? [];
      locations.push({ ...location, ordinal } as ReferenceLocation);
      index.set(targetFileId, locations);
    };
    if (file.format === 'verd-frame') {
      // Frame children give a stable, visible ordering; groups may own descendants.
      const visited = new Set<string>();
      const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const cell = file.cells[id];
        if (!cell) return;
        if (isFrameReferenceCell(cell) || isDocumentCell(cell)) {
          const targetFileId = isFrameReferenceCell(cell)
            ? cell.data.targetFrameId
            : cell.data.targetDocumentId;
          add(targetFileId, {
            kind: 'canvas',
            sourceFileId,
            targetFileId,
            refId: cell.id,
            name: cell.name?.trim() || undefined,
          });
        }
        if ('children' in cell && Array.isArray(cell.children))
          cell.children.forEach(visit);
      };
      file.frame.children.forEach(visit);
      // Valid group-owned cells need not appear in frame.children.
      Object.keys(file.cells).forEach(visit);
    } else {
      const revision = JSON.stringify(file.text.content);
      let heading: string | undefined;
      const text = (node: BoardTextNode): string =>
        node.text ?? node.content?.map(text).join('') ?? '';
      const visit = (node: BoardTextNode) => {
        if (node.type === 'codeBlock') return;
        if (node.type === 'heading') heading = text(node).trim() || undefined;
        const target =
          node.attrs?.[
            node.type === 'documentExcerpt'
              ? 'targetDocumentId'
              : 'targetFrameId'
          ];
        if (
          (node.type === 'frameReference' || node.type === 'documentExcerpt') &&
          typeof target === 'string' &&
          target
        ) {
          add(target, {
            kind: 'document',
            sourceFileId,
            targetFileId: target,
            occurrence: counts.get(target) ?? 0,
            revision,
            name: heading,
            ...(node.type === 'documentExcerpt'
              ? { targetBlockId: String(node.attrs?.['targetBlockId'] ?? '') }
              : {}),
          });
        }
        node.content?.forEach(visit);
      };
      visit(file.text.content);
    }
  }
  return index;
}

export const referenceLocationKey = (location: ReferenceLocation): string =>
  JSON.stringify([
    location.sourceFileId,
    location.kind === 'canvas' ? location.refId : location.occurrence,
    location.targetFileId,
  ]);

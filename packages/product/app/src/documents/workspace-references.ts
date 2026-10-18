import {
  deriveBoardTextPlainText,
  isBoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';
import {
  isDocumentCell,
  isFrameReferenceCell,
  type CellId,
} from '@sue/board-core';
import {
  remapFrameFileIds,
  organizationForCopy,
  type FrameFileDiagnostic,
} from '../frames/frame-files';
import { type CopyOwnershipMode } from '../frames/frame-organization';
import {
  workspaceFileId,
  isWorkspaceFile,
  type WorkspaceFile,
} from './document-files';
import { createDocumentLink, parseDocumentLink } from './document-links';

export interface WorkspaceReference {
  sourceId: string;
  targetId: string;
  targetKind: 'canvas' | 'document';
}
export interface WorkspaceReferenceGraph {
  targetsOf: ReadonlyMap<string, readonly WorkspaceReference[]>;
  referencedBy: ReadonlyMap<string, readonly WorkspaceReference[]>;
}
export function buildWorkspaceReferenceGraph(
  files: readonly WorkspaceFile[],
): WorkspaceReferenceGraph {
  const targetsOf = new Map<string, WorkspaceReference[]>();
  const referencedBy = new Map<string, WorkspaceReference[]>();
  files.forEach((file) => {
    const references = workspaceReferences(file);
    targetsOf.set(workspaceFileId(file), references);
    references.forEach((ref) =>
      referencedBy.set(ref.targetId, [
        ...(referencedBy.get(ref.targetId) ?? []),
        ref,
      ]),
    );
  });
  return { targetsOf, referencedBy };
}
export function workspaceExportBundle(
  files: WorkspaceFile[],
  rootFileId: string,
) {
  return {
    format: 'verd-canvas-bundle' as const,
    version: 1 as const,
    files,
    rootFileId,
  };
}
export function parseWorkspaceExport(value: unknown): WorkspaceFile[] | null {
  if (isWorkspaceFile(value)) return [value];
  if (!value || typeof value !== 'object') return null;
  const bundle = value as {
    format?: unknown;
    version?: unknown;
    files?: unknown;
  };
  return bundle.format === 'verd-canvas-bundle' &&
    bundle.version === 1 &&
    Array.isArray(bundle.files) &&
    bundle.files.every(isWorkspaceFile)
    ? bundle.files
    : null;
}
export function workspaceReferences(file: WorkspaceFile): WorkspaceReference[] {
  const sourceId = workspaceFileId(file);
  const result: WorkspaceReference[] = [];
  if (file.format === 'verd-frame') {
    Object.values(file.cells).forEach((cell) => {
      if (isFrameReferenceCell(cell))
        result.push({
          sourceId,
          targetId: cell.data.targetFrameId,
          targetKind: 'canvas',
        });
      if (isDocumentCell(cell))
        result.push({
          sourceId,
          targetId: cell.data.targetDocumentId,
          targetKind: 'document',
        });
    });
  } else {
    const visit = (node: BoardTextNode) => {
      if (node.type === 'codeBlock') return;
      if (node.type === 'frameReference')
        result.push({
          sourceId,
          targetId:
            typeof node.attrs?.['targetFrameId'] === 'string'
              ? node.attrs['targetFrameId']
              : '',
          targetKind: 'canvas',
        });
      node.content?.forEach(visit);
    };
    visit(file.text.content);
  }
  return result;
}

/** Finite even for cycles; ownership is followed only from an owner to its children. */
export function workspaceFileClosure(
  files: readonly WorkspaceFile[],
  rootId: string,
): WorkspaceFile[] {
  const byId = new Map(files.map((file) => [workspaceFileId(file), file]));
  const references = buildWorkspaceReferenceGraph(files);
  const seen = new Set<string>();
  const result: WorkspaceFile[] = [];
  const visit = (id: string) => {
    const file = byId.get(id);
    if (!file || seen.has(id)) return;
    seen.add(id);
    result.push(file);
    references.targetsOf.get(id)?.forEach((ref) => visit(ref.targetId));
    files.forEach((child) => {
      if (
        child.format === 'verd-frame' &&
        child.organization?.kind === 'subgraph' &&
        child.organization.ownerFrameId === id
      )
        visit(child.frame.id);
    });
  };
  visit(rootId);
  return result;
}

export function validateWorkspaceReferences(
  files: readonly WorkspaceFile[],
  requireTargets = false,
): FrameFileDiagnostic[] {
  const byId = new Map(files.map((file) => [workspaceFileId(file), file]));
  return files.flatMap((file) =>
    workspaceReferences(file).flatMap((ref) => {
      const target = byId.get(ref.targetId);
      const valid = target
        ? ref.targetKind === 'canvas'
          ? target.format === 'verd-frame'
          : target.format === 'verd-document'
        : !requireTargets;
      return valid && ref.targetId
        ? []
        : [
            {
              frameId: ref.sourceId,
              message: `Invalid ${ref.targetKind} reference target: ${ref.targetId}`,
            },
          ];
    }),
  );
}

function remapText(
  node: BoardTextNode,
  ids: ReadonlyMap<string, string>,
): BoardTextNode {
  if (node.type === 'codeBlock') return node;
  const attrs =
    node.type === 'frameReference'
      ? {
          ...node.attrs,
          targetFrameId:
            ids.get(String(node.attrs?.['targetFrameId'])) ??
            node.attrs?.['targetFrameId'],
        }
      : node.attrs;
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => {
            if (
              mark.type !== 'link' ||
              typeof mark.attrs?.['href'] !== 'string'
            )
              return mark;
            const link = parseDocumentLink(mark.attrs['href']);
            return link?.kind === 'file' && ids.has(link.fileId)
              ? {
                  ...mark,
                  attrs: {
                    ...mark.attrs,
                    href: createDocumentLink(
                      ids.get(link.fileId)!,
                      link.anchor ?? undefined,
                    ),
                  },
                }
              : mark;
          }),
        }
      : {}),
    ...(node.content
      ? { content: node.content.map((child) => remapText(child, ids)) }
      : {}),
  };
}

/** Allocate once across both file kinds, then rewrite typed identities and links. */
export function remapWorkspaceFiles(
  files: readonly WorkspaceFile[],
  collide: (id: string) => boolean,
  createId: () => string,
  copy?: { rootId: string; mode?: CopyOwnershipMode; assignOwnerId?: string },
): { files: WorkspaceFile[]; idMap: Map<CellId, CellId> } {
  const all = files.flatMap((file) =>
    file.format === 'verd-frame'
      ? [file.frame.id, ...Object.keys(file.cells)]
      : [file.id],
  );
  if (new Set(all).size !== all.length)
    throw new Error('Duplicate identity in imported files');
  const claimed = new Set(all);
  const idMap = new Map<string, string>();
  for (const id of all) {
    if (!copy && !collide(id)) continue;
    let next = createId();
    while (claimed.has(next) || collide(next)) next = createId();
    claimed.add(next);
    idMap.set(id, next);
  }
  const remapped = files.map((original): WorkspaceFile => {
    const file = structuredClone(original);
    if (file.format === 'verd-document') {
      const id = idMap.get(file.id) ?? file.id;
      const content = remapText(file.text.content, idMap);
      return {
        ...file,
        id,
        text: {
          ...file.text,
          id,
          content,
          plainText: deriveBoardTextPlainText(content),
        },
      };
    }
    const next = remapFrameFileIds(file, idMap);
    Object.values(next.cells).forEach((cell) => {
      if (isDocumentCell(cell))
        cell.data = {
          ...cell.data,
          targetDocumentId:
            idMap.get(cell.data.targetDocumentId) ?? cell.data.targetDocumentId,
        };
      if (cell.cellType === 'node' && isBoardTextDocument(cell.content?.text)) {
        const content = remapText(cell.content.text.content, idMap);
        cell.content = {
          ...cell.content,
          text: {
            ...cell.content.text,
            content,
            plainText: deriveBoardTextPlainText(content),
          },
        };
      }
    });
    if (copy) {
      const org = organizationForCopy(file, idMap, {
        mode: copy.mode ?? 'retarget',
        isRoot: file.frame.id === copy.rootId,
        assignOwnerId: copy.assignOwnerId,
      });
      if (org) next.organization = org;
      else delete next.organization;
    }
    return next;
  });
  return { files: remapped, idMap };
}

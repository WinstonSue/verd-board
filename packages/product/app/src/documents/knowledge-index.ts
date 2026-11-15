import type { WorkspaceEntryMeta } from '@sue/verd-board-workspace';
import {
  createWorkspaceLink,
  parseWorkspaceLink,
  type BoardTextNode,
  type WorkspaceTarget,
} from '@sue/board-common';
import { createDocumentHeadingSlugger } from '@sue/board-react-text';
import { isEdgeCell, isNodeCell, nodeContentName } from '@sue/board-core';
import { workspaceFileId, type WorkspaceFile } from '@sue/verd-board-workspace';
import {
  buildReferenceLocations,
  type ReferenceLocation,
} from './reference-locations';

export interface KnowledgeTarget {
  href: string;
  title: string;
  detail: string;
  target: WorkspaceTarget;
  kind: 'folder' | 'document' | 'canvas' | 'heading' | 'block' | 'cell';
  legacyHref?: string;
}
export interface KnowledgeRelation {
  sourceFileId: string;
  target: WorkspaceTarget;
  source: WorkspaceTarget;
  kind: 'text' | 'cell' | 'embed';
  context: string;
  sourceText?: string;
  sourceFrom?: number;
  location?: ReferenceLocation;
}
const textOf = (node: BoardTextNode): string =>
  node.text ?? node.content?.map(textOf).join('') ?? '';
/** Derived knowledge edges deliberately never participate in export/save dependencies. */
export function createKnowledgeIndexer() {
  const cache = new WeakMap<
    WorkspaceFile,
    { targets: KnowledgeTarget[]; relations: KnowledgeRelation[] }
  >();
  return (
    files: readonly WorkspaceFile[],
    entries: readonly WorkspaceEntryMeta[] = [],
  ) => {
    const targets: KnowledgeTarget[] = [],
      relations: KnowledgeRelation[] = [];
    for (const file of files) {
      let record = cache.get(file);
      if (!record) {
        record = { targets: [], relations: [] };
        const id = workspaceFileId(file);
        const title =
          file.format === 'verd-document'
            ? file.title
            : (file.frame.name ?? id);
        const add = (
          target: WorkspaceTarget,
          name: string,
          kind: KnowledgeTarget['kind'],
          legacySlug?: string,
        ) => {
          // Empty headings and malformed legacy identities are not navigable targets.
          try {
            record!.targets.push({
              target,
              href: createWorkspaceLink(target),
              title: name || title,
              detail: title,
              kind,
              ...(target.kind === 'heading' && legacySlug
                ? {
                    legacyHref: createWorkspaceLink({
                      ...target,
                      slug: legacySlug,
                    }),
                  }
                : {}),
            });
          } catch {
            /* Keep the rest of the workspace searchable. */
          }
        };
        add(
          { kind: 'file', fileId: id },
          title,
          file.format === 'verd-document' ? 'document' : 'canvas',
        );
        const slug = createDocumentHeadingSlugger();
        const visitText = (
          node: BoardTextNode,
          source: WorkspaceTarget,
          context: string,
          position = -1,
        ) => {
          const blockId = node.attrs?.['blockId'];
          if (
            typeof blockId === 'string' &&
            node.type !== 'heading' &&
            source.kind !== 'cell'
          )
            add(
              {
                kind: 'heading',
                fileId: id,
                slug: 'block:' + blockId,
              },
              textOf(node).slice(0, 80) || '段落',
              'block',
            );
          if (node.type === 'codeBlock') return;
          if (node.type === 'heading' && source.kind !== 'cell') {
            const legacy = slug(textOf(node));
            source = {
              kind: 'heading',
              fileId: id,
              slug: typeof blockId === 'string' ? 'block:' + blockId : legacy,
            };
            add(
              source,
              textOf(node),
              'heading',
              typeof blockId === 'string' ? legacy : undefined,
            );
          }
          if (['paragraph', 'heading', 'listItem'].includes(node.type))
            context = textOf(node).slice(0, 240);
          for (const mark of node.marks ?? []) {
            const href = mark.type === 'link' && mark.attrs?.['href'];
            const target =
              typeof href === 'string' ? parseWorkspaceLink(href, id) : null;
            if (target)
              record!.relations.push({
                sourceFileId: id,
                source,
                target,
                kind: target.kind === 'cell' ? 'cell' : 'text',
                context: context || textOf(node),
                sourceText: textOf(node),
                sourceFrom: source.kind === 'cell' ? undefined : position,
              });
          }
          const size = (child: BoardTextNode): number =>
            child.type === 'text'
              ? (child.text?.length ?? 0)
              : child.content
                ? 2 + child.content.reduce((sum, item) => sum + size(item), 0)
                : 1;
          let offset = position + 1;
          node.content?.forEach((child) => {
            visitText(child, source, context, offset);
            offset += size(child);
          });
        };
        if (file.format === 'verd-document')
          visitText(file.text.content, { kind: 'file', fileId: id }, '');
        else {
          const scan = (value: unknown, source: WorkspaceTarget) => {
            if (!value || typeof value !== 'object') return;
            const obj = value as Record<string, unknown>;
            if (
              typeof obj['type'] === 'string' &&
              (obj['content'] || obj['text'])
            ) {
              visitText(value as BoardTextNode, source, '');
              return;
            }
            if (Array.isArray(value)) value.forEach((v) => scan(v, source));
            else Object.values(obj).forEach((v) => scan(v, source));
          };
          for (const cell of Object.values(file.cells)) {
            const source: WorkspaceTarget = {
              kind: 'cell',
              fileId: id,
              cellId: cell.id,
            };
            const label = isNodeCell(cell)
              ? nodeContentName(cell)
              : isEdgeCell(cell)
                ? cell.labels?.[0]?.text
                : undefined;
            add(
              source,
              ('name' in cell && cell.name) || label || cell.id,
              'cell',
            );
            scan(cell, source);
          }
        }
        for (const locations of buildReferenceLocations([file]).values())
          for (const location of locations) {
            record.relations.push({
              sourceFileId: location.sourceFileId,
              source:
                location.kind === 'canvas'
                  ? {
                      kind: 'cell',
                      fileId: location.sourceFileId,
                      cellId: location.refId,
                    }
                  : { kind: 'file', fileId: location.sourceFileId },
              target:
                location.kind === 'document' && location.targetBlockId
                  ? {
                      kind: 'heading',
                      fileId: location.targetFileId,
                      slug: 'block:' + location.targetBlockId,
                    }
                  : { kind: 'file', fileId: location.targetFileId },
              kind: 'embed',
              context: location.name ?? '',
              location,
            });
          }
        cache.set(file, record);
      }
      targets.push(...record.targets);
      relations.push(...record.relations);
    }
    const folders = new Map<string, WorkspaceEntryMeta | null>();
    for (const entry of entries) {
      if (entry.kind === 'directory' && entry.folderId)
        folders.set(entry.folderId, folders.has(entry.folderId) ? null : entry);
    }
    for (const [folderId, entry] of folders) {
      if (!entry) continue;
      const target = { kind: 'folder' as const, folderId };
      targets.push({
        target,
        href: createWorkspaceLink(target),
        title: entry.path.split('/').at(-1) ?? entry.path,
        detail: entry.path,
        kind: 'folder',
      });
    }
    const cellOwners = new Map(
      targets.flatMap((item) =>
        item.target.kind === 'cell'
          ? [[item.target.cellId, item.target] as const]
          : [],
      ),
    );
    return {
      targets,
      relations: relations.map((relation) => {
        if (relation.target.kind !== 'cell') return relation;
        const target = cellOwners.get(relation.target.cellId);
        return target && target.fileId !== relation.target.fileId
          ? { ...relation, target }
          : relation;
      }),
    };
  };
}
export function queryKnowledgeTargets(
  targets: readonly KnowledgeTarget[],
  query: string,
  limit = 40,
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return targets
    .filter((item) =>
      terms.every((term) =>
        `${item.title}\n${item.detail}`.toLocaleLowerCase().includes(term),
      ),
    )
    .slice(0, limit);
}

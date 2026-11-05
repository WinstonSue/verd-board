import {
  deriveBoardTextPlainText,
  isBoardTextDocumentShape,
  mapBoardTextLinks,
  mapStandardCellLinks,
  parseWorkspaceLink,
  parseExternalLink,
  type BoardTextNode,
} from '@sue/board-common';
import {
  createDocumentSchema,
  createCanvasTextSchema,
  createDocumentHeadingSlugger,
} from '@sue/board-react-text/schema';
import { type CellRegistry } from '@sue/board-core';
import {
  isWorkspaceFile,
  workspaceFileId,
  type WorkspaceFile,
} from './documents/document-files';
import { validateWorkspaceReferences } from './documents/workspace-references';
import {
  validateFrameFiles,
  buildOrganizationIndex,
  type FrameFileV2,
} from './frames/frame-files';
import { createWorkspaceCellRegistry } from './frames/plugins';

export interface AuthoringDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  fileId?: string;
  cellId?: string;
  pointer?: string;
  suggestion?: string;
}
export interface NativeWorkspaceEntry {
  path: string;
  file: unknown;
}
export const WORKSPACE_RULES = {
  'file.invalid': 'Use a supported native document or frame envelope.',
  'identity.duplicate':
    'Keep file and cell identities unique throughout the workspace.',
  'document.identity': 'Keep document.id and document.text.id equal.',
  'text.cache': 'Derive plainText from content using deriveBoardTextPlainText.',
  'text.schema': 'Use the actual editor schema returned by describe.',
  'frame.invalid': 'Use the registered cell kinds, scene membership and ports.',
  'reference.invalid': 'References must target the correct native file kind.',
  'organization.invalid': 'Follow supported standalone/subgraph ownership.',
  'link.invalid': 'Use supported external URLs or stable verd workspace links.',
  'link.file':
    'Create the linked file in the same workspace or correct its ID.',
  'link.folder':
    'Use a stable link to a uniquely identified folder in this workspace.',
  'link.cell': 'Use a globally unique existing cell ID.',
  'link.heading':
    'Use the current GitHub heading slug including duplicate suffixes.',
} as const;

/** Shared by external authoring and repository checks; never changes the inputs. */
export function validateNativeWorkspace(
  entries: readonly NativeWorkspaceEntry[],
  options: {
    profile?: 'runtime' | 'authoring';
    registry?: CellRegistry;
    /** Omit when validating a file-only bundle without directory metadata. */
    folderIds?: readonly string[];
  } = {},
): AuthoringDiagnostic[] {
  const registry = options.registry ?? createWorkspaceCellRegistry();
  const strict = options.profile !== 'runtime';
  const diagnostics: AuthoringDiagnostic[] = [];
  const files = new Map<string, WorkspaceFile>();
  const paths = new Map<string, string>();
  const identities = new Set<string>();
  const report = (
    code: keyof typeof WORKSPACE_RULES,
    message: string,
    extra: Partial<AuthoringDiagnostic> = {},
  ) =>
    diagnostics.push({
      code,
      severity: 'error',
      message,
      suggestion: WORKSPACE_RULES[code],
      ...extra,
    });
  const documentSchema = createDocumentSchema();
  const textSchema = createCanvasTextSchema();
  const walk = (node: BoardTextNode, visit: (n: BoardTextNode) => void) => {
    visit(node);
    node.content?.forEach((n) => walk(n, visit));
  };
  for (const entry of entries) {
    if (!isWorkspaceFile(entry.file)) {
      report('file.invalid', 'Invalid native workspace file', {
        path: entry.path,
      });
      continue;
    }
    const file = entry.file,
      id = workspaceFileId(file);
    paths.set(id, entry.path);
    for (const identity of [
      id,
      ...(file.format === 'verd-frame' ? Object.keys(file.cells) : []),
    ]) {
      if (identities.has(identity))
        report('identity.duplicate', `Duplicate identity: ${identity}`, {
          fileId: id,
          path: entry.path,
          cellId: identity,
        });
      identities.add(identity);
    }
    files.set(id, file);
    const checkText = (
      text: import('@sue/board-common').BoardTextDocument,
      pointer: string,
      cellId?: string,
    ) => {
      if (text.plainText !== deriveBoardTextPlainText(text.content))
        report('text.cache', 'Document plainText cache differs from content', {
          path: entry.path,
          fileId: id,
          cellId,
          pointer,
        });
      try {
        (file.format === 'verd-document' ? documentSchema : textSchema)
          .nodeFromJSON(text.content)
          .check();
      } catch (error) {
        report('text.schema', String(error), {
          path: entry.path,
          fileId: id,
          cellId,
          pointer,
        });
      }
    };
    if (file.format === 'verd-document') {
      if (file.text.id !== id)
        report(
          'document.identity',
          'Document identity differs from body identity',
          {
            path: entry.path,
            fileId: id,
            pointer: '/text/id',
          },
        );
      if (strict) checkText(file.text, '/text');
    } else if (strict) {
      const visitText = (value: unknown, pointer: string, cellId: string) => {
        if (isBoardTextDocumentShape(value)) {
          checkText(value, pointer, cellId);
          return;
        }
        if (Array.isArray(value))
          value.forEach((v, i) => visitText(v, `${pointer}/${i}`, cellId));
        else if (value && typeof value === 'object')
          for (const [key, v] of Object.entries(value))
            visitText(v, `${pointer}/${key}`, cellId);
      };
      for (const cell of Object.values(file.cells))
        visitText(
          cell,
          `/cells/${cell.id.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          cell.id,
        );
    }
  }
  const frames = [...files.values()].filter(
    (f): f is FrameFileV2 => f.format === 'verd-frame',
  );
  try {
    for (const issue of validateFrameFiles(frames, registry))
      report('frame.invalid', issue.message, {
        fileId: issue.frameId,
        cellId: issue.cellId,
        path: paths.get(issue.frameId ?? ''),
      });
    for (const issue of validateWorkspaceReferences(
      [...files.values()],
      strict,
    ))
      report('reference.invalid', issue.message, {
        fileId: issue.frameId,
        cellId: issue.cellId,
        path: paths.get(issue.frameId ?? ''),
      });
    for (const issue of buildOrganizationIndex(frames).diagnostics)
      report('organization.invalid', issue.message, {
        fileId: issue.frameId,
        path: paths.get(issue.frameId ?? ''),
      });
  } catch (error) {
    report('frame.invalid', String(error));
  }
  if (!strict) return diagnostics;
  const headings = new Map<string, Set<string>>();
  const owners = new Map<string, string>();
  for (const [id, file] of files) {
    if (file.format === 'verd-document') {
      const slug = createDocumentHeadingSlugger(),
        found = new Set<string>();
      walk(file.text.content, (n) => {
        if (n.type === 'heading') found.add(slug(deriveBoardTextPlainText(n)));
      });
      headings.set(id, found);
    } else
      for (const cellId of [id, ...Object.keys(file.cells)])
        owners.set(cellId, id);
  }
  const folderCounts = new Map<string, number>();
  for (const id of options.folderIds ?? [])
    folderCounts.set(id, (folderCounts.get(id) ?? 0) + 1);
  for (const [id, file] of files) {
    const visitHref = (href: string) => {
      const link = parseWorkspaceLink(href, id);
      const extra = { fileId: id, path: paths.get(id) };
      if (link?.kind === 'folder') {
        if (options.folderIds && folderCounts.get(link.folderId) !== 1)
          report(
            'link.folder',
            `Missing or ambiguous linked folder: ${link.folderId}`,
            extra,
          );
      } else if (link?.kind === 'cell') {
        if (!owners.has(link.cellId))
          report('link.cell', `Missing linked cell: ${link.cellId}`, extra);
      } else if (link) {
        if (!files.has(link.fileId))
          report('link.file', `Missing linked file ${link.fileId}`, extra);
        else if (
          link.kind === 'heading' &&
          !headings.get(link.fileId)?.has(link.slug)
        )
          report('link.heading', `Missing linked heading ${link.slug}`, extra);
      } else if (!parseExternalLink(href))
        report('link.invalid', `Invalid link: ${href}`, extra);
      return href;
    };
    if (file.format === 'verd-document')
      mapBoardTextLinks(file.text, visitHref);
    else
      for (const cell of [file.frame, ...Object.values(file.cells)]) {
        mapStandardCellLinks(cell, visitHref);
        registry.plugins.forEach((p) => p.mapLinks?.(cell, visitHref));
      }
  }
  return diagnostics;
}

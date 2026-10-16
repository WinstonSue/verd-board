import {
  Alignment,
  isBoardTextDocumentShape,
  type BoardTextDocument,
} from '@sue/board-common';
import type { CellId } from '@sue/board-core';
import { isFrameFileV2, type FrameFileV2 } from '../frames/frame-files';
import { DOCUMENT_FILE_SUFFIX, baseName } from '../host/workspace-host';

/**
 * Standalone rich-text document: a peer of the canvas `.verd.json` file.
 * `id` is the workspace file identity — renames, moves, trash and restore
 * never change it; duplication and identity-colliding imports do, and keep
 * `text.id` in step.
 */
export interface DocumentFileV1 {
  format: 'verd-document';
  version: 1;
  id: CellId;
  title: string;
  text: BoardTextDocument;
}

/** Every persistable workspace file. */
export type WorkspaceFile = FrameFileV2 | DocumentFileV1;

export const isDocumentFileV1 = (value: unknown): value is DocumentFileV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as DocumentFileV1;
  return (
    candidate.format === 'verd-document' &&
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    !!candidate.id &&
    typeof candidate.title === 'string' &&
    isBoardTextDocumentShape(candidate.text) &&
    candidate.text.kind === 'block'
  );
};

export const isWorkspaceFile = (value: unknown): value is WorkspaceFile =>
  isDocumentFileV1(value) || isFrameFileV2(value);

/**
 * Explains why a parsed value is not a usable document, for host and
 * session diagnostics. `null` means the value validates.
 */
export const documentFileDiagnostic = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'Not a document file';
  const candidate = value as Partial<DocumentFileV1> & {
    format?: unknown;
    version?: unknown;
  };
  if (candidate.format !== 'verd-document')
    return `Unsupported format: ${String(candidate.format ?? 'missing')}`;
  if (candidate.version !== 1)
    return `Unsupported document version: ${String(candidate.version ?? 'missing')}`;
  if (typeof candidate.id !== 'string' || !candidate.id)
    return 'Document file is missing an identity';
  if (typeof candidate.title !== 'string') return 'Document title is invalid';
  if (!isBoardTextDocumentShape(candidate.text))
    return 'Document body is malformed';
  if (candidate.text.kind !== 'block')
    return 'Document body must be block text';
  return null;
};

/** A fresh document body: empty paragraph, left aligned. */
export const createDocumentText = (id: CellId): BoardTextDocument => ({
  schemaVersion: 1,
  id,
  kind: 'block',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  plainText: '',
  align: Alignment.left,
});

export const createDocumentFile = (
  id: CellId,
  title = '未命名文档',
): DocumentFileV1 => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: createDocumentText(id),
});

export const workspaceFileId = (file: WorkspaceFile): CellId =>
  file.format === 'verd-frame' ? file.frame.id : file.id;

export const workspaceFileTitle = (file: WorkspaceFile): string =>
  file.format === 'verd-frame'
    ? file.frame.name || '未命名画布'
    : file.title || '未命名文档';

/** Rename writes the title; the caller decides the matching path. */
export const renameDocumentFile = (
  file: DocumentFileV1,
  title: string,
): DocumentFileV1 => ({ ...file, title });

/** Independent copy: fresh file and body identities. */
export const duplicateDocumentFile = (
  file: DocumentFileV1,
  createId: () => string,
): DocumentFileV1 => {
  const clone = JSON.parse(JSON.stringify(file)) as DocumentFileV1;
  const id = createId();
  return { ...clone, id, text: { ...clone.text, id } };
};

/**
 * Import-time identity repair: colliding ids get a fresh identity with
 * `text.id` kept in step; foreign ids pass through unchanged.
 */
export const remapImportedDocument = (
  file: DocumentFileV1,
  collide: (id: CellId) => boolean,
  createId: () => string,
): DocumentFileV1 => {
  if (!collide(file.id) && file.text.id === file.id) return file;
  const id = collide(file.id) ? createId() : file.id;
  return { ...file, id, text: { ...file.text, id } };
};

/** Deterministic file name from the title, deduplicated inside a dir. */
export const documentPathFor = (
  file: DocumentFileV1,
  dir: string,
  taken: ReadonlySet<string>,
): string => {
  const title = (file.title || '未命名文档').replace(/[/\\]/g, '-');
  for (let index = 1; ; index += 1) {
    const name =
      index === 1
        ? `${title}${DOCUMENT_FILE_SUFFIX}`
        : `${title} ${index}${DOCUMENT_FILE_SUFFIX}`;
    const candidate = dir ? `${dir}/${name}` : name;
    if (!taken.has(candidate)) return candidate;
  }
};

export const documentDisplayName = (path: string) =>
  baseName(path).replace(/\.verd-doc\.json$/, '');

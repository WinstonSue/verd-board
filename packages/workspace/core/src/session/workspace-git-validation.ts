import type { CellRegistry } from '@sue/board-core';
import {
  documentFileDiagnostic,
  isWorkspaceFile,
  workspaceFileId,
  type WorkspaceFile,
} from '../documents/document-files';
import { collectWorkspaceAssetIds } from '../documents/workspace-package';
import {
  validateWorkspaceReferences,
  workspaceReferences,
} from '../documents/workspace-references';
import {
  assembleWorkspaceStore,
  validateFrameFiles,
  type FrameFileV2,
} from '../frames/frame-files';
import { createWorkspaceCellRegistry } from '../frames/plugins';
import { isCanvasPath, isDocumentPath } from '../host/workspace-host';
import type { GitVersionFile } from '../host/workspace-git';

/** Validate the actual proposed Git tree, rather than the editor's unrelated drafts. */
export function validateGitVersionFiles(
  entries: readonly GitVersionFile[],
  registry: CellRegistry = createWorkspaceCellRegistry(),
  baseline?: readonly GitVersionFile[],
): void {
  const files: WorkspaceFile[] = [];
  const paths = new Set(entries.map((entry) => entry.path));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!isCanvasPath(entry.path) && !isDocumentPath(entry.path)) continue;
    if (
      entry.path.startsWith('.verdscrolls/') ||
      entry.path.startsWith('.git/')
    )
      continue;
    let file: unknown;
    try {
      file = JSON.parse(new TextDecoder().decode(entry.content));
    } catch {
      throw new Error('Invalid native file in Git version: ' + entry.path);
    }
    if (!isWorkspaceFile(file))
      throw new Error('Invalid native file in Git version: ' + entry.path);
    const id = workspaceFileId(file);
    if (ids.has(id))
      throw new Error('Duplicate native identity in Git version: ' + id);
    ids.add(id);
    if (file.format === 'verd-document') {
      const diagnostic = documentFileDiagnostic(file);
      if (diagnostic) throw new Error(entry.path + ': ' + diagnostic);
      if (file.text.id !== id)
        throw new Error(
          'Document identity drift in Git version: ' + entry.path,
        );
    }
    files.push(file);
  }
  const frames = files.filter(
    (file): file is FrameFileV2 => file.format === 'verd-frame',
  );
  const issues = [
    ...validateFrameFiles(frames, registry),
    ...assembleWorkspaceStore(frames, registry).diagnostics,
    ...validateWorkspaceReferences(files),
  ];
  if (issues.length)
    throw new Error(
      'Git version has invalid structure or missing dependencies: ' +
        issues.map((issue) => issue.message).join('; '),
    );
  if (baseline !== undefined) {
    const previous: WorkspaceFile[] = [];
    for (const entry of baseline) {
      if (!isCanvasPath(entry.path) && !isDocumentPath(entry.path)) continue;
      if (
        entry.path.startsWith('.verdscrolls/') ||
        entry.path.startsWith('.git/')
      )
        continue;
      try {
        const file: unknown = JSON.parse(
          new TextDecoder().decode(entry.content),
        );
        if (isWorkspaceFile(file)) previous.push(file);
      } catch {
        /* Older external commits may contain unavailable legacy files. */
      }
    }
    const oldIds = new Set(previous.map(workspaceFileId));
    const key = (reference: ReturnType<typeof workspaceReferences>[number]) =>
      `${reference.sourceId}\0${reference.targetKind}\0${reference.targetId}`;
    const oldReferences = new Set(
      previous.flatMap(workspaceReferences).map(key),
    );
    for (const reference of files.flatMap(workspaceReferences))
      if (
        !ids.has(reference.targetId) &&
        !oldIds.has(reference.targetId) &&
        !oldReferences.has(key(reference))
      )
        throw new Error(
          'Git version introduces a missing dependency; include the referenced source: ' +
            reference.targetId,
        );
  }
  for (const asset of collectWorkspaceAssetIds(files)) {
    if (
      !paths.has('.verdscrolls/resources/assets/' + asset) &&
      !paths.has('.verd-resources/assets/' + asset)
    )
      throw new Error('Git version is missing attachment: ' + asset);
  }
}

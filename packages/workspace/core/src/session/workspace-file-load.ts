import { isWorkspaceContentPath } from '../workspace-skills';
import type { CellId, CellRegistry } from '@sue/board-core';
import {
  documentFileDiagnostic,
  workspaceFileId,
  type WorkspaceFile,
} from '../documents/document-files';
import {
  validateWorkspaceReferences,
  workspaceReferences,
} from '../documents/workspace-references';
import {
  assembleWorkspaceStore,
  validateFrameFiles,
  WORKSPACE_ROOT_ID,
  type FrameFileDiagnostic,
  type FrameFileV2,
} from '../frames/frame-files';
import {
  isDocumentPath,
  isProjectInternalPath,
  type FileVersion,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceHostSnapshot,
} from '../host/workspace-host';
import type { WorkspaceFileEntry } from './workspace-session';

/** Unavailable disk content is kept out of the editable file/store indexes. */
export interface FailedWorkspaceFile {
  path: string;
  fileId?: CellId;
  version?: FileVersion;
  kind: 'canvas' | 'document';
  diagnostics: FrameFileDiagnostic[];
}

/** Validate an untrusted host snapshot before publishing any of its content. */
export async function readWorkspaceFiles(
  host: WorkspaceHost,
  handle: WorkspaceHandle,
  snapshot: WorkspaceHostSnapshot,
  registry: CellRegistry,
  previous: ReadonlyMap<CellId, WorkspaceFileEntry> = new Map(),
  previousFailures: ReadonlyMap<string, FailedWorkspaceFile> = new Map(),
) {
  const failedFiles = new Map<string, FailedWorkspaceFile>();
  const previousIds = new Map(
    [...previous].map(([id, entry]) => [entry.path, id]),
  );
  const candidates: WorkspaceFileEntry[] = [];
  const fail = (
    path: string,
    version: FileVersion | undefined,
    issues: FrameFileDiagnostic[],
    id?: CellId,
  ) => {
    const fileId =
      id ?? previousIds.get(path) ?? previousFailures.get(path)?.fileId;
    const prior = failedFiles.get(path);
    failedFiles.set(path, {
      path,
      fileId,
      version,
      kind: isDocumentPath(path) ? 'document' : 'canvas',
      diagnostics: [
        ...(prior?.diagnostics ?? []),
        ...issues.map((issue) => ({
          ...issue,
          path,
          frameId: fileId,
        })),
      ],
    });
  };
  const register = (
    path: string,
    version: FileVersion,
    value: unknown,
    diagnostic?: string,
  ) => {
    if (
      isProjectInternalPath(path) ||
      !isWorkspaceContentPath(path, snapshot.entries)
    )
      return;
    const raw = value as { id?: unknown; frame?: { id?: unknown } } | null;
    const rawId = isDocumentPath(path) ? raw?.id : raw?.frame?.id;
    const id = typeof rawId === 'string' ? rawId : undefined;
    try {
      const issues = isDocumentPath(path)
        ? (() => {
            const message = documentFileDiagnostic(value);
            if (message) return [{ message }];
            const file = value as WorkspaceFile & { format: 'verd-document' };
            return file.text.id === file.id
              ? []
              : [
                  {
                    message:
                      'Document body identity drifted from the file identity',
                  },
                ];
          })()
        : validateFrameFiles([value as FrameFileV2], registry);
      if (diagnostic || issues.length) {
        fail(
          path,
          version,
          diagnostic ? [{ message: diagnostic }] : issues,
          id,
        );
        return;
      }
      if (id === WORKSPACE_ROOT_ID) {
        fail(
          path,
          version,
          [{ message: `Reserved workspace root id: ${id}` }],
          id,
        );
        return;
      }
      const file = value as WorkspaceFile;
      const normalized = file.format === 'verd-frame' ? { ...file } : file;
      if (normalized.format === 'verd-frame') delete normalized.organization;
      candidates.push({
        file: normalized,
        path,
        version,
        dirty: false,
      });
    } catch (error) {
      fail(
        path,
        version,
        [{ message: error instanceof Error ? error.message : String(error) }],
        id,
      );
    }
  };
  snapshot.canvases.forEach((payload) =>
    register(payload.path, payload.version, payload.file, payload.diagnostic),
  );
  if (snapshot.documents !== undefined) {
    snapshot.documents.forEach((payload) =>
      register(payload.path, payload.version, payload.file, payload.diagnostic),
    );
  } else {
    // Older hosts expose independent documents only through raw entries.
    for (const entry of snapshot.entries) {
      if (entry.kind !== 'file' || !isDocumentPath(entry.path)) continue;
      try {
        const raw = await host.readFile(handle, entry.path);
        const value: unknown = JSON.parse(
          new TextDecoder().decode(raw.content),
        );
        register(entry.path, raw.version, value);
      } catch (error) {
        fail(entry.path, entry.version, [{ message: String(error) }]);
      }
    }
  }
  const claimed = new Map<CellId, WorkspaceFileEntry[]>();
  for (const entry of candidates) {
    const ids =
      entry.file.format === 'verd-frame'
        ? [entry.file.frame.id, ...Object.keys(entry.file.cells)]
        : [entry.file.id];
    for (const id of ids) claimed.set(id, [...(claimed.get(id) ?? []), entry]);
  }
  claimed.forEach((owners, id) => {
    if (owners.length < 2) return;
    owners.forEach((entry) =>
      fail(
        entry.path,
        entry.version,
        [{ cellId: id, message: `Duplicate file/cell identity: ${id}` }],
        workspaceFileId(entry.file),
      ),
    );
  });
  // The merge keeps dirty local bodies. Incoming disk files must not clash
  // with those bodies even when the disk-only snapshot is valid.
  for (const [localId, local] of previous) {
    if (!local.dirty) continue;
    const ids =
      local.file.format === 'verd-frame'
        ? [localId, ...Object.keys(local.file.cells)]
        : [localId];
    for (const id of ids) {
      for (const incoming of claimed.get(id) ?? []) {
        if (workspaceFileId(incoming.file) !== localId)
          fail(
            incoming.path,
            incoming.version,
            [
              {
                cellId: id,
                message: `Identity conflicts with unsaved local content: ${id}`,
              },
            ],
            workspaceFileId(incoming.file),
          );
      }
    }
    for (const reference of workspaceReferences(local.file)) {
      for (const incoming of claimed.get(reference.targetId) ?? []) {
        if (
          workspaceFileId(incoming.file) !== reference.targetId ||
          (reference.targetKind === 'canvas') !==
            (incoming.file.format === 'verd-frame')
        )
          fail(
            incoming.path,
            incoming.version,
            [
              {
                message: `Reference conflicts with unsaved local content: ${reference.targetId}`,
              },
            ],
            workspaceFileId(incoming.file),
          );
      }
    }
  }
  // Removing a bad target leaves a supported missing-reference placeholder.
  // Re-evaluate the remaining graph so no invalid assembled store is exposed.
  let remaining = candidates.filter((entry) => !failedFiles.has(entry.path));
  while (remaining.length) {
    const list = remaining.map((entry) => entry.file);
    const frames = list.filter(
      (file): file is FrameFileV2 => file.format === 'verd-frame',
    );
    let issues: FrameFileDiagnostic[];
    try {
      issues = [
        ...validateFrameFiles(frames, registry),
        ...validateWorkspaceReferences(list),
        ...assembleWorkspaceStore(frames, registry).diagnostics,
      ];
    } catch (error) {
      issues = [
        { message: error instanceof Error ? error.message : String(error) },
      ];
    }
    if (!issues.length) break;
    for (const issue of issues) {
      const owners = issue.frameId
        ? remaining.filter(
            (entry) => workspaceFileId(entry.file) === issue.frameId,
          )
        : issue.cellId
          ? (claimed.get(issue.cellId) ?? [])
          : remaining;
      (owners.length ? owners : remaining).forEach((entry) =>
        fail(entry.path, entry.version, [issue], workspaceFileId(entry.file)),
      );
    }
    remaining = remaining.filter((entry) => !failedFiles.has(entry.path));
  }
  // Hosts may report a failed read without including a payload.
  snapshot.diagnostics.forEach((issue) => {
    if (
      issue.path &&
      /\.verd(?:(?:-doc)?\.json)?$/.test(issue.path) &&
      !failedFiles.has(issue.path)
    )
      fail(
        issue.path,
        snapshot.entries.find((entry) => entry.path === issue.path)?.version,
        [issue],
      );
  });
  const files = new Map(
    remaining
      .filter((entry) => !failedFiles.has(entry.path))
      .map((entry) => [workspaceFileId(entry.file), entry]),
  );
  const diagnostics = [
    ...snapshot.diagnostics.filter(
      (issue) => !issue.path || !failedFiles.has(issue.path),
    ),
    ...[...failedFiles.values()].flatMap((failure) => failure.diagnostics),
  ];
  return { files, failedFiles, diagnostics };
}

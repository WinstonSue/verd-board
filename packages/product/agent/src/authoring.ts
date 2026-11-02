import { importUmlMermaid } from './mermaid-import';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { patterns, patternWorkspaceUrl } from '@sue/verd-board-agent-patterns';
import {
  validateNativeWorkspace,
  isWorkspaceFile,
  workspaceFileId,
  remapWorkspaceFiles,
  createWorkspaceCellRegistry,
  normalizeWorkspacePath,
  WORKSPACE_RULES,
  type WorkspaceFile,
} from '@sue/verd-board-app/headless';
import { createDocumentSchema } from '@sue/board-react-text/schema';
import {
  parseMermaidToWorkflowFrame,
  parseMermaidToArchitectureFrame,
} from '@sue/board-mermaid-to-board';
import { frameFileFor } from '@sue/verd-board-app/headless';
import { digest, type NativeSnapshot } from './node/workspace-lock';
import { parseOperations, authoringOperationSchema } from './schema';
import { runOperations } from './operations';
import type {
  PreparedBatch,
  AuthoringOperation,
  AuthoringEntry,
} from './types';

export async function expandPatterns(
  operations: AuthoringOperation[],
): Promise<{
  operations: AuthoringOperation[];
  idMap: Record<string, string>;
}> {
  const expanded: AuthoringOperation[] = [];
  const sourceMap: Record<string, string> = {};
  for (const [operationIndex, op] of operations.entries()) {
    if (op.type === 'mermaid.import') {
      const snapshot =
        op.scene === 'workflow'
          ? parseMermaidToWorkflowFrame(op.source)
          : op.scene === 'architecture'
            ? parseMermaidToArchitectureFrame(op.source)
            : await importUmlMermaid(op.source, op.scene);
      const imported = frameFileFor(snapshot.store, snapshot.store.rootId);
      const sourceIds = new Set([
        imported.frame.id,
        ...Object.keys(imported.cells),
      ]);
      const remappedImport = remapWorkspaceFiles(
        [imported],
        (id) => sourceIds.has(id),
        () => randomUUID(),
        undefined,
        createWorkspaceCellRegistry(),
      );
      for (const [oldId, newId] of remappedImport.idMap)
        sourceMap[`${operationIndex}:${oldId}`] = newId;
      const file = remappedImport
        .files[0] as import('@sue/verd-board-app/headless').FrameFileV2;
      if (op.title) file.frame.name = op.title;
      file.organization = { kind: 'standalone' };
      expanded.push({ type: 'file.import', file, path: op.path });
      continue;
    }
    if (op.type !== 'pattern.instantiate') {
      expanded.push(op);
      continue;
    }
    const pattern = patterns.find((p) => p.id === op.patternId);
    if (!pattern) throw new Error('Unknown pattern: ' + op.patternId);
    if (Object.keys(op.parameters ?? {}).some((k) => k !== 'title'))
      throw new Error('Unknown pattern parameter');
    const files: WorkspaceFile[] = await Promise.all(
      pattern.templatePaths.map(async (p) =>
        JSON.parse(await fs.readFile(new URL(p, patternWorkspaceUrl), 'utf8')),
      ),
    );
    const sourceIds = new Set(
      files.flatMap((f) =>
        f.format === 'verd-frame'
          ? [f.frame.id, ...Object.keys(f.cells)]
          : [f.id],
      ),
    );
    const { files: remapped, idMap } = remapWorkspaceFiles(
      files,
      (id) => sourceIds.has(id),
      () => randomUUID(),
      undefined,
      createWorkspaceCellRegistry(),
    );
    for (const [oldId, newId] of idMap)
      sourceMap[`${operationIndex}:${oldId}`] = newId;
    for (let i = 0; i < remapped.length; i++) {
      const file = remapped[i];
      if (
        workspaceFileId(file) === idMap.get(pattern.rootFileId) &&
        op.parameters?.title
      ) {
        if (file.format === 'verd-document') file.title = op.parameters.title;
        else file.frame.name = op.parameters.title;
      }
      const base = path.posix.basename(pattern.templatePaths[i]);
      expanded.push({
        type: 'file.import',
        file,
        path: `${op.dir ? normalizeWorkspacePath(op.dir) + '/' : ''}${workspaceFileId(file).slice(0, 8)}-${base}`,
      });
    }
  }
  return { operations: expanded, idMap: sourceMap };
}
export const planIntegrity = (
  plan: Omit<PreparedBatch, 'integrity'> | PreparedBatch,
) => {
  const { integrity: _integrity, ...rest } = plan as PreparedBatch;
  return digest(JSON.stringify(rest));
};
export async function prepareAuthoringBatch(
  snapshot: NativeSnapshot,
  operations: unknown,
): Promise<PreparedBatch> {
  if (
    snapshot.diagnostics.some((d) => d.code === 'workspace.recovery-required')
  )
    throw new Error(
      'RECOVERY_REQUIRED: open the workspace or confirm the pending transaction first',
    );
  const original = snapshot.entries
    .filter((e) => isWorkspaceFile(e.file))
    .map((e) => ({ path: e.path, file: e.file as WorkspaceFile }));
  const expanded = await expandPatterns(parseOperations(operations));
  const result = runOperations(original, expanded.operations);
  Object.assign(result.idMap, expanded.idMap);
  const originalById = new Map(
    original.map((e) => [workspaceFileId(e.file), e]),
  );
  const nextById = new Map(
    result.entries.map((e) => [workspaceFileId(e.file), e]),
  );
  const changes: PreparedBatch['changes'] = [];
  const files: AuthoringEntry[] = [];
  const occupied = new Set<string>();
  for (const e of result.entries) {
    e.path = normalizeWorkspacePath(e.path);
    const suffix =
      e.file.format === 'verd-document' ? '.verd-doc.json' : '.verd.json';
    if (
      !e.path.endsWith(suffix) ||
      e.path.split('/').some((p) => p.startsWith('.'))
    )
      throw new Error('Invalid native content path: ' + e.path);
    if (occupied.has(e.path))
      throw new Error('Repeated native content path: ' + e.path);
    occupied.add(e.path);
    const id = workspaceFileId(e.file),
      before = originalById.get(id);
    if (JSON.stringify(before) !== JSON.stringify(e)) {
      files.push(e);
      changes.push({ fileId: id, beforePath: before?.path, afterPath: e.path });
    }
  }
  const removeIds = [...originalById.keys()].filter((id) => !nextById.has(id));
  removeIds.forEach((id) =>
    changes.push({ fileId: id, beforePath: originalById.get(id)!.path }),
  );
  const key = (d: import('./types').AuthoringDiagnostic) =>
    JSON.stringify([d.code, d.fileId, d.cellId, d.path, d.pointer, d.message]);
  const baseline = new Set(validateNativeWorkspace(original).map(key));
  const affected = new Set(changes.map((c) => c.fileId));
  const diagnostics = validateNativeWorkspace(result.entries).map((d) =>
    baseline.has(key(d)) && !affected.has(d.fileId ?? '')
      ? { ...d, severity: 'warning' as const }
      : d,
  );
  // Unparseable source files are retained and must not be overwritten by a new file.
  for (const d of snapshot.diagnostics)
    diagnostics.push({ ...d, severity: 'warning' });
  for (const file of files)
    if (snapshot.diagnostics.some((d) => d.path === file.path))
      throw new Error('Path occupied by an unreadable native file');
  const prepared: Omit<PreparedBatch, 'integrity'> = {
    format: 'verd-authoring-plan',
    version: 1,
    transactionId: randomUUID(),
    workspaceVersion: snapshot.version,
    resourceId: snapshot.resourceId ?? null,
    files,
    removeIds,
    idMap: result.idMap,
    changes,
    diagnostics,
  };
  return { ...prepared, integrity: planIntegrity(prepared) };
}
export function describeAuthoring() {
  const schema = createDocumentSchema();
  return {
    version: 1,
    operationSchema: authoringOperationSchema,
    contentKinds: [
      'document',
      'whiteboard',
      'mind',
      'workflow',
      'architecture',
      'uml-class',
      'uml-sequence',
    ],
    document: {
      nodes: Object.fromEntries(
        Object.entries(schema.nodes).map(([name, type]) => [
          name,
          {
            content: type.spec.content,
            group: type.spec.group,
            attrs: type.spec.attrs,
          },
        ]),
      ),
      marks: Object.fromEntries(
        Object.entries(schema.marks).map(([name, type]) => [
          name,
          { attrs: type.spec.attrs },
        ]),
      ),
    },
    cellKinds: createWorkspaceCellRegistry().kinds(),
    rules: WORKSPACE_RULES,
    patternWorkspace: fileURLToPath(patternWorkspaceUrl),
  };
}

import type { WorkspaceSessionSnapshot } from '../session/workspace-session';
import type { WorkspaceFile } from './document-files';
import { workspaceReferences } from './workspace-references';

interface CachedRevision {
  dependencies: ReadonlyMap<string, unknown>;
  token: object;
}

/**
 * File identity for precisely the bodies reachable by one preview occurrence.
 * Document embedding paths and pure canvas reference paths are separate: a
 * canvas reference can legitimately render an ancestor of a containing document.
 */
export function createPreviewRevisions() {
  const revisions = new Map<string, CachedRevision>();
  const references = new WeakMap<
    WorkspaceFile,
    ReturnType<typeof workspaceReferences>
  >();
  const targets = (file: WorkspaceFile) => {
    let result = references.get(file);
    if (!result) references.set(file, (result = workspaceReferences(file)));
    return result;
  };

  return (
    snapshot: WorkspaceSessionSnapshot,
    path: readonly string[],
    targetId: string,
    referenceSeen?: readonly string[],
  ): object => {
    const key = JSON.stringify([targetId, path, referenceSeen ?? null]);
    const dependencies = new Map<string, unknown>();
    const recordShell = (
      kind: 'document' | 'canvas',
      id: string,
      file: WorkspaceFile | undefined,
    ) => {
      const title =
        file?.format === 'verd-frame' ? file.frame.name : file?.title;
      dependencies.set(
        JSON.stringify(['shell', kind, id]),
        JSON.stringify([Boolean(file), title ?? null]),
      );
    };
    const recordBody = (id: string, file: WorkspaceFile) =>
      dependencies.set(JSON.stringify(['body', id]), file);
    const visited = new Set<string>();
    const stateKey = (
      kind: 'document' | 'canvas',
      id: string,
      documentPath: ReadonlySet<string>,
      seen?: ReadonlySet<string>,
    ) =>
      JSON.stringify([
        kind,
        id,
        [...documentPath].sort(),
        seen ? [...seen].sort() : null,
      ]);

    const visitDocument = (id: string, documentPath: ReadonlySet<string>) => {
      const file = snapshot.documents.get(id)?.file;
      if (!file || documentPath.has(id)) {
        recordShell('document', id, file);
        return;
      }
      recordBody(id, file);
      const state = stateKey('document', id, documentPath);
      if (visited.has(state)) return;
      visited.add(state);
      const nextPath = new Set([...documentPath, id]);
      for (const reference of targets(file))
        visitDocumentCanvas(reference.targetId, nextPath);
    };

    // A native canvas block in a document starts a fresh canvas traversal and
    // adds its identity to the document path before rendering contained cards.
    const visitDocumentCanvas = (
      id: string,
      documentPath: ReadonlySet<string>,
    ) => {
      const file = snapshot.files.get(id)?.file;
      if (!file || documentPath.has(id)) {
        recordShell('canvas', id, file);
        return;
      }
      visitCanvas(id, new Set([...documentPath, id]), new Set([id]));
    };

    const visitCanvas = (
      id: string,
      documentPath: ReadonlySet<string>,
      seen: ReadonlySet<string>,
    ) => {
      const file = snapshot.files.get(id)?.file;
      if (!file) {
        recordShell('canvas', id, file);
        return;
      }
      recordBody(id, file);
      const state = stateKey('canvas', id, documentPath, seen);
      if (visited.has(state)) return;
      visited.add(state);
      const nextSeen = new Set([...seen, id]);
      // A FrameFile owns one canvas and all of its domain/group cells. Inspect
      // those cells without pulling unrelated files from the assembled store.
      for (const reference of targets(file)) {
        if (reference.targetKind === 'document')
          visitDocument(reference.targetId, documentPath);
        else {
          const target = snapshot.files.get(reference.targetId)?.file;
          if (target && !nextSeen.has(reference.targetId))
            visitCanvas(
              reference.targetId,
              documentPath,
              new Set([...nextSeen, reference.targetId]),
            );
          else recordShell('canvas', reference.targetId, target);
        }
      }
    };

    const documentPath = new Set(path);
    if (snapshot.documents.has(targetId)) visitDocument(targetId, documentPath);
    else if (referenceSeen)
      // Surface revisions already have their target and ancestors in `seen`.
      // The target body itself still renders; only its outgoing cycles stop.
      visitCanvas(targetId, documentPath, new Set(referenceSeen));
    else visitDocumentCanvas(targetId, documentPath);

    const previous = revisions.get(key);
    if (
      previous &&
      previous.dependencies.size === dependencies.size &&
      [...dependencies].every(
        ([id, file]) =>
          previous.dependencies.has(id) &&
          previous.dependencies.get(id) === file,
      )
    )
      return previous.token;

    const token = {};
    revisions.set(key, { dependencies, token });
    return token;
  };
}

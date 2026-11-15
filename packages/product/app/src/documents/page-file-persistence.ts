import type { FilePersistenceState } from '@sue/verd-board-workspace';
import type { WorkspaceReferenceGraph } from '@sue/verd-board-workspace';

/** A page includes its referenced sources, but never unrelated workspace files. */
export function createPageFilePersistence(
  files: ReadonlyMap<string, FilePersistenceState> = new Map(),
  references?: WorkspaceReferenceGraph,
) {
  const cache = new Map<string, FilePersistenceState>();
  const rank = { saved: 0, saving: 1, idle: 2, error: 3 };
  return (fileId: string): FilePersistenceState => {
    const cached = cache.get(fileId);
    if (cached) return cached;
    const ids = new Set([fileId]);
    let status: FilePersistenceState['status'] = 'saved';
    let lastSavedAt: number | undefined;
    for (const id of ids) {
      const state = files.get(id);
      if (state) {
        if (rank[state.status] > rank[status]) status = state.status;
        if (state.lastSavedAt !== undefined)
          lastSavedAt = Math.max(lastSavedAt ?? 0, state.lastSavedAt);
      }
      for (const reference of references?.targetsOf.get(id) ?? [])
        if (files.has(reference.targetId)) ids.add(reference.targetId);
    }
    const result = { status, lastSavedAt };
    cache.set(fileId, result);
    return result;
  };
}

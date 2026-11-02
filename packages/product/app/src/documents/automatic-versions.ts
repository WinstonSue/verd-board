import { useEffect, useRef } from 'react';
import type {
  WorkspaceSession,
  WorkspaceSessionSnapshot,
} from '../session/workspace-session';
import { workspaceFileId, type WorkspaceFile } from './document-files';
import { saveRevision } from './workspace-resources';
/** Idle checkpoints supplement live undo; explicit versions remain available at any time. */
export function useAutomaticVersions(
  session: WorkspaceSession | null,
  snapshot: WorkspaceSessionSnapshot | null,
  readonly: boolean,
  onError: (message: string) => void,
) {
  const pending = useRef(
    new Map<string, { before: WorkspaceFile; after: WorkspaceFile }>(),
  );
  const previous = useRef(new Map<string, WorkspaceFile>());
  const report = useRef(onError);
  report.current = onError;
  const active = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useRef(async () => {});
  save.current = async () => {
    if (!session || readonly || active.current || !pending.current.size) return;
    active.current = true;
    try {
      for (const [id, change] of pending.current) {
        if (
          !session.getState().documents.has(id) &&
          !session.getState().files.has(id)
        ) {
          pending.current.delete(id);
          continue;
        }
        await saveRevision(session, change.before, '编辑前');
        if (change.before !== change.after)
          await saveRevision(session, change.after, '自动快照');
        if (pending.current.get(id) === change) pending.current.delete(id);
      }
    } catch (cause) {
      report.current('版本快照未保存：' + String(cause));
    } finally {
      active.current = false;
    }
  };
  useEffect(() => {
    pending.current.clear();
    previous.current.clear();
    const interval = setInterval(() => void save.current(), 10 * 60 * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout.current);
    };
  }, [session]);
  useEffect(() => {
    if (!session || !snapshot || readonly) return;
    const current = new Map(
      [...snapshot.files.values(), ...snapshot.documents.values()].map(
        (entry) => [workspaceFileId(entry.file), entry.file],
      ),
    );
    let changed = false;
    for (const [id, file] of current) {
      const old = previous.current.get(id);
      if (old && old !== file && JSON.stringify(old) !== JSON.stringify(file)) {
        const queued = pending.current.get(id);
        pending.current.set(id, { before: queued?.before ?? old, after: file });
        changed = true;
      }
    }
    previous.current = current;
    if (changed) {
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => void save.current(), 2 * 60 * 1000);
    }
  }, [session, snapshot, readonly]);
}

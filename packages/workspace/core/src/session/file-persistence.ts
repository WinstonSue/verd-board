import type { CellId } from '@sue/board-core';
import type { CommitRequest } from '../host/workspace-host';
import type { SaveStatus } from './save-status';
import type { WorkspaceFileEntry } from './workspace-session';

export interface FilePersistenceState {
  readonly status: SaveStatus;
  /** Last successful write confirmed in this session; absent for loaded disk files. */
  readonly lastSavedAt?: number;
}
interface Member {
  file: WorkspaceFileEntry['file'];
  write: boolean;
  op?: NonNullable<CommitRequest['writes']>[number];
}
interface Attempt {
  sequence: number;
  members: Map<CellId, Member>;
  outcome: 'pending' | 'saved' | 'error';
}

/** File feedback is independent of workspace navigation/configuration persistence. */
export function createFilePersistence(
  files: ReadonlyMap<CellId, WorkspaceFileEntry>,
  pendingWrites: () => ReadonlyMap<
    string,
    NonNullable<CommitRequest['writes']>[number]
  >,
) {
  let sequence = 0;
  const requests = new WeakMap<object, Attempt>();
  const attempts = new Set<Attempt>();
  const failures = new Map<CellId, number>();
  const saved = new Map<CellId, { sequence: number; time: number }>();
  let published: ReadonlyMap<CellId, FilePersistenceState> = new Map();
  return {
    begin(
      request: CommitRequest,
      explicit?: readonly { id: CellId; write: boolean }[],
    ) {
      let attempt = requests.get(request);
      if (!attempt) {
        const paths = new Map(
          [...files].map(([id, entry]) => [entry.path, id]),
        );
        // Entries already carry their destination when a move is queued.
        for (const move of [...(request.moves ?? [])].reverse()) {
          const id = paths.get(move.to);
          if (id) paths.set(move.from, id);
        }
        const members = new Map<CellId, Member>();
        const add = (
          id: CellId | undefined,
          write = false,
          op?: Member['op'],
        ) => {
          const entry = id ? files.get(id) : undefined;
          if (id && entry)
            members.set(id, {
              file: entry.file,
              write: write || !!members.get(id)?.write,
              op: op ?? members.get(id)?.op,
            });
        };
        for (const write of request.writes ?? [])
          add(paths.get(write.path), true, write);
        for (const move of request.moves ?? [])
          add(paths.get(move.to) ?? paths.get(move.from));
        for (const trash of request.trash ?? []) add(paths.get(trash.path));
        for (const member of explicit ?? []) add(member.id, member.write);
        attempt = { sequence: ++sequence, members, outcome: 'pending' };
        requests.set(request, attempt);
      }
      attempt.outcome = 'pending';
      attempts.add(attempt);
      return attempt;
    },
    finish(attempt: Attempt, success: boolean) {
      attempt.outcome = success ? 'saved' : 'error';
      for (const [id, member] of attempt.members) {
        if (success) {
          if ((failures.get(id) ?? -1) <= attempt.sequence) failures.delete(id);
          if (
            member.write &&
            (saved.get(id)?.sequence ?? -1) <= attempt.sequence
          )
            saved.set(id, { sequence: attempt.sequence, time: Date.now() });
        } else if ((failures.get(id) ?? -1) <= attempt.sequence)
          failures.set(id, attempt.sequence);
      }
    },
    adoptDisk(id: CellId) {
      failures.delete(id);
      saved.delete(id);
    },
    hasError(id: CellId) {
      return failures.has(id);
    },
    snapshot(): ReadonlyMap<CellId, FilePersistenceState> {
      const writes = new Set(pendingWrites().values());
      const saving = new Map<
        CellId,
        { sequence: number; file: Member['file'] }
      >();
      for (const attempt of attempts) {
        let retaining = false;
        for (const [id, member] of attempt.members) {
          const active =
            attempt.outcome === 'pending' ||
            (attempt.outcome === 'saved' && member.op && writes.has(member.op));
          if (!active) continue;
          retaining = true;
          if ((saving.get(id)?.sequence ?? -1) < attempt.sequence)
            saving.set(id, { sequence: attempt.sequence, file: member.file });
        }
        if (!retaining) attempts.delete(attempt);
      }
      const next = new Map<CellId, FilePersistenceState>();
      for (const [id, entry] of files) {
        const active = saving.get(id);
        const status: SaveStatus = entry.conflicted
          ? 'error'
          : active?.file === entry.file &&
              active.sequence >= (failures.get(id) ?? -1)
            ? 'saving'
            : failures.has(id)
              ? 'error'
              : entry.dirty
                ? 'idle'
                : 'saved';
        const lastSavedAt = saved.get(id)?.time;
        const previous = published.get(id);
        next.set(
          id,
          previous?.status === status && previous.lastSavedAt === lastSavedAt
            ? previous
            : { status, lastSavedAt },
        );
      }
      for (const id of failures.keys()) if (!files.has(id)) failures.delete(id);
      for (const id of saved.keys()) if (!files.has(id)) saved.delete(id);
      if (
        next.size !== published.size ||
        [...next].some(([id, value]) => published.get(id) !== value)
      )
        published = next;
      return published;
    },
  };
}

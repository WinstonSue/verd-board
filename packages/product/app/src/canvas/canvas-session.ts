import {
  createCellRuntime,
  isFrameReferenceCell,
  type CellId,
  type CellRegistry,
  type CellRuntime,
  type CellStore,
  type CellTransaction,
  type FrameReferenceCell,
} from '@sue/board-core';
import {
  isRegularCanvas,
  sameFrameContent,
  type FrameFileV2,
} from '../frames/frame-files';
import type {
  CommandResult,
  WorkspaceSession,
} from '../session/workspace-session';

/**
 * An occurrence is one editing context over a canvas file: a top-level file
 * view or one embedded frame-reference instance. The same file opened in a
 * tab and embedded twice yields three occurrences — each with its own
 * runtime (selection, focus path), view state (camera, tool, hover) and
 * caches, while content edits still route through the single workspace
 * session and its unified history.
 */
export type OccurrenceId = string;

export const rootOccurrenceId = (fileId: CellId): OccurrenceId =>
  `file:${fileId}`;
/**
 * Instance identity is the full appearance path, not the target file id
 * alone and not only the direct reference id.
 */
export const refOccurrenceId = (
  ownerFileId: CellId,
  refId: CellId,
  appearance: readonly CellId[] = [ownerFileId, refId],
): OccurrenceId => `ref:${appearance.join('/')}`;

/** Runtime-only view state; deliberately never persisted this round. */
export interface OccurrenceViewState {
  camera: { x: number; y: number; zoom: number } | null;
  tool: string;
  hover: CellId | null;
}

export interface OccurrenceSession {
  id: OccurrenceId;
  /** Target file identity. */
  fileId: CellId;
  /** Reference cell id when this occurrence is an embedded instance. */
  refId?: CellId;
  /** File containing `refId` when embedded. */
  ownerFileId?: CellId;
  /** Occurrence where the reference was opened (context parent). */
  parentId?: OccurrenceId;
  /** Root file id, then each reference shell on the way to this instance. */
  appearancePath: CellId[];
  /**
   * Content edits are rejected. Regular-canvas previews and anything
   * nested inside them are read-only; their shells stay editable on the
   * owner file when that owner is itself writable.
   */
  contentReadonly: boolean;
  runtime: CellRuntime;
  view: OccurrenceViewState;
  /** Namespaced per-occurrence memoization (layouts, measurements…). */
  caches: Map<string, Map<unknown, unknown>>;
  /** Target is trashed/missing; the runtime keeps the last good content. */
  missing: boolean;
  /** The file content currently inside `runtime` — sync diff basis. */
  lastFile: FrameFileV2;
}

export interface OccurrenceOpenResult {
  ok: boolean;
  occurrence?: OccurrenceSession;
  message?: string;
}

const fileStore = (file: FrameFileV2): CellStore => ({
  rootId: file.frame.id,
  cells: { [file.frame.id]: file.frame, ...file.cells },
});

const shellLocked = (file: FrameFileV2, cellId: CellId): boolean => {
  if (file.frame.locked) return true;
  const contains = (
    groupId: CellId,
    target: CellId,
    seen = new Set<CellId>(),
  ): boolean => {
    if (seen.has(groupId)) return false;
    seen.add(groupId);
    const group = file.cells[groupId];
    if (!group || group.cellType !== 'group') return false;
    if (group.members.includes(target)) return true;
    return group.members.some(
      (id) =>
        file.cells[id]?.cellType === 'group' && contains(id, target, seen),
    );
  };
  return Object.values(file.cells).some(
    (cell) =>
      cell.cellType === 'group' && cell.locked && contains(cell.id, cellId),
  );
};

const emptyView = (): OccurrenceViewState => ({
  camera: null,
  tool: 'select',
  hover: null,
});

/**
 * Owns every editing context of the workspace. One occurrence = one
 * CellRuntime over the file's own store (never the assembled workspace), so
 * coordinates, selection, focus paths and derived caches are isolated per
 * instance. Edits dispatch into the runtime for immediate feedback, then
 * rebuild the file and funnel through `WorkspaceSession.apply`, so one
 * user edit is exactly one entry in the unified workspace history.
 */
export const createCanvasSession = (options: {
  session: WorkspaceSession;
  registry?: CellRegistry;
}) => {
  const { session, registry } = options;
  const occurrences = new Map<OccurrenceId, OccurrenceSession>();
  const retainCounts = new Map<OccurrenceSession, number>();
  const listeners = new Set<() => void>();
  /** Deepest-first active editing context, root occurrence at index 0. */
  let activePath: OccurrenceId[] = [];
  let syncing = false;

  const emit = () => listeners.forEach((listener) => listener());

  const occurrenceFor = (id: OccurrenceId) => occurrences.get(id);

  const makeRuntime = (file: FrameFileV2): CellRuntime =>
    createCellRuntime({ store: fileStore(file) }, registry);

  const entryFor = (fileId: CellId) => session.getState().files.get(fileId);

  /**
   * Reconciles every live occurrence against the canonical files: changed
   * files push fresh snapshots into their runtimes (per-occurrence caches
   * are invalidated), vanished files flip occurrences to `missing` while
   * keeping last content for undo-stable placeholders, and reappearing
   * files clear the flag. Owner-file changes re-resolve reference targets.
   */
  const syncFromSession = () => {
    if (syncing) return;
    syncing = true;
    try {
      const files = session.getState().files;
      let changed = false;
      occurrences.forEach((occurrence, id) => {
        if (occurrence.ownerFileId && occurrence.refId) {
          const owner = files.get(occurrence.ownerFileId);
          const ref = owner?.file.cells[occurrence.refId];
          if (!owner || !isFrameReferenceCell(ref)) {
            // The reference itself is gone: this occurrence is orphaned.
            if (!occurrence.missing) {
              occurrence.missing = true;
              changed = true;
            }
          } else {
            occurrence.fileId = ref.data.targetFrameId;
          }
        }
        const entry = files.get(occurrence.fileId);
        if (!entry) {
          if (!occurrence.missing) {
            occurrence.missing = true;
            changed = true;
          }
          return;
        }
        if (occurrence.missing) {
          occurrence.missing = false;
          changed = true;
        }
        if (!sameFrameContent(occurrence.lastFile, entry.file)) {
          try {
            occurrence.runtime.replace({ store: fileStore(entry.file) });
            occurrence.caches.clear();
            changed = true;
          } catch {
            // An invalid incoming snapshot leaves the last good content.
            return;
          }
        }
        occurrence.lastFile = entry.file;
      });
      if (changed) emit();
    } finally {
      syncing = false;
    }
  };

  session.subscribe(syncFromSession);

  const adopt = (
    id: OccurrenceId,
    init: Pick<
      OccurrenceSession,
      | 'fileId'
      | 'refId'
      | 'ownerFileId'
      | 'parentId'
      | 'runtime'
      | 'appearancePath'
      | 'contentReadonly'
    > & { file: FrameFileV2 },
  ): OccurrenceSession => {
    const occurrence: OccurrenceSession = {
      id,
      fileId: init.fileId,
      refId: init.refId,
      ownerFileId: init.ownerFileId,
      parentId: init.parentId,
      appearancePath: init.appearancePath,
      contentReadonly: init.contentReadonly,
      runtime: init.runtime,
      caches: new Map(),
      view: emptyView(),
      missing: false,
      lastFile: init.file,
    };
    occurrences.set(id, occurrence);
    return occurrence;
  };

  const openFile = (fileId: CellId): OccurrenceOpenResult => {
    const id = rootOccurrenceId(fileId);
    const existing = occurrences.get(id);
    if (existing) {
      activate(id);
      return { ok: true, occurrence: existing };
    }
    const entry = entryFor(fileId);
    if (!entry) return { ok: false, message: `Unknown file: ${fileId}` };
    const occurrence = adopt(id, {
      fileId,
      appearancePath: [fileId],
      contentReadonly: false,
      runtime: makeRuntime(entry.file),
      file: entry.file,
    });
    activate(id);
    emit();
    return { ok: true, occurrence };
  };

  const openRef = (
    ownerFileId: CellId,
    refId: CellId,
    parentId?: OccurrenceId,
    appearance?: readonly CellId[],
    options?: { activate?: boolean },
  ): OccurrenceOpenResult => {
    const shouldActivate = options?.activate !== false;
    const parent =
      parentId && occurrences.has(parentId)
        ? parentId
        : occurrences.has(rootOccurrenceId(ownerFileId))
          ? rootOccurrenceId(ownerFileId)
          : undefined;
    const parentOccurrence = parent ? occurrences.get(parent) : undefined;
    const appearancePath = appearance?.length
      ? [...appearance]
      : parentOccurrence
        ? [...parentOccurrence.appearancePath, refId]
        : [ownerFileId, refId];
    const id = refOccurrenceId(ownerFileId, refId, appearancePath);
    const existing = occurrences.get(id);
    if (existing) {
      if (shouldActivate) activate(id);
      return { ok: true, occurrence: existing };
    }
    const owner = entryFor(ownerFileId);
    const ref = owner?.file.cells[refId];
    if (!owner)
      return { ok: false, message: `Unknown owner file: ${ownerFileId}` };
    if (!isFrameReferenceCell(ref))
      return { ok: false, message: `Not a frame reference: ${refId}` };
    const fileId = ref.data.targetFrameId;
    const entry = entryFor(fileId);
    if (!entry) return { ok: false, message: `Missing target file: ${fileId}` };
    const occurrence = adopt(id, {
      fileId,
      refId,
      ownerFileId,
      parentId: parent,
      appearancePath,
      contentReadonly:
        isRegularCanvas(entry.file) || !!parentOccurrence?.contentReadonly,
      runtime: makeRuntime(entry.file),
      file: entry.file,
    });
    if (shouldActivate) activate(id);
    emit();
    return { ok: true, occurrence };
  };

  /** Root-first path from the occurrence to its context ancestors. */
  const pathTo = (id: OccurrenceId): OccurrenceId[] => {
    const chain: OccurrenceId[] = [];
    let cursor: OccurrenceId | undefined = id;
    const seen = new Set<OccurrenceId>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      chain.unshift(cursor);
      cursor = occurrences.get(cursor)?.parentId;
    }
    return chain;
  };

  function activate(id: OccurrenceId) {
    if (!occurrences.has(id)) return;
    const next = pathTo(id);
    if (
      activePath.length === next.length &&
      activePath.every((entry, at) => entry === next[at])
    )
      return;
    activePath = next;
    emit();
  }

  const close = (id: OccurrenceId) => {
    const doomed = new Set<OccurrenceId>([id]);
    // Embedded descendants lose their context when the parent closes.
    let grew = true;
    while (grew) {
      grew = false;
      occurrences.forEach((occurrence, occurrenceId) => {
        if (
          !doomed.has(occurrenceId) &&
          occurrence.parentId &&
          doomed.has(occurrence.parentId)
        ) {
          doomed.add(occurrenceId);
          grew = true;
        }
      });
    }
    doomed.forEach((occurrenceId) => {
      const occurrence = occurrences.get(occurrenceId);
      if (occurrence) retainCounts.delete(occurrence);
      occurrences.delete(occurrenceId);
    });
    activePath = activePath.filter((entry) => !doomed.has(entry));
    emit();
  };

  /** Share one occurrence across mounted presentations until the last leaves. */
  const retainOccurrence = (id: OccurrenceId): (() => void) => {
    const occurrence = occurrences.get(id);
    if (!occurrence) return () => {};
    retainCounts.set(occurrence, (retainCounts.get(occurrence) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // A force close may have replaced this id with a new editing context.
      if (occurrences.get(id) !== occurrence) return;
      const count = retainCounts.get(occurrence);
      if (count === undefined) return;
      if (count > 1) retainCounts.set(occurrence, count - 1);
      else close(id);
    };
  };

  const dispatch = async (
    id: OccurrenceId,
    transaction: Omit<CellTransaction, 'history'>,
  ): Promise<CommandResult> => {
    const occurrence = occurrences.get(id);
    if (!occurrence || occurrence.missing)
      return {
        ok: false,
        diagnostics: [{ message: `Occurrence unavailable: ${id}` }],
      };
    if (occurrence.contentReadonly)
      return {
        ok: false,
        diagnostics: [{ message: 'Instance is read-only' }],
      };
    if (occurrence.ownerFileId && occurrence.refId) {
      const owner = entryFor(occurrence.ownerFileId);
      const ref = owner?.file.cells[occurrence.refId];
      if (
        owner &&
        ref &&
        (ref.locked || shellLocked(owner.file, occurrence.refId))
      )
        return {
          ok: false,
          diagnostics: [{ message: 'Reference shell is locked' }],
        };
    }
    const before = JSON.parse(
      JSON.stringify(occurrence.runtime.store),
    ) as CellStore;
    try {
      occurrence.runtime.transact({ ...transaction, history: false });
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
    const entry = entryFor(occurrence.fileId);
    if (!entry) {
      occurrence.runtime.replace({ store: before });
      return {
        ok: false,
        diagnostics: [{ message: `File vanished: ${occurrence.fileId}` }],
      };
    }
    const result = await session.apply({
      type: 'edit-file',
      sourceFileId: occurrence.fileId,
      store: occurrence.runtime.store,
      creationOwnerId: isRegularCanvas(entry.file)
        ? occurrence.fileId
        : undefined,
      label: transaction.id,
    });
    if (!result.ok) {
      occurrence.runtime.replace({ store: before });
      return result;
    }
    const canonical = entryFor(occurrence.fileId)?.file;
    if (canonical) occurrence.lastFile = canonical;
    return result;
  };

  /**
   * Per-occurrence shell state (mind offsets, position, size, appearance)
   * belongs to the reference cell in the OWNER file — embedded edits never
   * leak into the shared target file.
   */
  const updateRefShell = async (
    id: OccurrenceId,
    patch: Partial<
      Pick<
        FrameReferenceCell,
        'name' | 'geometry' | 'appearance' | 'hidden' | 'locked' | 'aspectRatio'
      >
    > & { data?: Partial<FrameReferenceCell['data']> },
  ): Promise<CommandResult> => {
    const occurrence = occurrences.get(id);
    const failure = (message: string): CommandResult => ({
      ok: false,
      diagnostics: [{ message }],
    });
    if (!occurrence || !occurrence.ownerFileId || !occurrence.refId)
      return failure(`Not an embedded occurrence: ${id}`);
    const parent = occurrence.parentId
      ? occurrences.get(occurrence.parentId)
      : undefined;
    if (parent?.contentReadonly) return failure('Preview is read-only');
    const owner = entryFor(occurrence.ownerFileId);
    const ref = owner?.file.cells[occurrence.refId];
    if (!owner || !isFrameReferenceCell(ref))
      return failure(`Reference gone: ${occurrence.refId}`);
    if (ref.locked || shellLocked(owner.file, ref.id))
      return failure('Reference shell is locked');
    const { data, ...shell } = patch;
    const next: FrameFileV2 = {
      ...owner.file,
      cells: {
        ...owner.file.cells,
        [ref.id]: {
          ...ref,
          ...shell,
          data: { ...ref.data, ...(data ?? {}) },
        },
      },
    };
    return session.apply({ type: 'file', file: next });
  };

  const setView = (id: OccurrenceId, patch: Partial<OccurrenceViewState>) => {
    const occurrence = occurrences.get(id);
    if (!occurrence) return;
    Object.assign(occurrence.view, patch);
    emit();
  };

  /** Per-occurrence, per-namespace cache — cleared whenever content syncs. */
  const cacheFor = (
    id: OccurrenceId,
    namespace: string,
  ): Map<unknown, unknown> => {
    const occurrence = occurrences.get(id);
    if (!occurrence) return new Map();
    let cache = occurrence.caches.get(namespace);
    if (!cache) {
      cache = new Map();
      occurrence.caches.set(namespace, cache);
    }
    return cache;
  };

  const undo = async () => {
    const result = await session.undo();
    if (result.ok) syncFromSession();
    return result;
  };

  const redo = async () => {
    const result = await session.redo();
    if (result.ok) syncFromSession();
    return result;
  };

  /** Snapshot of the assembled workspace store for tree-level callers. */
  const assembledStore = () => session.getState().store;

  return {
    openFile,
    openRef,
    retainOccurrence,
    close,
    get: occurrenceFor,
    occurrences: () => [...occurrences.values()],
    activate,
    deactivate(id: OccurrenceId) {
      const occurrence = occurrences.get(id);
      if (!occurrence) return;
      activePath = occurrence.parentId ? pathTo(occurrence.parentId) : [];
      emit();
    },
    activePath: () => [...activePath],
    active: () =>
      activePath.length
        ? occurrences.get(activePath[activePath.length - 1])
        : undefined,
    dispatch,
    updateRefShell,
    setView,
    cacheFor,
    undo,
    redo,
    assembledStore,
    syncFromSession,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      retainCounts.clear();
      occurrences.clear();
      activePath = [];
      listeners.clear();
    },
  };
};

export type CanvasSession = ReturnType<typeof createCanvasSession>;

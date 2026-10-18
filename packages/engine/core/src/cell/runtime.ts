import {
  applyCellOperations,
  commitCellOperations,
  emptyCellHistory,
  emptySelection,
  indexCells,
  undoCells,
  redoCells,
  type CellOperation,
  type CellRegistry,
  type CellSelection,
} from './index';
import { createCellRegistry } from './index';
import {
  FrameUtil,
  FrameReferenceUtil,
  DocumentReferenceUtil,
  DocumentFrameUtil,
  GroupUtil,
} from './util';
import {
  isFrameCell,
  isFrameReferenceCell,
  stripFrameViewports,
  type Cell,
  type CellId,
  type CellStore,
  type FrameSnapshot,
} from './types';
import { validateCellStore } from './validation';

/**
 * Frames and groups own a focus step directly; a frame-reference mounts its
 * target frame's content at the occurrence, so children resolve through the
 * target instead.
 */
const focusStepCell = (cell: Cell | undefined) =>
  !!cell &&
  (cell.cellType === 'frame' ||
    cell.cellType === 'group' ||
    isFrameReferenceCell(cell));

/** The frame/group id that owns the next focus step or selected ids. */
const focusOwnerId = (store: CellStore, id: CellId) => {
  const cell = store.cells[id];
  return cell && isFrameReferenceCell(cell) ? cell.data.targetFrameId : id;
};

/** Ids selectable at a focus step — for references, the target's children. */
const focusMembers = (store: CellStore, id: CellId): CellId[] => {
  const cell = store.cells[id];
  if (!cell) return [];
  if (cell.cellType === 'group') return cell.members;
  if (isFrameReferenceCell(cell)) {
    const target = store.cells[cell.data.targetFrameId];
    if (isFrameCell(target)) return [...target.children, ...target.groups];
    return [];
  }
  if (isFrameCell(cell)) return [...cell.children, ...cell.groups];
  return [];
};

export interface CellTransaction {
  id: string;
  operations: readonly CellOperation[];
  history?: boolean;
  /** When set, undo and redo restore the frame theme captured by this transaction. */
  restoreView?: boolean;
}
export interface CellChange {
  snapshot: FrameSnapshot;
  transaction: CellTransaction;
}
export const createCellRuntime = (
  snapshot: FrameSnapshot,
  registry: CellRegistry = createCellRegistry(),
) => {
  if (!registry.get('frame')) registry.register(new FrameUtil());
  if (!registry.get('frame-reference'))
    registry.register(new FrameReferenceUtil());
  if (!registry.get('document-reference'))
    registry.register(new DocumentReferenceUtil());
  if (!registry.get('document-frame'))
    registry.register(new DocumentFrameUtil());
  if (!registry.get('group')) registry.register(new GroupUtil());
  const issues = validateCellStore(snapshot.store, registry);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '));
  let store: CellStore = stripFrameViewports(snapshot.store);
  let indexedStore = store;
  let cachedIndex = indexCells(store);
  let history = emptyCellHistory();
  let selection: CellSelection = emptySelection(store.rootId);
  let revision = 0;
  let mountedRootId = store.rootId;
  const reconcileSelection = () => {
    if (store.cells[mountedRootId]?.cellType !== 'frame')
      mountedRootId = store.rootId;
    const index = indexCells(store);
    const focus = [mountedRootId];
    if (selection.focus[0] === mountedRootId) {
      for (const id of selection.focus.slice(1)) {
        const cell = store.cells[id];
        const ownerId = focus.at(-1)!;
        if (
          !cell ||
          (store.cells[ownerId]?.cellType === 'group'
            ? index.groupOf.get(id)
            : index.parentOf.get(id)) !== focusOwnerId(store, ownerId) ||
          !focusStepCell(cell)
        )
          break;
        focus.push(id);
      }
    }
    const allowed = focusMembers(store, focus.at(-1)!);
    const ids = selection.ids.filter((id) => allowed.includes(id));
    if (
      focus.length !== selection.focus.length ||
      focus.some((id, at) => id !== selection.focus[at]) ||
      ids.length !== selection.ids.length ||
      ids.some((id, at) => id !== selection.ids[at])
    )
      selection = { focus, ids };
  };
  const restoreEditState = (nextStore: CellStore): CellStore => ({
    ...nextStore,
    cells: Object.fromEntries(
      Object.entries(nextStore.cells).map(([id, cell]) => {
        const current = store.cells[id];
        return [
          id,
          isFrameCell(cell) && isFrameCell(current)
            ? { ...cell, view: current.view }
            : cell,
        ];
      }),
    ),
  });
  const listeners = new Set<() => void>();
  const notify = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  return {
    registry,
    get store() {
      return store;
    },
    get snapshot(): FrameSnapshot {
      return { store };
    },
    get index() {
      if (indexedStore !== store) {
        indexedStore = store;
        cachedIndex = indexCells(store);
      }
      return cachedIndex;
    },
    get selection() {
      return selection;
    },
    get history() {
      return history;
    },
    get revision() {
      return revision;
    },
    get mountedRootId() {
      return mountedRootId;
    },
    mount(frameId: string) {
      if (store.cells[frameId]?.cellType !== 'frame')
        throw new Error('Mounted root must be a frame');
      mountedRootId = frameId;
      selection = emptySelection(frameId);
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    transact(transaction: CellTransaction): CellChange {
      const committed =
        transaction.history === false
          ? {
              store: applyCellOperations(
                store,
                transaction.operations,
                registry,
              ),
              history,
            }
          : commitCellOperations(
              store,
              history,
              transaction.operations,
              registry,
              { restoreView: transaction.restoreView },
            );
      store = committed.store;
      history = committed.history;
      reconcileSelection();
      notify();
      return { snapshot: { store }, transaction };
    },
    replace(next: FrameSnapshot) {
      const errors = validateCellStore(next.store, registry);
      if (errors.length)
        throw new Error(errors.map((error) => error.message).join('; '));
      store = stripFrameViewports(next.store);
      if (!store.cells[mountedRootId]) mountedRootId = store.rootId;
      history = emptyCellHistory();
      reconcileSelection();
      notify();
    },
    select(next: CellSelection) {
      const index = indexCells(store);
      if (!next.focus.length || next.focus[0] !== mountedRootId)
        throw new Error('Selection must start at mounted root');
      next.focus.forEach((id, at) => {
        const cell = store.cells[id];
        if (
          !cell ||
          !focusStepCell(cell) ||
          (at > 0 &&
            (store.cells[next.focus[at - 1]]?.cellType === 'group'
              ? index.groupOf.get(id)
              : index.parentOf.get(id)) !==
              focusOwnerId(store, next.focus[at - 1]))
        )
          throw new Error('Invalid focus path');
      });
      const allowed = focusMembers(store, next.focus.at(-1)!);
      if (next.ids.some((id) => !allowed.includes(id)))
        throw new Error('Selection crosses focus boundary');
      const ids = [...new Set(next.ids)];
      if (
        next.focus.length === selection.focus.length &&
        next.focus.every((id, at) => id === selection.focus[at]) &&
        ids.length === selection.ids.length &&
        ids.every((id, at) => id === selection.ids[at])
      )
        return;
      selection = { focus: [...next.focus], ids };
      notify();
    },
    undo() {
      const entry = history.undos.at(-1);
      const next = undoCells(store, history);
      store = entry?.restoreView ? next.store : restoreEditState(next.store);
      history = next.history;
      reconcileSelection();
      notify();
      return { store };
    },
    redo() {
      const entry = history.redos.at(-1);
      const next = redoCells(store, history);
      store = entry?.restoreView ? next.store : restoreEditState(next.store);
      history = next.history;
      reconcileSelection();
      notify();
      return { store };
    },
  };
};
export type CellRuntime = ReturnType<typeof createCellRuntime>;

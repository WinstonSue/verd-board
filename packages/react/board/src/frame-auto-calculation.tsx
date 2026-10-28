import {
  applyCellOperations,
  arrangementEdgeIds,
  collectArrangementBlocks,
  focusedCellIds,
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  optimizeEdges,
  planCellLayout,
  resolveCellArrangementScope,
  type CellArrangementScope,
  type CellLayoutStyle,
  type CellOperation,
  type CellRegistry,
  type CellSelection,
  type CellStore,
} from '@sue/board-core';
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export interface FrameAutoCalculationConfig {
  layout?: { scope: CellArrangementScope; style: CellLayoutStyle };
  edges?: { scope: CellArrangementScope };
}
const empty: FrameAutoCalculationConfig = Object.freeze({});

/** Mutable session owner, independent of render/layout caches and document history. */
export function createFrameAutoCalculationSession(
  resolveFileId: (frameId: string) => string = (id) => id,
) {
  const values = new Map<string, FrameAutoCalculationConfig>();
  const listeners = new Set<() => void>();
  const key = (frameId: string) =>
    JSON.stringify([resolveFileId(frameId), frameId]);
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get: (frameId: string) => values.get(key(frameId)) ?? empty,
    set(frameId: string, config: FrameAutoCalculationConfig) {
      values.set(key(frameId), config);
      notify();
    },
    clearFile(fileId: string) {
      let changed = false;
      for (const entry of values.keys())
        if (JSON.parse(entry)[0] === fileId) {
          values.delete(entry);
          changed = true;
        }
      if (changed) notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type FrameAutoCalculationSession = ReturnType<
  typeof createFrameAutoCalculationSession
>;
const SessionContext = createContext<FrameAutoCalculationSession | null>(null);
export function FrameAutoCalculationProvider({
  session,
  children,
}: {
  session: FrameAutoCalculationSession;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
export function useFrameAutoCalculation(
  frameId: string,
  controlled?: FrameAutoCalculationConfig,
  onChange?: (config: FrameAutoCalculationConfig) => void,
) {
  const inherited = useContext(SessionContext);
  const local = useMemo(() => createFrameAutoCalculationSession(), []);
  const session = inherited ?? local;
  const value = useSyncExternalStore(
    session.subscribe,
    () => session.get(frameId),
    () => empty,
  );
  return [
    controlled ?? value,
    (config: FrameAutoCalculationConfig) => {
      if (controlled === undefined) session.set(frameId, config);
      onChange?.(config);
    },
  ] as const;
}
export function captureAutoCalculationScope(
  store: CellStore,
  selection: CellSelection,
) {
  const scope = resolveCellArrangementScope(store, selection);
  return { ...scope, ids: [...scope.ids] };
}
export function autoCalculationSelection(
  store: CellStore,
  scope: CellArrangementScope,
): CellSelection | null {
  const container = store.cells[scope.containerId];
  if (!isFrameCell(container) && !isGroupCell(container)) return null;
  const focus =
    scope.frameId === scope.containerId
      ? [scope.frameId]
      : [scope.frameId, scope.containerId];
  if (scope.kind !== 'selection') return { focus, ids: [] };
  const available = new Set(focusedCellIds(store, scope.containerId));
  const ids = scope.ids.filter((id) => available.has(id));
  // An emptied selection must never expand to the container.
  return ids.length ? { focus, ids } : null;
}
function layoutSignature(
  store: CellStore,
  scope: CellArrangementScope,
  registry: CellRegistry,
) {
  const selection = autoCalculationSelection(store, scope);
  if (!selection) return '';
  const current = resolveCellArrangementScope(store, selection);
  return JSON.stringify([
    collectArrangementBlocks(store, current.frameId, current.ids, registry)
      .map((b) => [b.id, b.locked, b.bounds.width, b.bounds.height])
      .sort(),
    arrangementEdgeIds(store, selection).map((id) => {
      const e = store.cells[id];
      return isEdgeCell(e)
        ? [
            id,
            'cellId' in e.source ? e.source.cellId : null,
            'cellId' in e.target ? e.target.cellId : null,
          ]
        : id;
    }),
  ]);
}
function routingSignature(store: CellStore, frameId: string) {
  const frame = store.cells[frameId];
  return JSON.stringify(
    isFrameCell(frame)
      ? [...frame.children].sort().map((id) => {
          const cell = store.cells[id];
          if (isNodeCell(cell))
            return [
              id,
              cell.geometry,
              cell.ports,
              cell.hidden,
              cell.locked,
              cell.kind,
            ];
          if (isEdgeCell(cell))
            return [
              id,
              cell.source,
              cell.target,
              cell.appearance?.strokeWidth,
              cell.hidden,
              cell.locked,
              cell.kind,
            ];
          return isGroupCell(cell)
            ? [id, cell.members, cell.hidden, cell.locked]
            : id;
        })
      : null,
  );
}
/** Pure preparation: user edit, node layout, then routes become one atomic write. */
export function prepareAutoCalculation(
  before: CellStore,
  operations: readonly CellOperation[],
  config: FrameAutoCalculationConfig,
  registry: CellRegistry,
  skip: { layout?: boolean; edges?: boolean } = {},
): { operations: CellOperation[]; expected: CellStore } {
  let expected = applyCellOperations(before, operations, registry);
  const result = [...operations];
  const append = (extra: CellOperation[]) => {
    if (!extra.length) return;
    result.push(...extra);
    expected = applyCellOperations(expected, extra, registry);
  };
  if (config.layout && !skip.layout) {
    // Pure position/rotation edits never invoke automatic node layout, including groups.
    const structural = [
      ...new Set([
        ...Object.keys(before.cells),
        ...Object.keys(expected.cells),
      ]),
    ].some((id) => {
      const a = before.cells[id],
        b = expected.cells[id];
      if (a === b) return false;
      if (!a || !b) return true;
      if (isNodeCell(a) && isNodeCell(b))
        return (
          a.geometry.width !== b.geometry.width ||
          a.geometry.height !== b.geometry.height
        );
      if (isEdgeCell(a) && isEdgeCell(b))
        return (
          JSON.stringify([
            'cellId' in a.source ? a.source.cellId : null,
            'cellId' in a.target ? a.target.cellId : null,
          ]) !==
          JSON.stringify([
            'cellId' in b.source ? b.source.cellId : null,
            'cellId' in b.target ? b.target.cellId : null,
          ])
        );
      return (
        isGroupCell(a) &&
        isGroupCell(b) &&
        JSON.stringify(a.members) !== JSON.stringify(b.members)
      );
    });
    const { scope, style } = config.layout;
    const selection = autoCalculationSelection(expected, scope);
    if (
      structural &&
      selection &&
      !(
        scope.kind === 'selection' &&
        selection.ids.length === 1 &&
        isGroupCell(expected.cells[selection.ids[0]])
      ) &&
      layoutSignature(before, scope, registry) !==
        layoutSignature(expected, scope, registry)
    )
      append(planCellLayout(expected, selection, style, registry));
  }
  if (config.edges && !skip.edges) {
    const { scope } = config.edges;
    const selection = autoCalculationSelection(expected, scope);
    if (
      selection &&
      routingSignature(before, scope.frameId) !==
        routingSignature(expected, scope.frameId)
    )
      append(
        optimizeEdges(
          expected,
          arrangementEdgeIds(expected, selection),
          registry,
        ),
      );
  }
  return { operations: result, expected };
}

/** Remove deleted scope identities only after the initiating edit is accepted. */
export function pruneAutoCalculationConfig(
  store: CellStore,
  config: FrameAutoCalculationConfig,
): FrameAutoCalculationConfig {
  let next = config;
  for (const kind of ['layout', 'edges'] as const) {
    const setting = config[kind];
    if (!setting) continue;
    const { scope } = setting;
    const container = store.cells[scope.containerId];
    if (!isFrameCell(container) && !isGroupCell(container)) {
      if (next === config) next = { ...config };
      delete next[kind];
    } else if (scope.kind === 'selection') {
      const ids = scope.ids.filter((id) => !!store.cells[id]);
      if (ids.length !== scope.ids.length) {
        if (next === config) next = { ...config };
        const updated = { ...setting, scope: { ...scope, ids } };
        if (kind === 'layout')
          next.layout = updated as NonNullable<
            FrameAutoCalculationConfig['layout']
          >;
        else next.edges = updated;
      }
    }
  }
  return next;
}

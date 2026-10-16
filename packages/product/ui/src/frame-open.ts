import {
  stripFrameViewports,
  applyCellOperations,
  copyCellFragment,
  deleteCells,
  isFrameCell,
  planCellPaste,
  validateCellStore,
  type CellOperation,
  type CellRegistry,
  type CellStore,
  type FrameSnapshot,
} from '@sue/board-core';

export const isFrameSnapshot = (value: unknown): value is FrameSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const store = (value as FrameSnapshot).store;
  return (
    !!store &&
    typeof store.rootId === 'string' &&
    !!store.cells?.[store.rootId] &&
    isFrameCell(store.cells[store.rootId])
  );
};

/** Replace one frame's content and theme while keeping its identity. */
export function openFrameOperations(
  store: CellStore,
  frameId: string,
  incoming: FrameSnapshot,
  allocateId: (previous: string) => string,
  registry?: CellRegistry,
): CellOperation[] {
  incoming = { store: stripFrameViewports(incoming.store) };
  const root = incoming.store.cells[incoming.store.rootId];
  if (!isFrameSnapshot(incoming) || !isFrameCell(root))
    throw new Error('Invalid file');
  const issues = validateCellStore(incoming.store, registry);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '));
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing frame');
  const fragment = copyCellFragment(incoming.store, [
    ...root.children,
    ...root.groups,
  ]);
  const cleared = deleteCells(
    store,
    [...frame.groups, ...frame.children],
    // Opening a file replaces the frame, including objects the user had locked.
    { ignoreLock: true },
  );
  const pasted = planCellPaste({
    store,
    frameId,
    selectionIds: [],
    fragment,
    allocateId,
    offset: [0, 0],
    registry,
    intent: 'open',
  }).operations;
  const draft = applyCellOperations(store, [...cleared, ...pasted], registry);
  const next = draft.cells[frameId];
  if (!isFrameCell(next)) throw new Error('Missing frame');
  return [
    ...cleared,
    ...pasted,
    {
      type: 'replace_cell',
      cell: { ...next, view: root.view ?? next.view },
    },
  ];
}

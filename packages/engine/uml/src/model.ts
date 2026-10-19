import {
  createFrameCell,
  isFrameCell,
  isNodeCell,
  umlRoot,
  umlEvents,
  type Cell,
  type CellStore,
  type CellOperation,
  type NodeCell,
  type EdgeCell,
  type FrameSnapshot,
  type UmlClassData,
  type UmlClassifier,
  type UmlRelation,
  type UmlRelationData,
  type UmlSequenceData,
  type UmlParticipantData,
  type UmlMessageData,
  type UmlEvent,
  type UmlFragmentData,
  type UmlNoteData,
} from '@sue/board-core';
export const umlPorts = () =>
  (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    id: side,
    side,
    direction: 'both' as const,
  }));
const node = <T>(
  id: string,
  kind: string,
  label: string,
  data: T,
): NodeCell<T> => ({
  id,
  kind,
  cellType: 'node',
  geometry: { x: 60, y: 80, width: 200, height: 100, outline: 'rectangle' },
  content: { label },
  data,
});
export function createUmlClassCell(
  id: string,
  classifier: UmlClassifier = 'class',
): NodeCell<UmlClassData> {
  return {
    ...node(
      id,
      'uml-class',
      classifier === 'interface'
        ? 'Interface'
        : classifier === 'enum'
          ? 'Enum'
          : 'Class',
      { classifier, attributes: [], methods: [] },
    ),
    ports: umlPorts(),
  };
}
export function createUmlParticipantCell(
  id: string,
  actorType: 'participant' | 'actor' = 'participant',
): NodeCell<UmlParticipantData> {
  return node(
    id,
    'uml-participant',
    actorType === 'actor' ? 'Actor' : 'Participant',
    { actorType },
  );
}
export function createUmlFrameSnapshot(
  frameId: string,
  rootId: string,
  type: 'class' | 'sequence',
): FrameSnapshot {
  const frame = createFrameCell(frameId);
  const root = node(
    rootId,
    `uml-${type}-root`,
    '',
    type === 'sequence' ? { participantIds: [], events: [] } : {},
  );
  root.hidden = true;
  root.geometry = { x: 0, y: 0, width: 0, height: 0 };
  frame.children = [rootId];
  return {
    store: { rootId: frameId, cells: { [frameId]: frame, [rootId]: root } },
  };
}
export const createUmlClassFrameSnapshot = (frameId: string, rootId: string) =>
  createUmlFrameSnapshot(frameId, rootId, 'class');
export const createUmlSequenceFrameSnapshot = (
  frameId: string,
  rootId: string,
) => createUmlFrameSnapshot(frameId, rootId, 'sequence');
export function createUmlRelationCell(
  id: string,
  sourceId: string,
  targetId: string,
  relation: UmlRelation = 'association',
): EdgeCell<UmlRelationData> {
  return {
    id,
    kind: 'uml-relation',
    cellType: 'edge',
    source: { cellId: sourceId },
    target: { cellId: targetId },
    route: { mode: 'orthogonal' },
    labels: [],
    data: { relation, ...umlRelationMarkers(relation) },
  };
}
export function umlRelationMarkers(relation: UmlRelation) {
  return {
    sourceMarker:
      relation === 'aggregation' || relation === 'composition'
        ? relation
        : 'none',
    targetMarker:
      relation === 'generalization' || relation === 'realization'
        ? 'hollow-triangle'
        : relation === 'dependency'
          ? 'arrow'
          : 'none',
  };
}
export function createUmlMessageCell(
  id: string,
  sourceId: string,
  targetId: string,
  messageKind: UmlMessageData['messageKind'] = 'sync',
): EdgeCell<UmlMessageData> {
  return {
    id,
    kind: 'uml-message',
    cellType: 'edge',
    source: { cellId: sourceId },
    target: { cellId: targetId },
    route: { mode: 'straight' },
    labels: [{ text: 'message()' }],
    data: {
      messageKind,
      targetMarker: messageKind === 'sync' ? 'solid-triangle' : 'arrow',
      sourceMarker: 'none',
    },
  };
}
export function createUmlNoteCell(
  id: string,
  participantIds: string[],
): NodeCell<UmlNoteData> {
  return node(id, 'uml-note', 'Note', { participantIds, position: 'over' });
}
export function createUmlFragmentCell(
  id: string,
  operator: UmlFragmentData['operator'],
): NodeCell<UmlFragmentData> {
  return node(id, 'uml-fragment', operator, {
    operator,
    operands: [
      { id: `${id}:branch:0`, guard: 'condition', events: [] },
      ...(operator === 'alt'
        ? [{ id: `${id}:branch:1`, guard: 'else', events: [] }]
        : []),
    ],
  });
}
export function addUmlCell(
  store: CellStore,
  frameId: string,
  cell: Cell,
  operandId?: string,
  at?: number,
): CellOperation[] {
  const root = umlRoot(store, frameId);
  if (!root) throw new Error('Missing UML root');
  const operations: CellOperation[] = [
    { type: 'insert_cell', parentId: frameId, cell },
  ];
  if (root.kind === 'uml-sequence-root') {
    if (cell.kind === 'uml-participant')
      operations.push({
        type: 'replace_cell',
        cell: {
          ...root,
          data: {
            ...(root.data as UmlSequenceData),
            participantIds: [
              ...(root.data as UmlSequenceData).participantIds,
              cell.id,
            ],
          },
        },
      });
    else {
      const event: UmlEvent = { type: 'cell', cellId: cell.id };
      operations.push(...insertUmlEvent(store, frameId, event, operandId, at));
    }
  }
  return operations;
}
export function insertUmlEvent(
  store: CellStore,
  frameId: string,
  event: UmlEvent,
  operandId?: string,
  at?: number,
): CellOperation[] {
  const root = umlRoot(store, frameId);
  if (!root || root.kind !== 'uml-sequence-root')
    throw new Error('Missing sequence root');
  const insert = (events: UmlEvent[]) => {
    const next = [...events];
    next.splice(at ?? next.length, 0, event);
    return next;
  };
  if (operandId) {
    const fragment = Object.values(store.cells).find(
      (cell) =>
        cell.kind === 'uml-fragment' &&
        (cell as NodeCell<UmlFragmentData>).data!.operands.some(
          (operand) => operand.id === operandId,
        ),
    ) as NodeCell<UmlFragmentData> | undefined;
    if (!fragment) throw new Error('Missing fragment branch');
    return [
      {
        type: 'replace_cell',
        cell: {
          ...fragment,
          data: {
            ...fragment.data!,
            operands: fragment.data!.operands.map((operand) =>
              operand.id === operandId
                ? { ...operand, events: insert(operand.events) }
                : operand,
            ),
          },
        },
      },
    ];
  }
  return [
    {
      type: 'replace_cell',
      cell: {
        ...root,
        data: {
          ...(root.data as UmlSequenceData),
          events: insert((root.data as UmlSequenceData).events),
        },
      },
    },
  ];
}
export function moveUmlEvent(
  store: CellStore,
  frameId: string,
  cellId: string,
  operandId?: string,
  at?: number,
): CellOperation[] {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return [];
  const cells = { ...store.cells };
  const operations: CellOperation[] = [];
  for (const id of frame.children) {
    const cell = cells[id];
    if (!cell) continue;
    if (cell.kind === 'uml-sequence-root') {
      const value = cell as NodeCell<UmlSequenceData>;
      cells[id] = {
        ...value,
        data: {
          ...value.data!,
          events: value.data!.events.filter(
            (event) => event.type !== 'cell' || event.cellId !== cellId,
          ),
        },
      };
    }
    if (cell.kind === 'uml-fragment') {
      const value = cell as NodeCell<UmlFragmentData>;
      cells[id] = {
        ...value,
        data: {
          ...value.data!,
          operands: value.data!.operands.map((operand) => ({
            ...operand,
            events: operand.events.filter(
              (event) => event.type !== 'cell' || event.cellId !== cellId,
            ),
          })),
        },
      };
    }
    if (cells[id] !== cell)
      operations.push({ type: 'replace_cell', cell: cells[id] });
  }
  const inserts = insertUmlEvent(
    { ...store, cells },
    frameId,
    { type: 'cell', cellId },
    operandId,
    at,
  );
  return [...operations, ...inserts];
}
export function reorderUmlParticipant(
  store: CellStore,
  frameId: string,
  participantId: string,
  at: number,
): CellOperation[] {
  const root = umlRoot(store, frameId) as NodeCell<UmlSequenceData> | undefined;
  if (!root) return [];
  const ids = root.data!.participantIds.filter((id) => id !== participantId);
  ids.splice(Math.max(0, Math.min(at, ids.length)), 0, participantId);
  return [
    {
      type: 'replace_cell',
      cell: { ...root, data: { ...root.data!, participantIds: ids } },
    },
  ];
}
export function addUmlActivation(
  store: CellStore,
  frameId: string,
  participantId: string,
  start: number,
  end: number,
  allocate: () => string,
  operandId?: string,
): CellOperation[] {
  const root = umlRoot(store, frameId) as NodeCell<UmlSequenceData> | undefined;
  if (!root) return [];
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return [];
  const owner = operandId
    ? (frame.children
        .map((id) => store.cells[id])
        .find(
          (cell) =>
            cell.kind === 'uml-fragment' &&
            (cell as NodeCell<UmlFragmentData>).data!.operands.some(
              (operand) => operand.id === operandId,
            ),
        ) as NodeCell<UmlFragmentData> | undefined)
    : root;
  if (!owner) throw new Error('Missing activation branch');
  const source = operandId
    ? (owner.data as UmlFragmentData).operands.find(
        (operand) => operand.id === operandId,
      )!.events
    : (owner.data as UmlSequenceData).events;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length
  )
    throw new Error('Invalid activation interval');
  const events = [...source];
  events.splice(end, 0, { type: 'deactivate', id: allocate(), participantId });
  events.splice(start, 0, { type: 'activate', id: allocate(), participantId });
  const data = operandId
    ? {
        ...(owner.data as UmlFragmentData),
        operands: (owner.data as UmlFragmentData).operands.map((operand) =>
          operand.id === operandId ? { ...operand, events } : operand,
        ),
      }
    : { ...(owner.data as UmlSequenceData), events };
  return [{ type: 'replace_cell', cell: { ...owner, data } }];
}
export function sequenceEventLocations(store: CellStore, frameId: string) {
  const root = umlRoot(store, frameId);
  const result: { cellId: string; operandId?: string; at: number }[] = [];
  const walk = (events: UmlEvent[], operandId?: string) =>
    events.forEach((event, at) => {
      if (event.type !== 'cell') return;
      result.push({ cellId: event.cellId, operandId, at });
      const cell = store.cells[event.cellId];
      if (cell?.kind === 'uml-fragment')
        for (const operand of (cell as NodeCell<UmlFragmentData>).data!
          .operands)
          walk(operand.events, operand.id);
    });
  if (root) umlEvents(root).forEach((events) => walk(events));
  return result;
}
export function umlFrameOf(store: CellStore, cellId: string) {
  return Object.values(store.cells).find(
    (cell) => isFrameCell(cell) && cell.children.includes(cellId),
  )?.id;
}

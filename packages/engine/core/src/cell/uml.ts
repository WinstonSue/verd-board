import {
  isFrameCell,
  isNodeCell,
  type Cell,
  type CellStore,
  type NodeCell,
} from './types';

export type UmlClassifier = 'class' | 'interface' | 'abstract' | 'enum';
export interface UmlClassData {
  classifier: UmlClassifier;
  attributes: string[];
  methods: string[];
}
export type UmlRelation =
  | 'association'
  | 'dependency'
  | 'generalization'
  | 'realization'
  | 'aggregation'
  | 'composition';
export interface UmlRelationData {
  relation: UmlRelation;
  navigable?: boolean;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceMarker?: string;
  targetMarker?: string;
}
export type UmlEvent =
  | { type: 'cell'; cellId: string }
  | { type: 'activate' | 'deactivate'; id: string; participantId: string };
export interface UmlSequenceData {
  participantIds: string[];
  events: UmlEvent[];
}
export interface UmlParticipantData {
  actorType: 'participant' | 'actor';
}
export interface UmlFragmentData {
  operator: 'alt' | 'opt' | 'loop';
  operands: { id: string; guard: string; events: UmlEvent[] }[];
}
export interface UmlNoteData {
  participantIds: string[];
  position: 'left' | 'right' | 'over';
}
export interface UmlMessageData {
  messageKind: 'sync' | 'async' | 'return';
  targetMarker?: string;
  sourceMarker?: string;
}
export const UML_ROOT_KINDS = ['uml-class-root', 'uml-sequence-root'] as const;
export const isUmlRoot = (cell: Cell | undefined) =>
  !!cell && (UML_ROOT_KINDS as readonly string[]).includes(cell.kind);
export const isUmlSequenceCell = (kind: string) =>
  [
    'uml-sequence-root',
    'uml-participant',
    'uml-message',
    'uml-note',
    'uml-fragment',
  ].includes(kind);
export function umlRoot(
  store: CellStore,
  frameId: string,
): NodeCell | undefined {
  const frame = store.cells[frameId];
  return isFrameCell(frame)
    ? (frame.children
        .map((id) => store.cells[id])
        .find((cell) => isNodeCell(cell) && isUmlRoot(cell)) as
        NodeCell | undefined)
    : undefined;
}
export function umlEvents(cell: Cell): UmlEvent[][] {
  if (cell.kind === 'uml-sequence-root')
    return [(cell as NodeCell<UmlSequenceData>).data?.events ?? []];
  if (cell.kind === 'uml-fragment')
    return ((cell as NodeCell<UmlFragmentData>).data?.operands ?? []).map(
      (operand) => operand.events,
    );
  return [];
}
export function umlReferences(cell: Cell): string[] {
  const data = (cell as NodeCell<UmlSequenceData | UmlNoteData>).data;
  return [
    ...(data && 'participantIds' in data ? data.participantIds : []),
    ...umlEvents(cell).flatMap((events) =>
      events.map((event) =>
        event.type === 'cell' ? event.cellId : event.participantId,
      ),
    ),
  ];
}
/** Shared by clipboard and whole-file copies; inline event identities also change. */
export function remapUmlCell(
  cell: Cell,
  remap: (id: string) => string,
  originalId = cell.id,
): Cell {
  if (!cell.kind.startsWith('uml-') || !isNodeCell(cell)) return cell;
  const data = cell.data as UmlSequenceData & UmlFragmentData & UmlNoteData;
  if (!data) return cell;
  const changed = remap(originalId) !== originalId;
  let counter = 0;
  const events = (values: UmlEvent[]) =>
    values.map((event) =>
      event.type === 'cell'
        ? { ...event, cellId: remap(event.cellId) }
        : {
            ...event,
            id: changed ? `${remap(originalId)}:event:${counter++}` : event.id,
            participantId: remap(event.participantId),
          },
    );
  return {
    ...cell,
    data: {
      ...data,
      ...(data.participantIds
        ? { participantIds: data.participantIds.map(remap) }
        : {}),
      ...(data.events ? { events: events(data.events) } : {}),
      ...(data.operands
        ? {
            operands: data.operands.map((operand, index) => ({
              ...operand,
              id: changed
                ? `${remap(originalId)}:operand:${index}`
                : operand.id,
              events: events(operand.events),
            })),
          }
        : {}),
    },
  };
}
/** Structural removal is atomic with the ordinary edge cascade. Never repairs malformed imports. */
export function normalizeUmlRelations(
  before: CellStore,
  candidate: CellStore,
): CellStore {
  const cells = { ...candidate.cells };
  const removeTree = (cell: Cell, seen = new Set<string>()) => {
    if (seen.has(cell.id)) return;
    seen.add(cell.id);
    for (const event of umlEvents(cell).flat())
      if (event.type === 'cell') {
        const child = before.cells[event.cellId];
        if (child) {
          delete cells[child.id];
          removeTree(child, seen);
        }
      }
  };
  Object.values(before.cells).forEach((cell) => {
    if (cell.kind === 'uml-fragment' && !cells[cell.id]) removeTree(cell);
  });
  const removed = new Set(Object.keys(before.cells).filter((id) => !cells[id]));
  if (!removed.size) return candidate;
  Object.values(cells).forEach((cell) => {
    if (cell.kind === 'uml-note') {
      const node = cell as NodeCell<UmlNoteData>;
      const participantIds = node.data!.participantIds.filter(
        (id) => !removed.has(id),
      );
      if (!participantIds.length) {
        delete cells[cell.id];
        removed.add(cell.id);
      } else
        cells[cell.id] = { ...node, data: { ...node.data!, participantIds } };
    }
  });
  const clean = (events: UmlEvent[]) =>
    events.filter((event) =>
      event.type === 'cell'
        ? !removed.has(event.cellId)
        : !removed.has(event.participantId),
    );
  Object.values(cells).forEach((cell) => {
    if (cell.kind === 'uml-sequence-root') {
      const node = cell as NodeCell<UmlSequenceData>;
      cells[cell.id] = {
        ...node,
        data: {
          participantIds: node.data!.participantIds.filter(
            (id) => !removed.has(id),
          ),
          events: clean(node.data!.events),
        },
      };
    } else if (cell.kind === 'uml-fragment') {
      const node = cell as NodeCell<UmlFragmentData>;
      cells[cell.id] = {
        ...node,
        data: {
          ...node.data!,
          operands: node.data!.operands.map((operand) => ({
            ...operand,
            events: clean(operand.events),
          })),
        },
      };
    } else if (isFrameCell(cell))
      cells[cell.id] = {
        ...cell,
        children: cell.children.filter((id) => !!cells[id]),
        groups: cell.groups.filter((id) => !!cells[id]),
      };
  });
  return { ...candidate, cells };
}

export interface UmlClipboardSequence {
  rootId: string;
  participantIds: string[];
  dependentParticipantIds: string[];
  events: UmlEvent[];
}
export function umlClipboardSequence(
  store: CellStore,
  frameId: string,
  included: ReadonlySet<string>,
  explicit: ReadonlySet<string>,
): UmlClipboardSequence | undefined {
  const root = umlRoot(store, frameId) as NodeCell<UmlSequenceData> | undefined;
  if (root?.kind !== 'uml-sequence-root') return undefined;
  const all = explicit.has(root.id) || explicit.has(frameId);
  const project = (events: UmlEvent[]): UmlEvent[] =>
    events.flatMap((event) => {
      if (event.type !== 'cell')
        return all && included.has(event.participantId) ? [event] : [];
      if (included.has(event.cellId)) return [event];
      const cell = store.cells[event.cellId];
      return cell?.kind === 'uml-fragment'
        ? umlEvents(cell).flatMap(project)
        : [];
    });
  return {
    rootId: root.id,
    participantIds: root.data!.participantIds.filter((id) => included.has(id)),
    dependentParticipantIds: root.data!.participantIds.filter(
      (id) => included.has(id) && !explicit.has(id) && !all,
    ),
    events: project(root.data!.events),
  };
}
export function planUmlPaste(request: {
  store: CellStore;
  frameId: string;
  fragment: {
    cells: Record<string, Cell>;
    ids: string[];
    umlSequence?: UmlClipboardSequence;
  };
  allocateId: (id: string) => string;
  offset?: readonly number[];
  intent?: string;
}):
  | {
      operations: import('./index').CellOperation[];
      selection: { focus: string[]; ids: string[] };
    }
  | undefined {
  const frame = request.store.cells[request.frameId],
    root = umlRoot(request.store, request.frameId);
  if (!isFrameCell(frame) || !root) return undefined;
  const nested = new Set(
    Object.values(request.fragment.cells).flatMap((cell) =>
      isFrameCell(cell) ? cell.children : [],
    ),
  );
  const incoming = Object.values(request.fragment.cells).filter(
    (cell) => !nested.has(cell.id),
  );
  if (
    incoming.some((cell) => cell.cellType === 'frame') ||
    !incoming.some((cell) => cell.kind.startsWith('uml-'))
  )
    return undefined;
  const sequence = root.kind === 'uml-sequence-root';
  if (
    incoming.some((cell) =>
      sequence
        ? !isUmlSequenceCell(cell.kind)
        : !['uml-class-root', 'uml-class', 'uml-relation'].includes(cell.kind),
    )
  )
    throw new Error('Cannot mix UML scenes');
  const sourceRoot = incoming.find(isUmlRoot) as
    NodeCell<UmlSequenceData> | undefined;
  const metadata = request.fragment.umlSequence;
  const mapping = new Map<string, string>();
  mapping.set(sourceRoot?.id ?? '', root.id);
  const reused = new Set<string>();
  for (const cell of incoming) {
    if (isUmlRoot(cell)) continue;
    if (
      sequence &&
      metadata?.rootId === root.id &&
      metadata.dependentParticipantIds.includes(cell.id) &&
      request.store.cells[cell.id]?.kind === 'uml-participant'
    ) {
      mapping.set(cell.id, cell.id);
      reused.add(cell.id);
    } else mapping.set(cell.id, request.allocateId(cell.id));
  }
  const remap = (id: string) => mapping.get(id) ?? id;
  const operations: import('./index').CellOperation[] = [];
  for (const original of incoming) {
    if (isUmlRoot(original) || reused.has(original.id)) continue;
    let cell = remapUmlCell(structuredClone(original), remap);
    cell.id = remap(original.id);
    if (isNodeCell(cell) && !sequence)
      cell.geometry = {
        ...cell.geometry,
        x: cell.geometry.x + (request.offset?.[0] ?? 20),
        y: cell.geometry.y + (request.offset?.[1] ?? 20),
      };
    if (cell.cellType === 'edge') {
      cell.source =
        'cellId' in cell.source
          ? { ...cell.source, cellId: remap(cell.source.cellId) }
          : cell.source;
      cell.target =
        'cellId' in cell.target
          ? { ...cell.target, cellId: remap(cell.target.cellId) }
          : cell.target;
    }
    operations.push({ type: 'insert_cell', parentId: frame.id, cell });
  }
  if (sequence) {
    const source = sourceRoot?.data ?? metadata;
    if (!source)
      throw new Error('Sequence clipboard is missing event structure');
    const pasteEventOwner = request.allocateId('uml-paste-events');
    const projectedRoot = remapUmlCell(
      {
        ...root,
        id: sourceRoot?.id ?? metadata!.rootId,
        data: { participantIds: source.participantIds, events: source.events },
      },
      (id) =>
        id === (sourceRoot?.id ?? metadata!.rootId)
          ? pasteEventOwner
          : remap(id),
    ) as NodeCell<UmlSequenceData>;
    const current = root.data as UmlSequenceData;
    operations.push({
      type: 'replace_cell',
      cell: {
        ...root,
        data: {
          participantIds: [
            ...new Set([
              ...current.participantIds,
              ...projectedRoot.data!.participantIds,
            ]),
          ],
          events: [...current.events, ...projectedRoot.data!.events],
        },
      },
    });
  }
  return {
    operations,
    selection: {
      focus: [frame.id],
      ids: operations.flatMap((operation) =>
        operation.type === 'insert_cell' && !operation.cell.hidden
          ? [operation.cell.id]
          : [],
      ),
    },
  };
}

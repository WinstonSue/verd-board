import {
  NodeUtil,
  EdgeUtil,
  isNodeCell,
  isEdgeCell,
  isFrameCell,
  indexCells,
  umlRoot,
  type Cell,
  type CellStore,
  type CellRegistry,
  type NodeCell,
  type EdgeCell,
  type NodeGeometry,
  type FrameMount,
  type CellMoveContext,
  type UmlClassData,
  type UmlSequenceData,
  type UmlFragmentData,
  type UmlNoteData,
  type UmlMessageData,
  type UmlRelationData,
  type UmlEvent,
} from '@sue/board-core';
import { layoutUmlSequence } from './layout';
import { reorderUmlParticipant, umlFrameOf } from './model';
const relations = [
  'association',
  'dependency',
  'generalization',
  'realization',
  'aggregation',
  'composition',
];
export function validateUmlSequence(
  store: CellStore,
  root: NodeCell<UmlSequenceData>,
): string | undefined {
  const frameId = umlFrameOf(store, root.id),
    frame = store.cells[frameId ?? ''];
  const data = root.data;
  if (
    !isFrameCell(frame) ||
    !data ||
    !Array.isArray(data.participantIds) ||
    !Array.isArray(data.events)
  )
    return 'Invalid UML sequence root';
  const participants = new Set(data.participantIds),
    visited = new Set<string>(),
    eventIds = new Set<string>(),
    branchIds = new Set<string>();
  if (
    participants.size !== data.participantIds.length ||
    data.participantIds.some(
      (id) =>
        store.cells[id]?.kind !== 'uml-participant' ||
        !frame.children.includes(id),
    )
  )
    return 'Invalid UML participants';
  let error: string | undefined;
  const walk = (events: UmlEvent[], stacks: Map<string, string[]>) => {
    if (!Array.isArray(events)) {
      error = 'Invalid UML events';
      return;
    }
    for (const event of events) {
      if (!event || typeof event !== 'object') {
        error = 'Invalid UML event';
        return;
      }
      if (event.type !== 'cell') {
        if (
          !['activate', 'deactivate'].includes(event.type) ||
          typeof event.id !== 'string' ||
          !event.id ||
          eventIds.has(event.id) ||
          !participants.has(event.participantId)
        ) {
          error = 'Invalid activation event';
          return;
        }
        eventIds.add(event.id);
        const stack = stacks.get(event.participantId) ?? [];
        stacks.set(event.participantId, stack);
        if (event.type === 'activate') stack.push(event.id);
        else if (!stack.pop()) {
          error = 'Unpaired UML activation';
          return;
        }
        continue;
      }
      const cell = store.cells[event.cellId];
      if (
        !cell ||
        !frame.children.includes(cell.id) ||
        !['uml-message', 'uml-note', 'uml-fragment'].includes(cell.kind) ||
        visited.has(cell.id)
      ) {
        error = 'UML event tree contains a duplicate, cycle or missing cell';
        return;
      }
      visited.add(cell.id);
      if (cell.kind === 'uml-fragment') {
        const value = (cell as NodeCell<UmlFragmentData>).data;
        if (
          !value ||
          !['alt', 'opt', 'loop'].includes(value.operator) ||
          !Array.isArray(value.operands) ||
          !value.operands.length ||
          (value.operator !== 'alt' && value.operands.length !== 1)
        ) {
          error = 'Invalid UML fragment';
          return;
        }
        for (const operand of value.operands) {
          if (
            !operand.id ||
            branchIds.has(operand.id) ||
            typeof operand.guard !== 'string'
          ) {
            error = 'Invalid UML fragment branch';
            return;
          }
          branchIds.add(operand.id);
          const branchStacks = new Map(
            [...stacks].map(([key, stack]) => [key, [...stack]]),
          );
          walk(operand.events, branchStacks);
          for (const id of participants)
            if (
              JSON.stringify(branchStacks.get(id) ?? []) !==
              JSON.stringify(stacks.get(id) ?? [])
            ) {
              error = 'Fragment branches must balance their own activations';
              return;
            }
        }
      }
      if (error) return;
    }
  };
  const stacks = new Map<string, string[]>();
  walk(data.events, stacks);
  if (error) return error;
  if ([...stacks.values()].some((stack) => stack.length))
    return 'Unpaired UML activation';
  for (const id of frame.children) {
    const cell = store.cells[id];
    if (
      ['uml-message', 'uml-note', 'uml-fragment'].includes(cell?.kind) &&
      !visited.has(id)
    )
      return 'Orphan UML event';
    if (cell?.kind === 'uml-participant' && !participants.has(id))
      return 'Orphan UML participant';
  }
  return undefined;
}
class UmlNodeUtil extends NodeUtil {
  constructor(readonly kind: string) {
    super();
  }
  override capabilities(store: CellStore, cell: Cell, mount: FrameMount) {
    const base = super.capabilities(store, cell, mount);
    if (this.kind.endsWith('-root'))
      return {
        move: false,
        resize: false,
        rotate: false,
        edit: false,
        connect: false,
        delete: false,
      };
    if (this.kind !== 'uml-class')
      return {
        ...base,
        move: this.kind === 'uml-participant' && !cell.locked,
        resize: false,
        rotate: false,
        connect: false,
      };
    return { ...base, rotate: false };
  }
  override hitTest(
    store: CellStore,
    cell: NodeCell,
    point: [number, number],
    tolerance = 6,
  ) {
    if (this.kind === 'uml-fragment') {
      const b = cell.geometry;
      return (
        point[0] >= b.x - tolerance &&
        point[0] <= b.x + b.width + tolerance &&
        point[1] >= b.y - tolerance &&
        point[1] <= b.y + b.height + tolerance &&
        (point[1] < b.y + 30 ||
          Math.min(
            Math.abs(point[0] - b.x),
            Math.abs(point[0] - b.x - b.width),
            Math.abs(point[1] - b.y - b.height),
          ) <= tolerance)
      );
    }
    if (this.kind === 'uml-participant') {
      const b = cell.geometry;
      return (
        (point[1] <= b.y + 65 &&
          super.hitTest(store, cell, point, tolerance)) ||
        (point[1] >= b.y &&
          point[1] <= b.y + b.height &&
          Math.abs(point[0] - b.x - b.width / 2) <= tolerance)
      );
    }
    return super.hitTest(store, cell, point, tolerance);
  }
  override move(
    store: CellStore,
    cell: Cell,
    geometry: NodeGeometry,
    _target?: string,
    context?: CellMoveContext,
  ) {
    if (this.kind === 'uml-participant') {
      const frameId = umlFrameOf(store, cell.id);
      if (!frameId) return [];
      const root = umlRoot(store, frameId) as NodeCell<UmlSequenceData>;
      const layout = layoutUmlSequence(store, frameId);
      const x = context?.point[0] ?? geometry.x + geometry.width / 2;
      const at = root.data!.participantIds.filter(
        (id) => id !== cell.id && (layout.geometry.get(id)?.x ?? 0) + 75 < x,
      ).length;
      return reorderUmlParticipant(store, frameId, cell.id, at);
    }
    return super.move(store, cell, geometry);
  }
  override validate(store: CellStore, cell: Cell): string | undefined {
    if (!isNodeCell(cell) || cell.cellType !== 'node')
      return 'UML node must have node cellType';
    const value = cell as NodeCell;
    if (this.kind.endsWith('-root')) {
      const parent = store.cells[indexCells(store).parentOf.get(cell.id) ?? ''];
      if (
        !isFrameCell(parent) ||
        parent.children.filter((id) => store.cells[id]?.kind === this.kind)
          .length !== 1 ||
        !cell.hidden
      )
        return 'UML frame requires one hidden root';
      return this.kind === 'uml-sequence-root'
        ? validateUmlSequence(store, cell as NodeCell<UmlSequenceData>)
        : undefined;
    }
    if (this.kind === 'uml-class') {
      const data = value.data as UmlClassData;
      if (
        !data ||
        !['class', 'interface', 'abstract', 'enum'].includes(data.classifier) ||
        !Array.isArray(data.attributes) ||
        !Array.isArray(data.methods) ||
        [...data.attributes, ...data.methods].some(
          (line) => typeof line !== 'string',
        )
      )
        return 'Invalid UML classifier';
    }
    if (
      this.kind === 'uml-participant' &&
      !['participant', 'actor'].includes(
        (value.data as { actorType?: string })?.actorType ?? '',
      )
    )
      return 'Invalid UML participant';
    if (this.kind === 'uml-note') {
      const data = value.data as UmlNoteData;
      const frameId = umlFrameOf(store, cell.id);
      if (
        !data ||
        !Array.isArray(data.participantIds) ||
        !data.participantIds.length ||
        data.participantIds.some(
          (id) =>
            store.cells[id]?.kind !== 'uml-participant' ||
            umlFrameOf(store, id) !== frameId,
        ) ||
        !['left', 'right', 'over'].includes(data.position)
      )
        return 'Invalid UML note';
    }
    return undefined;
  }
}
class UmlEdgeUtil extends EdgeUtil {
  constructor(readonly kind: string) {
    super();
  }
  override capabilities(store: CellStore, cell: Cell, mount: FrameMount) {
    return {
      ...super.capabilities(store, cell, mount),
      move: false,
      resize: false,
      rotate: false,
      connect: false,
    };
  }
  override validate(_store: CellStore, cell: Cell): string | undefined {
    return isEdgeCell(cell)
      ? undefined
      : 'UML relationship/message must have edge cellType';
  }
  override validateEdge(store: CellStore, edge: EdgeCell): string | undefined {
    if (
      (edge.labels?.length ?? 0) > 1 ||
      edge.labels?.some((label) => typeof label.text !== 'string')
    )
      return 'UML edges accept one text label';
    const expected =
      this.kind === 'uml-message' ? 'uml-participant' : 'uml-class';
    if (
      !('cellId' in edge.source) ||
      !('cellId' in edge.target) ||
      store.cells[edge.source.cellId]?.kind !== expected ||
      store.cells[edge.target.cellId]?.kind !== expected
    )
      return 'Invalid UML edge endpoint';
    if (
      this.kind === 'uml-message' &&
      !['sync', 'async', 'return'].includes(
        (edge.data as UmlMessageData)?.messageKind,
      )
    )
      return 'Invalid UML message';
    if (
      this.kind === 'uml-relation' &&
      !relations.includes((edge.data as UmlRelationData)?.relation)
    )
      return 'Invalid UML relation';
    if (this.kind === 'uml-relation') {
      const data = edge.data as UmlRelationData;
      if (
        [data.sourceMultiplicity, data.targetMultiplicity].some(
          (value) => value !== undefined && typeof value !== 'string',
        ) ||
        (data.navigable !== undefined && typeof data.navigable !== 'boolean')
      )
        return 'Invalid UML relation metadata';
    }
    return undefined;
  }
}
export function registerUmlCells(registry: CellRegistry) {
  for (const kind of [
    'uml-class-root',
    'uml-sequence-root',
    'uml-class',
    'uml-participant',
    'uml-note',
    'uml-fragment',
  ])
    registry.register(new UmlNodeUtil(kind));
  for (const kind of ['uml-message', 'uml-relation'])
    registry.register(new UmlEdgeUtil(kind));
}

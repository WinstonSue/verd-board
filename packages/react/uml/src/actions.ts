import {
  isFrameCell,
  isNodeCell,
  type Cell,
  type CellOperation,
  type NodeCell,
} from '@sue/board-core';
import type {
  FrameActionContext,
  FrameActionDefinition,
} from '@sue/board-react';
import {
  addUmlActivation,
  addUmlCell,
  createUmlClassCell,
  createUmlFragmentCell,
  createUmlMessageCell,
  createUmlNoteCell,
  createUmlParticipantCell,
  createUmlRelationCell,
  moveUmlEvent,
  reorderUmlParticipant,
  sequenceEventLocations,
  umlEvents,
  umlRoot,
  type UmlFragmentData,
  type UmlSequenceData,
} from '@sue/board-uml';

const rootKind = (c: FrameActionContext) => umlRoot(c.store, c.frameId)?.kind;
const members = (c: FrameActionContext, kind: string) => {
  const frame = c.store.cells[c.frameId];
  return isFrameCell(frame)
    ? frame.children
        .map((id) => c.store.cells[id])
        .filter((cell) => cell?.kind === kind)
    : [];
};
function add(c: FrameActionContext, cell: Cell, operandId?: string) {
  if (cell.kind === 'uml-class' && isNodeCell(cell)) {
    const count = members(c, 'uml-class').length;
    cell = {
      ...cell,
      geometry: {
        ...cell.geometry,
        x: 60 + (count % 3) * 260,
        y: 80 + Math.floor(count / 3) * 200,
      },
    };
  }
  return c.runOperations(addUmlCell(c.store, c.frameId, cell, operandId), {
    selectionIds: [cell.id],
  });
}
const objectArgs = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';
const endpoints = (
  value: unknown,
): value is { sourceId: string; targetId: string; operandId?: string } =>
  objectArgs(value) &&
  typeof value['sourceId'] === 'string' &&
  typeof value['targetId'] === 'string' &&
  (value['operandId'] === undefined || typeof value['operandId'] === 'string');

/** Every discrete UML operation is contributed once for all editor surfaces. */
export const umlActions: readonly FrameActionDefinition[] = [
  ...(['class', 'interface', 'abstract', 'enum'] as const).map(
    (kind, index): FrameActionDefinition => ({
      id: `uml.add-${kind}`,
      label: {
        zh: ['添加类', '添加接口', '添加抽象类', '添加枚举'][index],
        en: `Add ${kind}`,
      },
      category: 'uml',
      effect: 'content',
      getState: (c) => ({
        visible: rootKind(c) === 'uml-class-root',
        enabled: !c.disabled && rootKind(c) === 'uml-class-root',
      }),
      execute: (c) => add(c, createUmlClassCell(c.allocateId(), kind)),
    }),
  ),
  ...(['participant', 'actor'] as const).map((kind): FrameActionDefinition => ({
    id: `uml.add-${kind}`,
    label: {
      zh: kind === 'actor' ? '添加 Actor' : '添加参与者',
      en: `Add ${kind}`,
    },
    category: 'uml',
    effect: 'content',
    getState: (c) => ({
      visible: rootKind(c) === 'uml-sequence-root',
      enabled: !c.disabled && rootKind(c) === 'uml-sequence-root',
    }),
    execute: (c) => add(c, createUmlParticipantCell(c.allocateId(), kind)),
  })),
  {
    id: 'uml.add-message',
    label: { zh: '添加消息', en: 'Add message' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: endpoints,
    getState: (c, args) => ({
      enabled:
        !c.disabled &&
        rootKind(c) === 'uml-sequence-root' &&
        members(c, 'uml-participant').some(
          (cell) => cell.id === args.sourceId,
        ) &&
        members(c, 'uml-participant').some((cell) => cell.id === args.targetId),
    }),
    execute: (
      c,
      args: { sourceId: string; targetId: string; operandId?: string },
    ) =>
      add(
        c,
        createUmlMessageCell(c.allocateId(), args.sourceId, args.targetId),
        args.operandId,
      ),
  },
  {
    id: 'uml.add-relation',
    label: { zh: '添加关系', en: 'Add relation' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: endpoints,
    getState: (c, args) => ({
      enabled:
        !c.disabled &&
        rootKind(c) === 'uml-class-root' &&
        members(c, 'uml-class').some((cell) => cell.id === args.sourceId) &&
        members(c, 'uml-class').some((cell) => cell.id === args.targetId),
    }),
    execute: (c, args: { sourceId: string; targetId: string }) =>
      add(
        c,
        createUmlRelationCell(c.allocateId(), args.sourceId, args.targetId),
      ),
  },
  {
    id: 'uml.add-note',
    label: { zh: '添加注释', en: 'Add note' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (
      args: unknown,
    ): args is { participantIds: string[]; operandId?: string } =>
      objectArgs(args) &&
      Array.isArray(args['participantIds']) &&
      args['participantIds'].every((id) => typeof id === 'string'),
    getState: (c, args) => ({
      enabled:
        !c.disabled &&
        rootKind(c) === 'uml-sequence-root' &&
        args.participantIds.length > 0 &&
        args.participantIds.every((id: string) =>
          members(c, 'uml-participant').some((cell) => cell.id === id),
        ),
    }),
    execute: (c, args: { participantIds: string[]; operandId?: string }) =>
      add(
        c,
        createUmlNoteCell(c.allocateId(), args.participantIds),
        args.operandId,
      ),
  },
  ...(['alt', 'opt', 'loop'] as const).map((kind): FrameActionDefinition => ({
    id: `uml.add-${kind}`,
    label: { zh: `添加 ${kind} 片段`, en: `Add ${kind} fragment` },
    category: 'uml',
    effect: 'content',
    getState: (c) => ({
      visible: rootKind(c) === 'uml-sequence-root',
      enabled: !c.disabled && rootKind(c) === 'uml-sequence-root',
    }),
    execute: (c, args?: { operandId?: string }) =>
      add(c, createUmlFragmentCell(c.allocateId(), kind), args?.operandId),
  })),
  {
    id: 'uml.add-activation',
    label: { zh: '添加激活区间', en: 'Add activation' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (
      args: unknown,
    ): args is { participantId: string; operandId?: string } =>
      objectArgs(args) && typeof args['participantId'] === 'string',
    getState: (c, args) => ({
      enabled:
        !c.disabled &&
        rootKind(c) === 'uml-sequence-root' &&
        members(c, 'uml-participant').some(
          (cell) => cell.id === args.participantId,
        ),
    }),
    execute: (c, args: { participantId: string; operandId?: string }) => {
      const root = umlRoot(c.store, c.frameId) as NodeCell<UmlSequenceData>;
      const operand = members(c, 'uml-fragment')
        .flatMap((cell) => (cell as NodeCell<UmlFragmentData>).data!.operands)
        .find((entry) => entry.id === args.operandId);
      if (args.operandId && !operand)
        return { status: 'rejected', code: 'missing-branch' };
      return c.runOperations(
        addUmlActivation(
          c.store,
          c.frameId,
          args.participantId,
          0,
          operand?.events.length ?? root.data!.events.length,
          c.allocateId,
          args.operandId,
        ),
      );
    },
  },
  ...([-1, 1] as const).map((direction): FrameActionDefinition => ({
    id: direction < 0 ? 'uml.participant-left' : 'uml.participant-right',
    label:
      direction < 0
        ? { zh: '参与者向左', en: 'Move participant left' }
        : { zh: '参与者向右', en: 'Move participant right' },
    category: 'uml',
    effect: 'content',
    getState: (c) => {
      const root = umlRoot(c.store, c.frameId),
        ids =
          root?.kind === 'uml-sequence-root'
            ? (root as NodeCell<UmlSequenceData>).data!.participantIds
            : [];
      const at = ids.indexOf(c.cell?.id ?? '');
      return {
        visible: c.cell?.kind === 'uml-participant',
        enabled:
          !c.disabled &&
          at >= 0 &&
          at + direction >= 0 &&
          at + direction < ids.length,
      };
    },
    execute: (c) => {
      const root = umlRoot(c.store, c.frameId) as NodeCell<UmlSequenceData>;
      const at = root.data!.participantIds.indexOf(c.cell!.id);
      return c.runOperations(
        reorderUmlParticipant(c.store, c.frameId, c.cell!.id, at + direction),
      );
    },
  })),
  ...([-1, 1] as const).map((direction): FrameActionDefinition => ({
    id: direction < 0 ? 'uml.event-earlier' : 'uml.event-later',
    label:
      direction < 0
        ? { zh: '事件前移', en: 'Move event earlier' }
        : { zh: '事件后移', en: 'Move event later' },
    category: 'uml',
    effect: 'content',
    getState: (c) => ({
      visible: !!sequenceEventLocations(c.store, c.frameId).find(
        (entry) => entry.cellId === c.cell?.id,
      ),
      enabled:
        !c.disabled &&
        !!c.cell &&
        sequenceEventLocations(c.store, c.frameId).some(
          (entry) => entry.cellId === c.cell!.id && entry.at + direction >= 0,
        ),
    }),
    execute: (c) => {
      const location = sequenceEventLocations(c.store, c.frameId).find(
        (entry) => entry.cellId === c.cell?.id,
      );
      return location
        ? c.runOperations(
            moveUmlEvent(
              c.store,
              c.frameId,
              location.cellId,
              location.operandId,
              location.at + direction,
            ),
          )
        : { status: 'rejected', code: 'missing-event' };
    },
  })),
  {
    id: 'uml.move-event-to-branch',
    label: { zh: '移动事件到分支', en: 'Move event to branch' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (
      args: unknown,
    ): args is { cellId: string; operandId?: string } =>
      objectArgs(args) &&
      typeof args['cellId'] === 'string' &&
      (args['operandId'] === undefined ||
        typeof args['operandId'] === 'string'),
    getState: (c) => ({
      enabled: !c.disabled && rootKind(c) === 'uml-sequence-root',
    }),
    execute: (c, args: { cellId: string; operandId?: string }) =>
      c.runOperations(
        moveUmlEvent(c.store, c.frameId, args.cellId, args.operandId),
      ),
  },
  {
    id: 'uml.add-branch',
    label: { zh: '添加分支', en: 'Add branch' },
    category: 'uml',
    effect: 'content',
    getState: (c) => ({
      visible: c.cell?.kind === 'uml-fragment',
      enabled:
        !c.disabled &&
        isNodeCell(c.cell) &&
        c.cell.kind === 'uml-fragment' &&
        (c.cell.data as UmlFragmentData).operator === 'alt',
    }),
    execute: (c) => {
      const cell = c.cell as NodeCell<UmlFragmentData>;
      return c.runOperations([
        {
          type: 'replace_cell',
          cell: {
            ...cell,
            data: {
              ...cell.data!,
              operands: [
                ...cell.data!.operands,
                { id: c.allocateId(), guard: 'else', events: [] },
              ],
            },
          },
        },
      ]);
    },
  },
  {
    id: 'uml.delete-branch',
    label: { zh: '删除分支', en: 'Delete branch' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (
      args: unknown,
    ): args is { cellId: string; operandId: string } =>
      objectArgs(args) &&
      typeof args['cellId'] === 'string' &&
      typeof args['operandId'] === 'string',
    getState: (c, args) => {
      const cell = c.store.cells[args.cellId] as
        NodeCell<UmlFragmentData> | undefined;
      return {
        enabled:
          !c.disabled &&
          cell?.kind === 'uml-fragment' &&
          cell.data?.operator === 'alt' &&
          cell.data.operands.length > 1,
      };
    },
    execute: (c, args: { cellId: string; operandId: string }) => {
      const cell = c.store.cells[args.cellId] as NodeCell<UmlFragmentData>,
        operand = cell.data!.operands.find(
          (entry) => entry.id === args.operandId,
        );
      if (!operand) return { status: 'rejected', code: 'missing-branch' };
      const removed = operand.events.flatMap((entry) =>
        entry.type === 'cell'
          ? [{ type: 'remove_cell' as const, cellId: entry.cellId }]
          : [],
      );
      return c.runOperations([
        {
          type: 'replace_cell',
          cell: {
            ...cell,
            data: {
              ...cell.data!,
              operands: cell.data!.operands.filter(
                (entry) => entry.id !== args.operandId,
              ),
            },
          },
        },
        ...removed,
      ]);
    },
  },
  {
    id: 'uml.update-properties',
    label: { zh: '修改 UML 属性', en: 'Update UML properties' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (args: unknown): args is { operations: CellOperation[] } =>
      objectArgs(args) && Array.isArray(args['operations']),
    getState: (c) => ({ enabled: !c.disabled }),
    execute: (c, args: { operations: CellOperation[] }) =>
      c.runOperations(args.operations),
  },
  {
    id: 'uml.remove-activation',
    label: { zh: '删除激活', en: 'Remove activation' },
    category: 'uml',
    effect: 'content',
    palette: false,
    validateArgs: (
      args: unknown,
    ): args is { ownerId: string; branch: number; activationId: string } =>
      objectArgs(args) &&
      typeof args['ownerId'] === 'string' &&
      Number.isInteger(args['branch']) &&
      typeof args['activationId'] === 'string',
    getState: (c) => ({ enabled: !c.disabled }),
    execute: (
      c,
      args: { ownerId: string; branch: number; activationId: string },
    ) => {
      const owner = c.store.cells[args.ownerId] as NodeCell<
          UmlSequenceData | UmlFragmentData
        >,
        list = owner && umlEvents(owner)[args.branch];
      if (!list) return { status: 'rejected', code: 'missing-activation' };
      const start = list.findIndex(
        (event) => event.type === 'activate' && event.id === args.activationId,
      );
      if (start < 0) return { status: 'rejected', code: 'missing-activation' };
      const activation = list[start];
      if (activation.type !== 'activate')
        return { status: 'rejected', code: 'missing-activation' };
      let depth = 0,
        end = -1;
      for (let index = start; index < list.length; index++) {
        const event = list[index];
        if (
          event.type === 'cell' ||
          event.participantId !== activation.participantId
        )
          continue;
        depth += event.type === 'activate' ? 1 : -1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
      if (end < 0) return { status: 'rejected', code: 'missing-activation' };
      const events = list.filter(
        (_, index) => index !== start && index !== end,
      );
      const data =
        owner.kind === 'uml-sequence-root'
          ? { ...(owner.data as UmlSequenceData), events }
          : {
              ...(owner.data as UmlFragmentData),
              operands: (owner.data as UmlFragmentData).operands.map(
                (operand, index) =>
                  index === args.branch ? { ...operand, events } : operand,
              ),
            };
      return c.runOperations([
        { type: 'replace_cell', cell: { ...owner, data } },
      ]);
    },
  },
];

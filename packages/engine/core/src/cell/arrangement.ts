import type { RectangleClient } from '../interfaces/rectangle-client';
import type { Point } from '../interfaces/point';
import { indexCells, type CellOperation } from './index';
import { translateCellSelection } from './commands';
import { frameScene } from './frame';
import {
  graphArrangementPositions,
  type ArrangementLink,
} from './arrangement-graph';
import {
  cellArrangementBounds,
  groupAncestors,
  groupHasLockedLeaf,
  groupLeafMembers,
  lockedByAncestor,
  unionCellBounds,
} from './group';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type ArchitectureLayerData,
  type CellId,
  type CellStore,
  type NodeCell,
} from './types';

export type CellAlignment =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type CellDistribution = 'horizontal' | 'vertical';
export type CellLayoutStyle =
  'grid' | 'horizontal' | 'vertical' | 'flow' | 'layers';
export type ArrangementCommand =
  | { type: 'align'; axis: CellAlignment }
  | { type: 'distribute'; axis: CellDistribution }
  | { type: 'layout'; style: CellLayoutStyle };
export interface ArrangementBlock {
  id: CellId;
  members: CellId[];
  bounds: RectangleClient;
  locked: boolean;
}

/** The direct selection is the scope. Frames never expand to their contents. */
export function collectArrangementBlocks(
  store: CellStore,
  frameId: CellId,
  ids: readonly CellId[] = [],
): ArrangementBlock[] {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame) || frameScene(store, frameId) === 'mind-root')
    return [];
  const index = indexCells(store);
  const candidates = [
    ...new Set(
      ids.length
        ? ids
        : [...frame.children, ...frame.groups].filter(
            (id) => !index.groupOf.has(id),
          ),
    ),
  ];
  if (candidates.some((id) => index.parentOf.get(id) !== frameId))
    throw new Error('Arrangement crosses frame');
  const selected = new Set(candidates);
  let frameLocked = false;
  for (let id: string | undefined = frameId; id; id = index.parentOf.get(id))
    frameLocked ||= !!store.cells[id]?.locked;
  return candidates.flatMap((id) => {
    const cell = store.cells[id];
    if (
      !cell ||
      cell.hidden ||
      (!isNodeCell(cell) && !isGroupCell(cell)) ||
      cell.kind === 'architecture-layer' ||
      cell.kind.startsWith('mind-')
    )
      return [];
    if (groupAncestors(store, id).some((owner) => selected.has(owner)))
      return [];
    const bounds = cellArrangementBounds(store, id);
    if (!bounds) return [];
    return [
      {
        id,
        bounds,
        members: isGroupCell(cell) ? groupLeafMembers(store, id) : [id],
        locked:
          frameLocked ||
          !!cell.locked ||
          lockedByAncestor(store, id) ||
          groupHasLockedLeaf(store, id),
      },
    ];
  });
}

const moveBlocks = (
  store: CellStore,
  blocks: readonly ArrangementBlock[],
  deltas: readonly Point[],
  roundDelta = true,
): CellOperation[] =>
  blocks.flatMap((block, i) => {
    const delta: Point = roundDelta
      ? [Math.round(deltas[i][0]), Math.round(deltas[i][1])]
      : deltas[i];
    return delta[0] || delta[1]
      ? translateCellSelection(store, [block.id], delta)
      : [];
  });

export function alignCells(
  store: CellStore,
  ids: readonly CellId[],
  axis: CellAlignment,
): CellOperation[] {
  if (!ids.length) return [];
  const frameId = indexCells(store).parentOf.get(ids[0]);
  if (!frameId) return [];
  const blocks = collectArrangementBlocks(store, frameId, ids);
  if (blocks.length < 2 || blocks.some((block) => block.locked)) return [];
  const bounds = unionCellBounds(blocks.map((block) => block.bounds))!;
  return moveBlocks(
    store,
    blocks,
    blocks.map(({ bounds: b }) => [
      axis === 'left'
        ? bounds.x - b.x
        : axis === 'center'
          ? bounds.x + bounds.width / 2 - b.x - b.width / 2
          : axis === 'right'
            ? bounds.x + bounds.width - b.x - b.width
            : 0,
      axis === 'top'
        ? bounds.y - b.y
        : axis === 'middle'
          ? bounds.y + bounds.height / 2 - b.y - b.height / 2
          : axis === 'bottom'
            ? bounds.y + bounds.height - b.y - b.height
            : 0,
    ]),
  );
}

export function distributeCells(
  store: CellStore,
  ids: readonly CellId[],
  axis: CellDistribution,
): CellOperation[] {
  if (!ids.length) return [];
  const frameId = indexCells(store).parentOf.get(ids[0]);
  if (!frameId) return [];
  const blocks = collectArrangementBlocks(store, frameId, ids);
  if (blocks.length < 3 || blocks.some((block) => block.locked)) return [];
  const horizontal = axis === 'horizontal';
  const position = (block: ArrangementBlock) =>
    horizontal ? block.bounds.x : block.bounds.y;
  const size = (block: ArrangementBlock) =>
    horizontal ? block.bounds.width : block.bounds.height;
  blocks.sort((a, b) => position(a) - position(b));
  const first = position(blocks[0]);
  const last = blocks.at(-1)!;
  const gap =
    (position(last) +
      size(last) -
      first -
      blocks.reduce((sum, block) => sum + size(block), 0)) /
    (blocks.length - 1);
  let cursor = first;
  const deltas = blocks.map((block, i): Point => {
    const delta =
      i === 0 || i === blocks.length - 1 ? 0 : cursor - position(block);
    cursor += size(block) + gap;
    return horizontal ? [delta, 0] : [0, delta];
  });
  return moveBlocks(store, blocks, deltas);
}

const stableBlocks = (blocks: ArrangementBlock[]) =>
  blocks.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

function arrangementLinks(
  store: CellStore,
  blocks: ArrangementBlock[],
  kind: string,
): ArrangementLink[] {
  const owner = new Map(
    blocks.flatMap((block) =>
      block.members.map((id) => [id, block.id] as const),
    ),
  );
  return Object.values(store.cells).flatMap((cell) => {
    if (
      !isEdgeCell(cell) ||
      cell.kind !== kind ||
      !('cellId' in cell.source) ||
      !('cellId' in cell.target)
    )
      return [];
    const source = owner.get(cell.source.cellId),
      target = owner.get(cell.target.cellId);
    return source && target && source !== target ? [{ source, target }] : [];
  });
}

function flowRows(
  store: CellStore,
  blocks: ArrangementBlock[],
): ArrangementBlock[][] {
  const owner = new Map(
    blocks.flatMap((block) =>
      block.members.map((id) => [id, block.id] as const),
    ),
  );
  const targets = new Map(blocks.map((block) => [block.id, new Set<string>()]));
  const incoming = new Map(blocks.map((block) => [block.id, 0]));
  for (const cell of Object.values(store.cells)) {
    if (
      !isEdgeCell(cell) ||
      cell.kind !== 'workflow-edge' ||
      !('cellId' in cell.source) ||
      !('cellId' in cell.target)
    )
      continue;
    const source = owner.get(cell.source.cellId),
      target = owner.get(cell.target.cellId);
    if (
      !source ||
      !target ||
      source === target ||
      targets.get(source)!.has(target)
    )
      continue;
    targets.get(source)!.add(target);
    incoming.set(target, incoming.get(target)! + 1);
  }
  const rows: ArrangementBlock[][] = [];
  let ready = blocks.filter((block) => incoming.get(block.id) === 0);
  let visited = 0;
  while (ready.length) {
    rows.push(ready);
    visited += ready.length;
    const next: ArrangementBlock[] = [];
    for (const block of ready)
      for (const id of targets.get(block.id)!) {
        incoming.set(id, incoming.get(id)! - 1);
        if (!incoming.get(id))
          next.push(blocks.find((candidate) => candidate.id === id)!);
      }
    ready = next.sort((a, b) => a.id.localeCompare(b.id));
  }
  if (visited !== blocks.length)
    throw new Error('Cannot arrange a cyclic grouped workflow');
  return rows;
}

function layerRows(
  store: CellStore,
  blocks: ArrangementBlock[],
): ArrangementBlock[][] {
  const index = indexCells(store);
  const rows = new Map<string, ArrangementBlock[]>();
  for (const block of blocks) {
    const owners = new Set(
      block.members
        .filter((id) => store.cells[id]?.kind === 'architecture-module')
        .map((id) => index.domainOwnerOf.get(id)),
    );
    if (owners.size > 1) throw new Error('A group crosses architecture layers');
    const owner = [...owners][0] ?? block.id;
    rows.set(owner, [...(rows.get(owner) ?? []), block]);
  }
  return [...rows]
    .sort(([a], [b]) => {
      const order = (id: string) =>
        (store.cells[id] as NodeCell<ArchitectureLayerData>)?.data?.order ?? id;
      return order(a).localeCompare(order(b)) || a.localeCompare(b);
    })
    .map(([, row]) => row);
}

/** Explicit layouts produce authored positions and never run while rendering. */
export function arrangeCells(
  store: CellStore,
  frameId: CellId,
  ids: readonly CellId[],
  style: CellLayoutStyle,
  gap = 32,
): CellOperation[] {
  const scene = frameScene(store, frameId);
  if (
    (style === 'flow' && scene !== 'workflow-start') ||
    (style === 'layers' && scene !== 'architecture-layer')
  )
    throw new Error('Layout does not match the frame');
  const blocks = collectArrangementBlocks(store, frameId, ids).filter(
    (block) => !block.locked,
  );
  if (style === 'flow' || style === 'layers')
    blocks.sort((a, b) => a.id.localeCompare(b.id));
  else stableBlocks(blocks);
  if (blocks.length < 2) return [];
  const bounds = unionCellBounds(blocks.map((block) => block.bounds))!;
  let rows: ArrangementBlock[][];
  if (style === 'flow') rows = flowRows(store, blocks);
  else if (style === 'layers') rows = layerRows(store, blocks);
  else {
    const columns =
      style === 'horizontal'
        ? blocks.length
        : style === 'vertical'
          ? 1
          : Math.ceil(Math.sqrt(blocks.length));
    rows = Array.from({ length: Math.ceil(blocks.length / columns) }, (_, i) =>
      blocks.slice(i * columns, (i + 1) * columns),
    );
  }
  if (style === 'flow' || style === 'layers') {
    const positions = graphArrangementPositions(
      rows,
      arrangementLinks(
        store,
        blocks,
        style === 'flow' ? 'workflow-edge' : 'architecture-edge',
      ),
      Math.max(48, gap),
      Math.max(96, gap),
    );
    return moveBlocks(
      store,
      blocks,
      blocks.map((block): Point => {
        const position = positions.get(block.id)!;
        return [
          Math.round(bounds.x) + position[0] - block.bounds.x,
          Math.round(bounds.y) + position[1] - block.bounds.y,
        ];
      }),
      false,
    );
  }
  const widths = Array.from(
    { length: Math.max(...rows.map((row) => row.length)) },
    (_, i) => Math.max(...rows.map((row) => row[i]?.bounds.width ?? 0)),
  );
  const positions = new Map<string, Point>();
  let y = bounds.y;
  for (const row of rows) {
    let x = bounds.x;
    for (const [i, block] of row.entries()) {
      positions.set(block.id, [x - block.bounds.x, y - block.bounds.y]);
      x += widths[i] + gap;
    }
    y += Math.max(...row.map((block) => block.bounds.height)) + gap;
  }
  return moveBlocks(
    store,
    blocks,
    blocks.map((block) => positions.get(block.id)!),
  );
}

export function arrangementAvailability(
  store: CellStore,
  frameId: CellId,
  ids: readonly CellId[],
  command: ArrangementCommand,
): { enabled: boolean; reason?: string } {
  try {
    const blocks = collectArrangementBlocks(store, frameId, ids);
    if (
      command.type === 'layout' &&
      ((command.style === 'flow' &&
        frameScene(store, frameId) !== 'workflow-start') ||
        (command.style === 'layers' &&
          frameScene(store, frameId) !== 'architecture-layer'))
    )
      return { enabled: false };
    if (command.type !== 'layout')
      return {
        enabled:
          ids.length > 0 &&
          blocks.length >= (command.type === 'align' ? 2 : 3) &&
          !blocks.some((block) => block.locked),
      };
    const movable = blocks.filter((block) => !block.locked);
    if (movable.length < 2) return { enabled: false };
    if (command.style === 'flow') flowRows(store, movable);
    if (command.style === 'layers') layerRows(store, movable);
    return { enabled: true };
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

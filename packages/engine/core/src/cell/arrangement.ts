import { relationshipArrangementPositions } from './relationship-layout';
import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import {
  graphArrangementPositions,
  type ArrangementLink,
} from './arrangement-graph';
import { translateCellSelection } from './commands';
import { frameLanes } from './lanes';
import { frameScene } from './frame';
import {
  cellArrangementBounds,
  createCellHierarchy,
  groupHasLockedLeaf,
  groupLeafMembers,
  unionCellBounds,
} from './group';
import { indexCells, type CellOperation } from './index';
import { createCellRegistry, type CellRegistry } from './registry';
import {
  isDocumentCell,
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type CellId,
  type CellStore,
} from './types';

export type CellAlignment =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type CellDistribution = 'horizontal' | 'vertical';
export type CellLayoutStyle =
  'grid' | 'horizontal' | 'vertical' | 'relationships' | (string & {});
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
  registry: CellRegistry = createCellRegistry(),
): ArrangementBlock[] {
  const frame = store.cells[frameId];
  if (
    !isFrameCell(frame) ||
    registry.scenes.some(
      (scene) =>
        (scene.arrangeable === false ||
          scene.geometry?.nodeLayout === 'none') &&
        scene.anchorKinds.includes(frameScene(store, frameId, registry) ?? ''),
    )
  )
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
  const hierarchy = createCellHierarchy(store, index);
  let frameLocked = false;
  for (let id: string | undefined = frameId; id; id = index.parentOf.get(id))
    frameLocked ||= !!store.cells[id]?.locked;
  return candidates.flatMap((id) => {
    const cell = store.cells[id];
    if (
      !cell ||
      cell.hidden ||
      (!isNodeCell(cell) && !isGroupCell(cell)) ||
      registry.get(cell.kind)?.arrangeable === false ||
      registry.get(cell.kind)?.lanes?.(cell).length
    )
      return [];
    if (hierarchy.groupAncestors(id).some((owner) => selected.has(owner)))
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
          hierarchy.lockedByAncestor(id) ||
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
  registry: CellRegistry = createCellRegistry(),
  preserveMembership = false,
): CellOperation[] =>
  blocks.flatMap((block, i) => {
    const delta: Point = roundDelta
      ? [Math.round(deltas[i][0]), Math.round(deltas[i][1])]
      : deltas[i];
    return delta[0] || delta[1]
      ? translateCellSelection(store, [block.id], delta, registry, {
          preserveMembership,
        })
      : [];
  });

export function alignCells(
  store: CellStore,
  ids: readonly CellId[],
  axis: CellAlignment,
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  if (!ids.length) return [];
  const frameId = indexCells(store).parentOf.get(ids[0]);
  if (!frameId) return [];
  const blocks = collectArrangementBlocks(store, frameId, ids, registry);
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
    true,
    registry,
  );
}

export function distributeCells(
  store: CellStore,
  ids: readonly CellId[],
  axis: CellDistribution,
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  if (!ids.length) return [];
  const frameId = indexCells(store).parentOf.get(ids[0]);
  if (!frameId) return [];
  const blocks = collectArrangementBlocks(store, frameId, ids, registry);
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
  return moveBlocks(store, blocks, deltas, true, registry);
}

const stableBlocks = (blocks: ArrangementBlock[]) =>
  blocks.sort(
    (a, b) =>
      a.bounds.y - b.bounds.y ||
      a.bounds.x - b.bounds.x ||
      a.id.localeCompare(b.id),
  );

function arrangementLinks(
  store: CellStore,
  blocks: ArrangementBlock[],
  kind?: string,
): ArrangementLink[] {
  const owner = new Map(
    blocks.flatMap((block) =>
      block.members.map((id) => [id, block.id] as const),
    ),
  );
  return Object.values(store.cells).flatMap((cell) => {
    if (
      !isEdgeCell(cell) ||
      cell.hidden ||
      (kind !== undefined && cell.kind !== kind) ||
      !('cellId' in cell.source) ||
      !('cellId' in cell.target)
    )
      return [];
    const source = owner.get(cell.source.cellId),
      target = owner.get(cell.target.cellId);
    return source && target && source !== target ? [{ source, target }] : [];
  });
}

/** Explicit layouts produce authored positions and never run while rendering. */
export function arrangeCells(
  store: CellStore,
  frameId: CellId,
  ids: readonly CellId[],
  style: CellLayoutStyle,
  gap = 32,
  registry: CellRegistry = createCellRegistry(),
  spacing?: { rankGap?: number; laneInset?: number },
): CellOperation[] {
  const scene = registry.scenes.find((scene) =>
    scene.anchorKinds.includes(frameScene(store, frameId, registry) ?? ''),
  );
  const layout = scene?.layouts?.find((layout) => layout.id === style);
  if (
    !layout &&
    !['grid', 'horizontal', 'vertical', 'relationships'].includes(style)
  )
    throw new Error('Layout does not match the frame');
  const blocks = collectArrangementBlocks(store, frameId, ids, registry).filter(
    (block) =>
      !block.locked &&
      (!layout ||
        !block.members.some(
          (id) =>
            isDocumentCell(store.cells[id]) ||
            store.cells[id]?.kind === 'card' ||
            (store.cells[id]?.kind === 'geometry' &&
              (store.cells[id] as import('./types').NodeCell).geometry
                .outline === 'text'),
        )),
  );
  return [...partitionArrangement(store, frameId, blocks, registry)].flatMap(
    ([lane, partition]) =>
      arrangePartition(
        store,
        partition,
        style,
        gap,
        registry,
        layout,
        lane
          ? {
              x: lane.bounds.x + (spacing?.laneInset ?? 0),
              y: lane.bounds.y + (spacing?.laneInset ?? 0),
              width: Math.max(
                0,
                lane.bounds.width - 2 * (spacing?.laneInset ?? 0),
              ),
              height: Math.max(
                0,
                lane.bounds.height - 2 * (spacing?.laneInset ?? 0),
              ),
            }
          : undefined,
        spacing?.rankGap,
      ),
  );
}

function partitionArrangement(
  store: CellStore,
  frameId: CellId,
  blocks: ArrangementBlock[],
  registry: CellRegistry,
) {
  const lanes = frameLanes(store, frameId, registry);
  const laneOf = new Map(
    lanes.flatMap((lane) => lane.members.map((id) => [id, lane] as const)),
  );
  const partitions = new Map<
    (typeof lanes)[number] | undefined,
    ArrangementBlock[]
  >();
  for (const block of blocks) {
    const memberships = new Set(
      block.members
        .filter((id) => isNodeCell(store.cells[id]))
        .map((id) => laneOf.get(id)),
    );
    if (memberships.size > 1) throw new Error('Group crosses swimlanes');
    const lane = [...memberships][0];
    const partition = partitions.get(lane) ?? [];
    partition.push(block);
    partitions.set(lane, partition);
  }
  return partitions;
}

function arrangePartition(
  store: CellStore,
  blocks: ArrangementBlock[],
  style: CellLayoutStyle,
  gap: number,
  registry: CellRegistry,
  layout?: NonNullable<import('./registry').CellScene['layouts']>[number],
  laneBounds?: RectangleClient,
  rankGap?: number,
): CellOperation[] {
  if (layout) blocks.sort((a, b) => a.id.localeCompare(b.id));
  else stableBlocks(blocks);
  if (blocks.length < 2) return [];
  const bounds = laneBounds
    ? { ...laneBounds, x: Math.ceil(laneBounds.x), y: Math.ceil(laneBounds.y) }
    : unionCellBounds(blocks.map((block) => block.bounds))!;
  if (style === 'relationships') {
    const positions = relationshipArrangementPositions(
      blocks,
      arrangementLinks(store, blocks),
      Math.max(96, gap),
      rankGap ?? Math.max(160, gap),
    );
    return moveBlocks(
      store,
      blocks,
      blocks.map((block): Point => {
        const point = positions.get(block.id)!;
        return [
          Math.round(bounds.x) + point[0] - block.bounds.x,
          Math.round(bounds.y) + point[1] - block.bounds.y,
        ];
      }),
      false,
      registry,
      true,
    );
  }
  let rows: ArrangementBlock[][];
  if (layout) rows = layout.rows(store, blocks, registry);
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
  if (layout) {
    const positions = graphArrangementPositions(
      rows,
      arrangementLinks(store, blocks, layout.edgeKind),
      Math.max(96, gap),
      rankGap ?? Math.max(160, gap),
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
      registry,
      true,
    );
  }
  const members = new Set(blocks.flatMap((block) => block.members));
  if (
    Object.values(store.cells).some(
      (cell) =>
        isEdgeCell(cell) &&
        !cell.hidden &&
        'cellId' in cell.source &&
        'cellId' in cell.target &&
        members.has(cell.source.cellId) &&
        members.has(cell.target.cellId),
    )
  )
    gap = Math.max(gap, 96);
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
    true,
    registry,
    true,
  );
}

export function arrangementAvailability(
  store: CellStore,
  frameId: CellId,
  ids: readonly CellId[],
  command: ArrangementCommand,
  registry: CellRegistry = createCellRegistry(),
): { enabled: boolean; reason?: string } {
  try {
    const blocks = collectArrangementBlocks(store, frameId, ids, registry);
    const layout =
      command.type === 'layout'
        ? registry.scenes
            .find((scene) =>
              scene.anchorKinds.includes(
                frameScene(store, frameId, registry) ?? '',
              ),
            )
            ?.layouts?.find((layout) => layout.id === command.style)
        : undefined;
    if (
      command.type === 'layout' &&
      !layout &&
      !['grid', 'horizontal', 'vertical', 'relationships'].includes(
        command.style,
      )
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
    if (layout)
      for (const partition of partitionArrangement(
        store,
        frameId,
        movable,
        registry,
      ).values())
        layout.rows(store, partition, registry);
    return { enabled: true };
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

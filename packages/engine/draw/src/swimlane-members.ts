import {
  isNodeCell,
  lockedByAncestor,
  type Cell,
  type CellLane,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import { deriveBoardTextPlainText } from '@sue/board-common';
import type { TableCellData } from './cell-commands';
import { tableGrid } from './cell-table';

export const swimlaneCell = (
  cell: Cell | undefined,
): cell is NodeCell<TableCellData> =>
  isNodeCell(cell) && cell.kind === 'swimlane' && !!cell.data;

export function swimlaneTracks(cell: Cell): CellLane[] {
  if (!swimlaneCell(cell)) return [];
  const data = cell.data!;
  if (
    !data.laneMembers ||
    !Array.isArray(data.cells) ||
    !Array.isArray(data.rows) ||
    !Array.isArray(data.columns)
  )
    return [];
  const entries = tableGrid(cell).entries;
  return entries.flatMap(({ entry, row, column }) => {
    if (entry.role !== 'lane') return [];
    const body = entries.find(
      (candidate) =>
        candidate.entry.role === 'body' &&
        (data.direction === 'vertical'
          ? candidate.column === column
          : candidate.row === row),
    );
    if (!body) return [];
    return [
      {
        id: entry.id,
        label: entry.text
          ? deriveBoardTextPlainText(entry.text.content).trim()
          : '',
        bounds: {
          x: body.x,
          y: body.y,
          width: body.width,
          height: body.height,
        },
        members: Array.isArray(data.laneMembers?.[entry.id])
          ? data.laneMembers![entry.id]
          : [],
      },
    ];
  });
}

export function withSwimlaneMembers(
  cell: Cell,
  tracks: ReadonlyMap<string, string[]>,
): Cell {
  if (!swimlaneCell(cell)) return cell;
  return {
    ...cell,
    data: {
      ...cell.data!,
      laneMembers: {
        ...cell.data!.laneMembers,
        ...Object.fromEntries(tracks),
      },
    },
  };
}

export function remapSwimlaneMembers(
  cell: Cell,
  remap: (id: string) => string,
): Cell {
  if (!swimlaneCell(cell) || !cell.data!.laneMembers) return cell;
  return {
    ...cell,
    data: {
      ...cell.data!,
      laneMembers: Object.fromEntries(
        Object.entries(cell.data!.laneMembers).map(([id, members]) => [
          id,
          members.map(remap),
        ]),
      ),
    },
  };
}

export function normalizeSwimlaneMembers(
  before: CellStore,
  candidate: CellStore,
): CellStore {
  let cells = candidate.cells;
  const replace = (cell: Cell) => {
    if (cells === candidate.cells) cells = { ...cells };
    cells[cell.id] = cell;
  };
  for (const cell of Object.values(candidate.cells)) {
    if (!swimlaneCell(cell) || !cell.data!.laneMembers) continue;
    const previous = before.cells[cell.id];
    if (
      previous === cell &&
      Object.values(cell.data!.laneMembers).every(
        (ids) => Array.isArray(ids) && ids.every((id) => candidate.cells[id]),
      )
    )
      continue;
    const tracks = swimlaneTracks(cell);
    const oldTracks = previous ? swimlaneTracks(previous) : [];
    const oldById = new Map(oldTracks.map((track) => [track.id, track]));
    const members = Object.fromEntries(
      Object.entries(cell.data!.laneMembers).flatMap(([id, ids]) => {
        if (!Array.isArray(ids)) return [[id, ids]];
        if (!tracks.some((track) => track.id === id) && oldById.has(id))
          return [];
        return [
          [
            id,
            ids.filter(
              (member) => candidate.cells[member] || !before.cells[member],
            ),
          ],
        ];
      }),
    );
    if (JSON.stringify(members) !== JSON.stringify(cell.data!.laneMembers))
      replace({ ...cell, data: { ...cell.data!, laneMembers: members } });
    if (!previous) continue;
    for (const track of tracks) {
      const old = oldById.get(track.id);
      if (!old) continue;
      const dx = track.bounds.x - old.bounds.x,
        dy = track.bounds.y - old.bounds.y;
      if (!dx && !dy) continue;
      for (const id of track.members) {
        const node = cells[id],
          previousNode = before.cells[id];
        if (
          !old.members.includes(id) ||
          !isNodeCell(node) ||
          !isNodeCell(previousNode)
        )
          continue;
        if (
          node.geometry.x !== previousNode.geometry.x ||
          node.geometry.y !== previousNode.geometry.y
        )
          continue;
        if (node.locked || lockedByAncestor(before, id))
          throw new Error('Swimlane member is locked');
        replace({
          ...node,
          geometry: {
            ...node.geometry,
            x: node.geometry.x + dx,
            y: node.geometry.y + dy,
          },
        });
      }
    }
  }
  return cells === candidate.cells ? candidate : { ...candidate, cells };
}

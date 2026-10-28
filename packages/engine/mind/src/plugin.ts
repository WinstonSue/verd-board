import {
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  type CellPlugin,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import { registerMindCells } from './cell-utils';
import { MindKind } from './kinds';
import { mapBoardTextLinks } from '@sue/board-common';
function normalizeMindRelations(
  before: CellStore,
  store: CellStore,
): CellStore {
  const cells = { ...store.cells };
  // Summary endpoints refer to a consecutive range in the previous sibling list.
  Object.values(cells).forEach((cell) => {
    if (!isEdgeCell(cell) || cell.kind !== 'mind-summary-edge') return;
    const range = cell.data as
      { startSiblingId: string; endSiblingId: string } | undefined;
    if (!range) return;
    const oldBranches = Object.values(before.cells).filter(
      (edge): edge is EdgeCell<{ order: string }> =>
        isEdgeCell(edge) && edge.kind === 'mind-branch',
    );
    const first = oldBranches.find(
      (edge) =>
        'cellId' in edge.target && edge.target.cellId === range.startSiblingId,
    );
    if (!first || !('cellId' in first.source)) return;
    const sourceId = first.source.cellId;
    const siblings = oldBranches
      .filter(
        (edge) => 'cellId' in edge.source && edge.source.cellId === sourceId,
      )
      .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
      .flatMap((edge) => ('cellId' in edge.target ? [edge.target.cellId] : []));
    const start = siblings.indexOf(range.startSiblingId),
      end = siblings.indexOf(range.endSiblingId);
    const covered = new Set(
      siblings
        .slice(start, end + 1)
        .filter(
          (id) =>
            !!cells[id] &&
            Object.values(cells).some(
              (edge) =>
                isEdgeCell(edge) &&
                edge.kind === 'mind-branch' &&
                'cellId' in edge.source &&
                edge.source.cellId === sourceId &&
                'cellId' in edge.target &&
                edge.target.cellId === id,
            ),
        ),
    );
    const surviving = Object.values(cells)
      .filter(
        (edge): edge is EdgeCell<{ order: string }> =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.source &&
          edge.source.cellId === sourceId &&
          'cellId' in edge.target &&
          covered.has(edge.target.cellId),
      )
      .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
      .flatMap((edge) => ('cellId' in edge.target ? [edge.target.cellId] : []));
    if (!surviving.length) {
      delete cells[cell.id];
      if ('cellId' in cell.target) delete cells[cell.target.cellId];
    } else if (
      !('cellId' in cell.source) ||
      cell.source.cellId !== surviving[0] ||
      range.startSiblingId !== surviving[0] ||
      range.endSiblingId !== surviving[surviving.length - 1] ||
      Object.keys(cell.source).length !== 1 ||
      Object.keys(range).length !== 2
    )
      cells[cell.id] = {
        ...cell,
        source: { cellId: surviving[0] },
        data: {
          startSiblingId: surviving[0],
          endSiblingId: surviving[surviving.length - 1],
        },
      };
  });
  return { ...store, cells };
}
export const createMindPlugin = (): CellPlugin => ({
  id: 'mind',
  mapLinks(cell, rewriteHref) {
    if (
      !isNodeCell(cell) ||
      !['mind-root', 'mind-child', 'mind-summary'].includes(cell.kind)
    )
      return cell;
    const data = cell.data as { note?: unknown } | undefined;
    const note = mapBoardTextLinks(data?.note, rewriteHref);
    return note === data?.note ? cell : { ...cell, data: { ...data, note } };
  },
  scenes: [
    {
      id: 'mind',
      anchorKinds: ['mind-root'],
      kinds: Object.values(MindKind),
      allowGroups: false,
      preserveAnchor: true,
    },
  ],
  normalize: normalizeMindRelations,
  validate(_store, cell) {
    if (cell.kind !== 'frame-reference' || !isNodeCell(cell)) return undefined;
    const offsets = (cell.data as { mindOffsets?: unknown })?.mindOffsets;
    if (
      offsets !== undefined &&
      (typeof offsets !== 'object' ||
        offsets === null ||
        Array.isArray(offsets) ||
        Object.values(offsets).some(
          (offset) =>
            !Array.isArray(offset) ||
            offset.length !== 2 ||
            !offset.every(Number.isFinite),
        ))
    )
      return 'Invalid mind offsets';
    return undefined;
  },
  copyReferences(store, cell) {
    return cell.kind === 'mind-root' || cell.kind === 'mind-child'
      ? Object.values(store.cells).flatMap((edge) =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.source &&
          edge.source.cellId === cell.id &&
          'cellId' in edge.target
            ? [edge.id, edge.target.cellId]
            : [],
        )
      : [];
  },
  copy(store, _selected, included, visit) {
    Object.values(store.cells).forEach((edge) => {
      if (
        !isEdgeCell(edge) ||
        edge.kind !== 'mind-summary-edge' ||
        !('cellId' in edge.target)
      )
        return;
      const range = edge.data as
        { startSiblingId: string; endSiblingId: string } | undefined;
      const branch = range
        ? Object.values(store.cells).find(
            (cell) =>
              isEdgeCell(cell) &&
              cell.kind === 'mind-branch' &&
              'cellId' in cell.target &&
              cell.target.cellId === range.startSiblingId,
          )
        : undefined;
      if (
        range &&
        included.has(range.startSiblingId) &&
        included.has(range.endSiblingId) &&
        branch &&
        isEdgeCell(branch) &&
        'cellId' in branch.source &&
        included.has(branch.source.cellId)
      ) {
        visit(edge.target.cellId);
        visit(edge.id);
      }
    });
  },
  filterCopy(cell, included, cells) {
    if (isEdgeCell(cell) && cell.kind === 'mind-summary-edge') {
      const range = cell.data as
        { startSiblingId: string; endSiblingId: string } | undefined;
      return (
        !!range &&
        included.has(range.startSiblingId) &&
        included.has(range.endSiblingId)
      );
    }
    if (cell.kind === 'mind-summary')
      return Object.values(cells).some(
        (edge) =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-summary-edge' &&
          'cellId' in edge.target &&
          edge.target.cellId === cell.id,
      );
    return true;
  },
  deletionClosure(store, cell) {
    if (cell.kind !== 'mind-root' && cell.kind !== 'mind-child') return [];
    return Object.values(store.cells).flatMap((edge) =>
      isEdgeCell(edge) &&
      edge.kind === 'mind-branch' &&
      'cellId' in edge.source &&
      edge.source.cellId === cell.id &&
      'cellId' in edge.target
        ? [edge.target.cellId]
        : [],
    );
  },
  remap(cell, remap) {
    if (!isEdgeCell(cell) || cell.kind !== 'mind-summary-edge') return cell;
    const data = cell.data as { startSiblingId: string; endSiblingId: string };
    return {
      ...cell,
      data: {
        ...data,
        startSiblingId: remap(data.startSiblingId),
        endSiblingId: remap(data.endSiblingId),
      },
    };
  },
  preparePaste(cell, original, fragment) {
    if (
      isNodeCell(cell) &&
      cell.kind === 'mind-child' &&
      !Object.values(fragment.cells).some(
        (edge) =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.target &&
          edge.target.cellId === original.id,
      )
    ) {
      const data = { ...(cell.data as object) } as { collapsed?: boolean };
      delete data.collapsed;
      return {
        ...cell,
        kind: 'mind-root',
        geometry: { ...cell.geometry, derived: false },
        data,
      };
    }
    return cell;
  },
  pasteCells(cells, targetId, allocateId) {
    const nested = new Set(
      cells.flatMap((cell) => (isFrameCell(cell) ? cell.children : [])),
    );
    cells
      .filter(
        (cell) =>
          isNodeCell(cell) && cell.kind === 'mind-root' && !nested.has(cell.id),
      )
      .forEach((cell, at) => {
        if (!isNodeCell(cell)) return;
        cell.kind = 'mind-child';
        cell.geometry = { ...cell.geometry, derived: true };
        cells.push({
          id: allocateId(`paste-branch-${at}`),
          kind: 'mind-branch',
          cellType: 'edge',
          source: { cellId: targetId },
          target: { cellId: cell.id },
          route: { mode: 'auto' },
          data: { order: `paste-${cell.id}` },
        });
      });
  },
  install(registry) {
    registerMindCells({
      ...registry,
      register(util) {
        Object.assign(util, {
          groupable: false,
          arrangeable: false,
          routable: false,
          retainOnSourceDeletion: util.kind === 'mind-summary-edge',
        });
        registry.register(util);
      },
    });
  },
});

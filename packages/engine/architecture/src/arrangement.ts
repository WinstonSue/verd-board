import {
  indexCells,
  type ArrangementBlock,
  type CellRegistry,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import type { ArchitectureLayerData } from './types';
export function layerRows(
  store: CellStore,
  blocks: ArrangementBlock[],
  registry: CellRegistry,
): ArrangementBlock[][] {
  const index = indexCells(store, registry);
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

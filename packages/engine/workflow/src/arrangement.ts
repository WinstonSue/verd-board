import {
  isEdgeCell,
  type ArrangementBlock,
  type CellStore,
} from '@sue/board-core';
export function flowRows(
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
  if (visited !== blocks.length) {
    const members = new Set(blocks.flatMap((block) => block.members));
    const process = Object.values(store.cells).some(
      (cell) =>
        cell.kind === 'workflow-start' &&
        members.has(cell.id) &&
        (cell.data as { graphMode?: string })?.graphMode === 'process',
    );
    if (!process) throw new Error('Cannot arrange a cyclic grouped workflow');
    rows.push(
      blocks
        .filter((block) => !rows.flat().includes(block))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
  return rows;
}

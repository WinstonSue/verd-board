import { Fragment, type Node, type ResolvedPos } from '@tiptap/pm/model';

export const blockOrderMapping = 'verd-document-block-order';

export function operableBlock($pos: ResolvedPos) {
  if (!$pos.depth) return null;
  let depth = $pos.depth;
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'table') {
      depth = d;
      break;
    }
  }
  if ($pos.node(depth).type.name === 'detailsSummary') depth--;
  if (depth > 1 && $pos.node(depth - 1).type.name === 'listItem') depth--;
  return blockAtBoundary($pos.doc, $pos.before(depth));
}

export function blockAtBoundary(doc: Node, start: number) {
  if (!Number.isInteger(start) || start < 0 || start >= doc.content.size)
    return null;
  const $start = doc.resolve(start);
  if ($start.textOffset) return null;
  const node = $start.nodeAfter;
  if (
    !node?.isBlock ||
    [
      'tableRow',
      'tableCell',
      'tableHeader',
      'detailsSummary',
      'detailsContent',
    ].includes(node.type.name)
  )
    return null;
  return {
    start,
    node,
    parent: $start.parent,
    parentStart: $start.start(),
    index: $start.index(),
  };
}

export function planBlockOrder(doc: Node, source: number, toIndex: number) {
  const block = blockAtBoundary(doc, source);
  if (
    !block ||
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex >= block.parent.childCount ||
    toIndex === block.index
  )
    return null;
  const first = Math.min(toIndex, block.index);
  const last = Math.max(toIndex, block.index);
  let offset = block.parentStart;
  const positions: number[] = [];
  const children: Node[] = [];
  block.parent.forEach((child, _, index) => {
    if (index >= first && index <= last) {
      positions.push(offset);
      children.push(child);
    }
    offset += child.nodeSize;
  });
  const from = positions[0];
  const to = positions.at(-1)! + children.at(-1)!.nodeSize;
  const original = children.map((node, i) => ({ node, at: positions[i] }));
  const reordered = [...original];
  const [moved] = reordered.splice(block.index - first, 1);
  reordered.splice(toIndex - first, 0, moved);
  const content = Fragment.fromArray(reordered.map(({ node }) => node));
  if (!block.parent.canReplace(first, last + 1, content)) return null;
  let next = from;
  const positionsAfter = reordered.map(({ node, at }) => {
    const entry = { from: at, to: next, size: node.nodeSize };
    next += node.nodeSize;
    return entry;
  });
  return {
    from,
    to,
    content,
    positionsAfter,
    movedTo: positionsAfter[toIndex - first].to,
  };
}

export type BlockOrderMapping = NonNullable<
  ReturnType<typeof planBlockOrder>
>['positionsAfter'];

export function mappedBlockOrderPosition(
  mapping: BlockOrderMapping,
  pos: number,
) {
  const moved = mapping.find(
    ({ from, size }) => pos >= from && pos < from + size,
  );
  return moved ? moved.to + pos - moved.from : pos;
}

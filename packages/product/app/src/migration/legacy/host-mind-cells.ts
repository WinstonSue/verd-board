import {
  CellKind,
  createCellStore,
  createFrameCell,
  type Cell,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import {
  type LegacyMindHostNode,
  type MindDocument,
} from './host-mind-document';

const ROOT_ID = 'mind-host-frame';

const append = (
  cells: Record<string, Cell>,
  children: string[],
  node: LegacyMindHostNode,
  depth: number,
) => {
  children.push(node.id);
  cells[node.id] = {
    id: node.id,
    kind: depth === 0 ? CellKind.mindRoot : CellKind.mindChild,
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 0, height: 0, derived: depth > 0 },
    content: { label: node.label },
    data: { label: node.label },
  };
  node.children.forEach((child, index) => {
    append(cells, children, child, depth + 1);
    const branch: EdgeCell<{ order: string }> = {
      id: `branch:${node.id}:${child.id}:${index}`,
      kind: CellKind.mindBranch,
      cellType: 'edge',
      source: { cellId: node.id },
      target: { cellId: child.id },
      route: { mode: 'auto' },
      data: { order: String(index).padStart(4, '0') },
    };
    cells[branch.id] = branch;
    children.push(branch.id);
  });
};

export const legacyMindToStore = (document: MindDocument): CellStore => {
  const cells: Record<string, Cell> = {};
  const children: string[] = [];
  document.roots.forEach((root) => append(cells, children, root, 0));
  const frame = createFrameCell(ROOT_ID);
  frame.children = children;
  return { ...createCellStore(frame), cells: { ...cells, [ROOT_ID]: frame } };
};

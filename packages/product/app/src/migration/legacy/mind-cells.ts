import {
  CellKind,
  createCellStore,
  createFrameCell,
  type Cell,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import type { MindElement } from './mind-element';
import { type MindDocument } from './mind-document';

const ROOT_ID = 'mind-root-frame';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const kindFor = (element: MindElement, depth: number) => {
  if (depth === 0 || element.type === 'mind') {
    return CellKind.mindRoot;
  }
  if (typeof element.start === 'number' && typeof element.end === 'number') {
    return CellKind.mindSummary;
  }
  return CellKind.mindChild;
};

const edgeId = (parentId: string, childId: string, index: number) =>
  `branch:${parentId}:${childId}:${index}`;

const appendTree = (
  cells: Record<string, Cell>,
  children: string[],
  element: MindElement,
  depth: number,
) => {
  const { children: nested = [], ...rest } = clone(element);
  const id = element.id;
  children.push(id);
  cells[id] = {
    id,
    kind: kindFor(element, depth),
    cellType: 'node',
    geometry: {
      x: element.points?.[0]?.[0] ?? 0,
      y: element.points?.[0]?.[1] ?? 0,
      width: 0,
      height: 0,
      derived: depth > 0,
    },
    content: { label: '' },
    data: { element: rest as Omit<MindElement, 'children'> },
  };
  nested.forEach((child, index) => {
    appendTree(cells, children, child, depth + 1);
    const branch: EdgeCell<{ order: string }> = {
      id: edgeId(id, child.id, index),
      kind: CellKind.mindBranch,
      cellType: 'edge',
      source: { cellId: id },
      target: { cellId: child.id },
      route: { mode: 'auto' },
      data: { order: String(index).padStart(4, '0') },
    };
    cells[branch.id] = branch;
    children.push(branch.id);
    if (typeof child.start === 'number' && typeof child.end === 'number') {
      const startSibling = nested[child.start];
      const endSibling = nested[child.end];
      if (startSibling && endSibling) {
        const summary: EdgeCell<{
          startSiblingId: string;
          endSiblingId: string;
        }> = {
          id: `summary:${id}:${child.id}`,
          kind: CellKind.mindSummaryEdge,
          cellType: 'edge',
          source: { cellId: startSibling.id },
          target: { cellId: child.id },
          route: { mode: 'auto' },
          data: {
            startSiblingId: startSibling.id,
            endSiblingId: endSibling.id,
          },
        };
        cells[summary.id] = summary;
        children.push(summary.id);
      }
    }
  });
};

export const mindDocumentToStore = (document: MindDocument): CellStore => {
  const cells: Record<string, Cell> = {};
  const children: string[] = [];
  appendTree(cells, children, document.root, 0);
  document.roots?.forEach((center) => {
    appendTree(cells, children, center, 0);
  });
  const root = createFrameCell(ROOT_ID);
  root.children = children;
  return { ...createCellStore(root), cells: { ...cells, [ROOT_ID]: root } };
};

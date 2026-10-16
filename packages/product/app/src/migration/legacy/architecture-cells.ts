import {
  CellKind,
  createCellStore,
  createFrameCell,
  type Cell,
  type CellStore,
  type EdgeCell,
} from '@sue/board-core';
import {
  type ArchitectureDocument,
  type ArchitectureNodeKind,
} from './architecture-document';

const ROOT_ID = 'architecture-root';

const MODULE_SIZE: Record<
  ArchitectureNodeKind,
  { width: number; height: number }
> = {
  box: { width: 240, height: 44 },
  decision: { width: 160, height: 88 },
  store: { width: 160, height: 88 },
};

const outlineFor = (kind: ArchitectureNodeKind) => {
  if (kind === 'decision') {
    return { kind: 'diamond' as const };
  }
  if (kind === 'store') {
    return { kind: 'store' as const };
  }
  return { kind: 'roundRectangle' as const, radius: 8 };
};

/**
 * 层是锚点节点：成员 id 记在层上，模块本身不记录所属层。
 * 边只连接模块。空文档得到一个没有层的 Frame，调用方决定是否补一层。
 */
export const architectureDocumentToStore = (
  document: ArchitectureDocument,
): CellStore => {
  const cells: Record<string, Cell> = {};
  const children: string[] = [];
  document.layers.forEach((layer, index) => {
    const memberIds = layer.nodes.map((node) => node.id);
    children.push(layer.id);
    cells[layer.id] = {
      id: layer.id,
      kind: CellKind.architectureLayer,
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 0, height: 0, derived: true },
      content: { label: layer.label },
      data: { order: String(index).padStart(4, '0'), memberIds },
    };
    layer.nodes.forEach((node) => {
      const size = MODULE_SIZE[node.kind];
      children.push(node.id);
      cells[node.id] = {
        id: node.id,
        kind: CellKind.architectureModule,
        cellType: 'node',
        geometry: {
          x: node.position?.x ?? 0,
          y: node.position?.y ?? 0,
          width: size.width,
          height: size.height,
          derived: !node.position,
          outline: outlineFor(node.kind),
        },
        content: { label: node.label },
        data: { shape: node.kind, placed: !!node.position },
      };
    });
  });
  document.edges.forEach((edge) => {
    children.push(edge.id);
    const cell: EdgeCell = {
      id: edge.id,
      kind: CellKind.architectureEdge,
      cellType: 'edge',
      source: { cellId: edge.source },
      target: { cellId: edge.target },
      route: { mode: 'orthogonal' },
      ...(edge.label ? { labels: [{ text: edge.label }] } : {}),
    };
    cells[edge.id] = cell;
  });
  const root = createFrameCell(ROOT_ID);
  root.children = children;
  return { ...createCellStore(root), cells: { ...cells, [ROOT_ID]: root } };
};

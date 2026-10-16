import {
  CellKind,
  createCellStore,
  createFrameCell,
  type Cell,
  type CellStore,
  type EdgeCell,
  type Point,
} from '@sue/board-core';
import {
  WORKFLOW_START_KEY,
  resolveWorkflowGraphMode,
  type WorkflowDocument,
  type WorkflowDocumentEdge,
  type WorkflowDocumentNode,
  type WorkflowGraphMode,
} from './workflow-document';

const ROOT_ID = 'workflow-root';

const cellIdFor = (graphId: string | undefined, key: string) =>
  graphId ? `${graphId}:${key}` : key;

const pointOf = (value: Point | undefined, fallback: Point): Point =>
  value ?? fallback;

const pushNode = (
  cells: Record<string, Cell>,
  children: string[],
  graphId: string | undefined,
  node: WorkflowDocumentNode,
  position: Point | undefined,
) => {
  const id = cellIdFor(graphId, node.key);
  children.push(id);
  cells[id] = {
    id,
    kind:
      node.kind === 'decision'
        ? CellKind.workflowDecision
        : CellKind.workflowTask,
    cellType: 'node',
    geometry: {
      x: position?.[0] ?? 0,
      y: position?.[1] ?? 0,
      width: node.kind === 'decision' ? 120 : 160,
      height: node.kind === 'decision' ? 80 : 48,
      derived: !position,
    },
    content: { label: node.label },
    data: { kind: node.kind },
  };
};

const pushEdge = (
  cells: Record<string, Cell>,
  children: string[],
  graphId: string | undefined,
  edge: WorkflowDocumentEdge,
) => {
  const id = cellIdFor(graphId, edge.key);
  children.push(id);
  const cell: EdgeCell = {
    id,
    kind: CellKind.workflowEdge,
    cellType: 'edge',
    source: {
      cellId: cellIdFor(graphId, edge.source.nodeKey),
      portId: edge.source.portId,
    },
    target: {
      cellId: cellIdFor(graphId, edge.target.nodeKey),
      portId: edge.target.portId,
    },
    route:
      edge.routing === 'fixed'
        ? { mode: 'fixed', points: [] }
        : { mode: 'auto' },
    ...(edge.label ? { labels: [{ text: edge.label }] } : {}),
    data: edge.routing ? { routing: edge.routing } : undefined,
  };
  cells[id] = cell;
};

const pushGraph = (
  cells: Record<string, Cell>,
  children: string[],
  graph: {
    id?: string;
    graphMode: WorkflowGraphMode;
    startLabel: string;
    nodes: WorkflowDocumentNode[];
    edges: WorkflowDocumentEdge[];
    positions: Record<string, Point>;
    origin: Point;
  },
) => {
  const startId = cellIdFor(graph.id, WORKFLOW_START_KEY);
  const memberIds = [
    startId,
    ...graph.nodes.map((node) => cellIdFor(graph.id, node.key)),
  ];
  const startPosition = pointOf(
    graph.positions[WORKFLOW_START_KEY],
    graph.origin,
  );
  children.push(startId);
  cells[startId] = {
    id: startId,
    kind: CellKind.workflowStart,
    cellType: 'node',
    geometry: {
      x: startPosition[0],
      y: startPosition[1],
      width: 120,
      height: 40,
    },
    content: { label: graph.startLabel },
    data: {
      graphMode: resolveWorkflowGraphMode(graph.graphMode),
      origin: graph.origin,
      memberIds,
      label: graph.startLabel,
    },
  };
  graph.nodes.forEach((node) => {
    pushNode(cells, children, graph.id, node, graph.positions[node.key]);
  });
  graph.edges.forEach((edge) => {
    pushEdge(cells, children, graph.id, edge);
  });
};

/** 每张图的模式、原点和成员挂在开始事件上。主图不带 id 前缀。 */
export const workflowDocumentToStore = (
  document: WorkflowDocument,
): CellStore => {
  const cells: Record<string, Cell> = {};
  const children: string[] = [];
  pushGraph(cells, children, {
    graphMode: document.graphMode,
    startLabel: document.start.label,
    nodes: document.nodes,
    edges: document.edges,
    positions: document.layout.positions,
    origin: [0, 0],
  });
  document.graphs?.forEach((graph) => {
    pushGraph(cells, children, {
      id: graph.id,
      graphMode: graph.graphMode,
      startLabel: graph.start.label,
      nodes: graph.nodes,
      edges: graph.edges,
      positions: graph.layout.positions,
      origin: graph.origin,
    });
  });
  const root = createFrameCell(ROOT_ID);
  root.children = children;
  return { ...createCellStore(root), cells: { ...cells, [ROOT_ID]: root } };
};

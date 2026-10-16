import type { BoardTheme, Point, Viewport } from '@sue/board-core';
type WorkflowEdgeRouting = 'auto' | 'fixed';

export const WORKFLOW_DOCUMENT_VERSION = 1 as const;
export const WORKFLOW_START_KEY = '__start__';
export const WORKFLOW_GRAPH_MODES = ['dag', 'process'] as const;
export const DEFAULT_WORKFLOW_GRAPH_MODE = 'dag' as const;

export const WORKFLOW_NODE_KINDS = ['task', 'decision'] as const;

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];
export type WorkflowGraphMode = (typeof WORKFLOW_GRAPH_MODES)[number];

export interface WorkflowDocumentNode {
  key: string;
  kind: WorkflowNodeKind;
  label: string;
}

export interface WorkflowDocumentEndpoint {
  nodeKey: string;
  portId: string;
}

export interface WorkflowDocumentEdge {
  key: string;
  source: WorkflowDocumentEndpoint;
  target: WorkflowDocumentEndpoint;
  label?: string;
  routing?: WorkflowEdgeRouting;
}

export interface WorkflowDocumentStart {
  label: string;
}

/** One flowchart on the exclusive canvas. The document fields are graph 0. */
export interface WorkflowDocumentGraph {
  id: string;
  graphMode: WorkflowGraphMode;
  start: WorkflowDocumentStart;
  nodes: WorkflowDocumentNode[];
  edges: WorkflowDocumentEdge[];
  layout: { positions: Record<string, Point> };
  /** Top-left of this graph in the shared content space. */
  origin: Point;
}

export interface WorkflowDocument {
  version: typeof WORKFLOW_DOCUMENT_VERSION;
  graphMode: WorkflowGraphMode;
  start: WorkflowDocumentStart;
  nodes: WorkflowDocumentNode[];
  edges: WorkflowDocumentEdge[];
  layout: { positions: Record<string, Point> };
  /** Flowcharts after the first. Edges never cross graphs. */
  graphs?: WorkflowDocumentGraph[];
  viewport?: Viewport;
  theme?: BoardTheme;
}

export const createDefaultWorkflowDocument = (): WorkflowDocument => ({
  version: WORKFLOW_DOCUMENT_VERSION,
  graphMode: DEFAULT_WORKFLOW_GRAPH_MODE,
  start: { label: 'Start' },
  nodes: [],
  edges: [],
  layout: {
    positions: {
      [WORKFLOW_START_KEY]: [40, 80],
    },
  },
});

export const isWorkflowNodeKind = (value: unknown): value is WorkflowNodeKind =>
  typeof value === 'string' &&
  (WORKFLOW_NODE_KINDS as readonly string[]).includes(value);

export const isWorkflowGraphMode = (
  value: unknown,
): value is WorkflowGraphMode =>
  typeof value === 'string' &&
  (WORKFLOW_GRAPH_MODES as readonly string[]).includes(value);

export const resolveWorkflowGraphMode = (value: unknown): WorkflowGraphMode =>
  isWorkflowGraphMode(value) ? value : DEFAULT_WORKFLOW_GRAPH_MODE;

const isEndpoint = (value: unknown): value is WorkflowDocumentEndpoint => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as WorkflowDocumentEndpoint;
  return (
    typeof candidate.nodeKey === 'string' &&
    typeof candidate.portId === 'string'
  );
};

const isPoint = (value: unknown): value is Point =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number';

export const isWorkflowDocument = (
  value: unknown,
): value is WorkflowDocument => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<WorkflowDocument>;
  if (candidate.version !== WORKFLOW_DOCUMENT_VERSION) {
    return false;
  }
  if (!candidate.start || typeof candidate.start.label !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return false;
  }
  const nodesValid = candidate.nodes.every(
    (node) =>
      node &&
      typeof node.key === 'string' &&
      isWorkflowNodeKind(node.kind) &&
      typeof node.label === 'string',
  );
  const edgesValid = candidate.edges.every(
    (edge) =>
      edge &&
      typeof edge.key === 'string' &&
      isEndpoint(edge.source) &&
      isEndpoint(edge.target) &&
      (edge.label === undefined || typeof edge.label === 'string') &&
      (edge.routing === undefined ||
        edge.routing === 'auto' ||
        edge.routing === 'fixed'),
  );
  if (!nodesValid || !edgesValid) {
    return false;
  }
  const positions = candidate.layout?.positions;
  if (!positions || typeof positions !== 'object') {
    return false;
  }
  if (
    candidate.graphMode !== undefined &&
    !isWorkflowGraphMode(candidate.graphMode)
  ) {
    return false;
  }
  if (!Object.values(positions).every(isPoint)) {
    return false;
  }
  if (candidate.graphs === undefined) {
    return true;
  }
  return (
    Array.isArray(candidate.graphs) &&
    candidate.graphs.every((graph) => isWorkflowGraph(graph))
  );
};

const isWorkflowGraph = (value: unknown): value is WorkflowDocumentGraph => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const graph = value as Partial<WorkflowDocumentGraph>;
  if (typeof graph.id !== 'string' || !graph.id || graph.id.includes(':')) {
    return false;
  }
  if (!graph.start || typeof graph.start.label !== 'string') {
    return false;
  }
  if (graph.graphMode !== undefined && !isWorkflowGraphMode(graph.graphMode)) {
    return false;
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return false;
  }
  if (!isPoint(graph.origin)) {
    return false;
  }
  const nodesValid = graph.nodes.every(
    (node) =>
      node &&
      typeof node.key === 'string' &&
      isWorkflowNodeKind(node.kind) &&
      typeof node.label === 'string',
  );
  const edgesValid = graph.edges.every(
    (edge) =>
      edge &&
      typeof edge.key === 'string' &&
      isEndpoint(edge.source) &&
      isEndpoint(edge.target),
  );
  const positions = graph.layout?.positions;
  if (!positions || typeof positions !== 'object') {
    return false;
  }
  return nodesValid && edgesValid && Object.values(positions).every(isPoint);
};

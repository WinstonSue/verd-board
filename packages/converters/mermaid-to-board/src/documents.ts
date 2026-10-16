import {
  CellKind,
  createFrameCell,
  createCellRegistry,
  isFrameCell,
  isNodeCell,
  isEdgeCell,
  validateCellStore,
  type Cell,
  type FrameSnapshot,
  type NodeCell,
  type ArchitectureLayerData,
  type WorkflowStartData,
  type Point,
} from '@sue/board-core';
import {
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  registerArchitectureCells,
} from '@sue/board-architecture';
import {
  createWorkflowStartCell,
  createWorkflowTaskCell,
  registerWorkflowCells,
} from '@sue/board-workflow';
import type { Flowchart } from './parser/flowchart.js';

export const MERMAID_LOSSY_FIELDS = [
  'style',
  'richText',
  'viewport',
  'theme',
] as const;
const DEFAULT_LAYER_ID = 'default';
const DEFAULT_LAYER_LABEL = 'Default';

type NodeShape = 'box' | 'decision' | 'store' | 'stadium';

interface ParsedNode {
  id: string;
  label: string;
  shape: NodeShape;
  layerId: string;
}

interface ParsedLayer {
  id: string;
  label: string;
}

interface ParsedEdge {
  source: string;
  target: string;
  label?: string;
}

export interface FlowchartModel {
  layers: ParsedLayer[];
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  positions: Record<string, { x: number; y: number }>;
  meta: VerdMeta;
  edgeMeta: Array<{
    source: string;
    target: string;
    key?: string;
    sourcePort?: string;
    targetPort?: string;
  }>;
}

interface VerdMeta {
  frameId?: string;
  cellIds?: Record<string, string>;
  graphs?: {
    start: string;
    members: string[];
    mode: 'dag' | 'process';
    origin: [number, number];
  }[];
  positions?: Record<string, { x: number; y: number }>;
  edges?: Array<{
    source: string;
    target: string;
    key?: string;
    sourcePort?: string;
    targetPort?: string;
  }>;
}

const unquote = (value: string) => {
  const text = value.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  return text;
};

const quote = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const parseNodeToken = (
  token: string,
): { id: string; label?: string; shape?: NodeShape } | undefined => {
  const match = token.trim().match(/^([A-Za-z_][\w-]*)(.*)$/);
  if (!match) {
    return undefined;
  }
  const id = match[1];
  const rest = match[2].trim();
  if (!rest) {
    return { id };
  }
  if (rest.startsWith('[(') && rest.endsWith(')]')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'store' };
  }
  if (rest.startsWith('([') && rest.endsWith('])')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'stadium' };
  }
  if (rest.startsWith('{') && rest.endsWith('}')) {
    return { id, label: unquote(rest.slice(1, -1)), shape: 'decision' };
  }
  if (rest.startsWith('[') && rest.endsWith(']')) {
    return { id, label: unquote(rest.slice(1, -1)), shape: 'box' };
  }
  if (rest.startsWith('(') && rest.endsWith(')')) {
    return { id, label: unquote(rest.slice(1, -1)), shape: 'stadium' };
  }
  return { id };
};

const rememberNode = (
  model: FlowchartModel,
  token: string | undefined,
  layerId: string,
) => {
  if (!token) {
    return;
  }
  const parsed = parseNodeToken(token);
  if (!parsed) {
    return;
  }
  const existing = model.nodes.find((node) => node.id === parsed.id);
  if (existing) {
    if (parsed.label !== undefined) {
      existing.label = parsed.label;
    }
    if (parsed.shape) {
      existing.shape = parsed.shape;
    }
    return;
  }
  model.nodes.push({
    id: parsed.id,
    label: parsed.label ?? parsed.id,
    shape: parsed.shape ?? 'box',
    layerId,
  });
};

export const parseFlowchart = (definition: string): FlowchartModel => {
  const model: FlowchartModel = {
    layers: [],
    nodes: [],
    edges: [],
    positions: {},
    edgeMeta: [],
    meta: {},
  };
  const layerStack: string[] = [];
  definition.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('flowchart') || line.startsWith('graph ')) {
      return;
    }
    if (line.startsWith('%% verd:')) {
      const meta = JSON.parse(line.slice('%% verd:'.length)) as VerdMeta;
      Object.entries(meta.positions ?? {}).forEach(([id, point]) => {
        model.positions[id] = { x: point.x, y: point.y };
      });
      model.edgeMeta.push(...(meta.edges ?? []));
      model.meta = { ...model.meta, ...meta };
      return;
    }
    if (line.startsWith('%%')) {
      return;
    }
    if (line.startsWith('subgraph')) {
      const match = line.match(/^subgraph\s+([A-Za-z_][\w-]*)(?:\s*\[(.*)\])?/);
      const id = match?.[1] ?? `layer-${model.layers.length + 1}`;
      const label = match?.[2] ? unquote(match[2]) : id;
      model.layers.push({ id, label });
      layerStack.push(id);
      return;
    }
    if (line === 'end') {
      layerStack.pop();
      return;
    }
    const layerId = layerStack[layerStack.length - 1] ?? DEFAULT_LAYER_ID;
    const arrow = line.match(/^(.*?)\s*(-->|-\.->)(?:\|([^|]*)\|)?\s*(.*)$/);
    if (arrow) {
      const source = arrow[1].trim();
      const target = arrow[4].trim();
      rememberNode(model, source, layerId);
      rememberNode(model, target, layerId);
      const sourceId = parseNodeToken(source)?.id;
      const targetId = parseNodeToken(target)?.id;
      if (sourceId && targetId) {
        model.edges.push({
          source: sourceId,
          target: targetId,
          ...(arrow[3] ? { label: unquote(arrow[3]) } : {}),
        });
      }
      return;
    }
    line
      .split(/\s+&\s+/)
      .forEach((token) => rememberNode(model, token, layerId));
  });
  if (
    model.nodes.some((node) => node.layerId === DEFAULT_LAYER_ID) &&
    !model.layers.some((layer) => layer.id === DEFAULT_LAYER_ID)
  ) {
    model.layers.push({ id: DEFAULT_LAYER_ID, label: DEFAULT_LAYER_LABEL });
  }
  return model;
};

export interface DomainFrameImportConfig {
  graphMode?: 'dag' | 'process';
}
const nativeSnapshot = (
  model: FlowchartModel,
  scene: 'workflow' | 'architecture',
  config: DomainFrameImportConfig = {},
): FrameSnapshot => {
  const frame = createFrameCell(model.meta.frameId ?? 'mermaid:frame');
  const cells: Record<string, Cell> = { [frame.id]: frame };
  const ids = new Map<string, string>();
  const idFor = (category: string, key: string) => {
    const prefix =
      model.meta.cellIds?.[key] ??
      (category === 'edge' && model.meta.frameId
        ? key
        : `mermaid:${category}:${encodeURIComponent(key)}`);
    let id = prefix,
      suffix = 0;
    while (cells[id]) id = `${prefix}:${++suffix}`;
    return id;
  };
  const add = (cell: Cell, key?: string) => {
    cells[cell.id] = cell;
    frame.children.push(cell.id);
    if (key) ids.set(key, cell.id);
  };
  if (scene === 'architecture') {
    const layers = model.layers.length
      ? model.layers
      : [{ id: DEFAULT_LAYER_ID, label: DEFAULT_LAYER_LABEL }];
    for (const [at, layer] of layers.entries()) {
      const cell = createArchitectureLayerCell(
        idFor('layer', layer.id),
        String(at).padStart(8, '0'),
      );
      cell.content = { label: layer.label };
      add(cell, layer.id);
      for (const item of model.nodes.filter(
        (node) => node.layerId === layer.id,
      )) {
        const shape =
          item.shape === 'decision'
            ? 'decision'
            : item.shape === 'store'
              ? 'store'
              : 'box';
        const node = createArchitectureModuleCell(
          idFor('module', item.id),
          shape,
        );
        node.content = { label: item.label };
        const position = model.positions[item.id];
        if (position) {
          node.geometry = { ...node.geometry, ...position, derived: false };
          node.data = { shape, placed: true };
        }
        add(node, item.id);
        cell.data!.memberIds.push(node.id);
      }
    }
  } else {
    const first =
      model.nodes.find((node) => node.id === 'start') ??
      model.nodes.find((node) => node.shape === 'stadium');
    const graphs = model.meta.graphs ?? [
      {
        start: first?.id ?? 'start',
        members: model.nodes.map((node) => node.id),
        mode: config.graphMode ?? 'dag',
        origin: [40, 80] as Point,
      },
    ];
    const assigned = new Set<string>();
    for (const graph of graphs) {
      const item = model.nodes.find((node) => node.id === graph.start);
      const origin = model.positions[graph.start];
      const start = createWorkflowStartCell(
        idFor('start', graph.start),
        origin ? [origin.x, origin.y] : graph.origin,
      );
      start.content = { label: item?.label ?? 'Start' };
      start.data!.graphMode = graph.mode;
      add(start, graph.start);
      assigned.add(graph.start);
      for (const [at, member] of graph.members.entries()) {
        if (member === graph.start) continue;
        const item = model.nodes.find((node) => node.id === member);
        if (!item) throw new Error(`Unknown workflow member: ${member}`);
        if (assigned.has(member))
          throw new Error(
            `Workflow member belongs to multiple graphs: ${member}`,
          );
        const node = createWorkflowTaskCell(
          idFor('node', member),
          item.shape === 'decision',
        );
        const position = model.positions[member];
        node.geometry = {
          ...node.geometry,
          x: position?.x ?? graph.origin[0] + (at + 1) * 200,
          y: position?.y ?? graph.origin[1],
          derived: false,
        };
        node.content = { label: item.label };
        add(node, member);
        start.data!.memberIds.push(node.id);
        assigned.add(member);
      }
    }
    if (model.nodes.some((node) => !assigned.has(node.id)))
      throw new Error('Workflow graph metadata omits nodes');
  }
  for (const [at, edge] of model.edges.entries()) {
    const source = ids.get(edge.source),
      target = ids.get(edge.target);
    if (!source || !target)
      throw new Error('Mermaid edge references a missing node');
    const meta = model.edgeMeta[at];
    const port = (id: string | undefined, fallback: string) =>
      id === 'out' ? 'right' : id === 'in' ? 'left' : (id ?? fallback);
    const id = idFor('edge', meta?.key ?? `edge-${at + 1}`);
    add({
      id,
      kind:
        scene === 'architecture'
          ? CellKind.architectureEdge
          : CellKind.workflowEdge,
      cellType: 'edge',
      source: {
        cellId: source,
        ...(scene === 'workflow'
          ? { portId: port(meta?.sourcePort, 'right') }
          : {}),
      },
      target: {
        cellId: target,
        ...(scene === 'workflow'
          ? { portId: port(meta?.targetPort, 'left') }
          : {}),
      },
      route: { mode: 'orthogonal' },
      labels: edge.label !== undefined ? [{ text: edge.label }] : [],
    });
  }
  const registry = createCellRegistry();
  registerArchitectureCells(registry);
  registerWorkflowCells(registry);
  const issues = validateCellStore({ rootId: frame.id, cells }, registry);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '));
  return { store: { rootId: frame.id, cells } };
};
export const parseMermaidToArchitectureFrame = (
  definition: string,
): FrameSnapshot => nativeSnapshot(parseFlowchart(definition), 'architecture');
export const parseMermaidToWorkflowFrame = (
  definition: string,
  config: DomainFrameImportConfig = {},
): FrameSnapshot =>
  nativeSnapshot(parseFlowchart(definition), 'workflow', config);

/** Use Mermaid's full parser for imports; the text metadata supplies stable ids and graph ownership. */
export const flowchartToDomainFrame = (
  graph: Flowchart,
  scene: 'workflow' | 'architecture',
  definition: string,
  config: DomainFrameImportConfig = {},
): FrameSnapshot => {
  const parsed = parseFlowchart(definition);
  const layerOf = new Map<string, string>();
  for (const layer of graph.subGraphs)
    for (const id of layer.nodeIds) layerOf.set(id, layer.id);
  const nodes = Object.values(graph.vertices).filter(
    (node): node is NonNullable<typeof node> => !!node,
  );
  const model: FlowchartModel = {
    layers: graph.subGraphs.map((layer) => ({
      id: layer.id,
      label: layer.text,
    })),
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.text,
      shape:
        node.type === 'diamond'
          ? 'decision'
          : node.type === 'stadium'
            ? 'stadium'
            : String(node.type) === 'cylinder'
              ? 'store'
              : 'box',
      layerId: layerOf.get(node.id) ?? DEFAULT_LAYER_ID,
    })),
    edges: graph.edges.map((edge) => ({
      source: edge.start,
      target: edge.end,
      ...(edge.text ? { label: edge.text } : {}),
    })),
    positions: {
      ...Object.fromEntries(
        nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      ),
      ...parsed.positions,
    },
    edgeMeta: parsed.edgeMeta,
    meta: parsed.meta,
  };
  if (
    model.nodes.some((node) => node.layerId === DEFAULT_LAYER_ID) &&
    !model.layers.some((layer) => layer.id === DEFAULT_LAYER_ID)
  )
    model.layers.push({ id: DEFAULT_LAYER_ID, label: DEFAULT_LAYER_LABEL });
  // A node repeated in an enclosing subgraph is owned by the innermost layer.
  return nativeSnapshot(model, scene, config);
};

const assertMermaidExpressible = (snapshot: FrameSnapshot, frameId: string) => {
  const frame = snapshot.store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing Frame');
  if (frame.groups.length)
    throw new Error('Mermaid cannot express groups. Export JSON instead.');
  for (const id of [...frame.children, ...frame.groups]) {
    const cell = snapshot.store.cells[id];
    if (!cell) continue;
    if (isFrameCell(cell) || cell.cellType === 'group')
      throw new Error(
        'Mermaid cannot express nested frames or groups. Export JSON instead.',
      );
    if (
      cell.kind.startsWith('mind-') ||
      cell.kind === 'mind-root' ||
      cell.kind === 'mind-child'
    )
      throw new Error('Mermaid cannot express mind maps. Export JSON instead.');
  }
};
export const serializeFrameToMermaid = (
  snapshot: FrameSnapshot,
  frameId = snapshot.store.rootId,
): string => {
  const frame = snapshot.store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing Frame');
  assertMermaidExpressible(snapshot, frameId);
  const nodes = frame.children
    .map((id) => snapshot.store.cells[id])
    .filter(isNodeCell);
  const edges = frame.children
    .map((id) => snapshot.store.cells[id])
    .filter(isEdgeCell);
  const layers = nodes.filter(
    (node) => node.kind === CellKind.architectureLayer,
  );
  const starts = nodes.filter((node) => node.kind === CellKind.workflowStart);
  const aliases = new Map<string, string>();
  const meta: VerdMeta = { frameId, cellIds: {}, positions: {}, edges: [] };
  for (const [at, node] of nodes.entries()) {
    const alias = `n${at}`;
    aliases.set(node.id, alias);
    meta.cellIds![alias] = node.id;
    if (!node.geometry.derived)
      meta.positions![alias] = { x: node.geometry.x, y: node.geometry.y };
  }
  const lines = ['flowchart LR'];
  const write = (node: NodeCell, indent = '  ') => {
    const geometry = node.geometry.outline;
    const outline = typeof geometry === 'string' ? geometry : geometry?.kind;
    const shape: NodeShape =
      node.kind === CellKind.workflowStart
        ? 'stadium'
        : outline === 'diamond'
          ? 'decision'
          : outline === 'store'
            ? 'store'
            : 'box';
    lines.push(
      `${indent}${nodeSyntax(aliases.get(node.id)!, node.content?.label ?? '', shape)}`,
    );
  };
  if (layers.length) {
    lines[0] = 'flowchart TB';
    for (const layer of layers) {
      lines.push(
        `  subgraph ${aliases.get(layer.id)} [${quote(layer.content?.label ?? '')}]`,
      );
      for (const id of (layer.data as ArchitectureLayerData).memberIds) {
        const node = snapshot.store.cells[id];
        if (!isNodeCell(node)) throw new Error('Missing architecture module');
        write(node, '    ');
      }
      lines.push('  end');
    }
  } else {
    if (
      nodes.some(
        (node) => node.cellType === 'frame' || node.kind.startsWith('mind-'),
      )
    )
      throw new Error('This Frame cannot be exported as a Mermaid flowchart');
    nodes.forEach((node) => write(node));
    if (starts.length)
      meta.graphs = starts.map((start) => {
        const data = start.data as WorkflowStartData;
        return {
          start: aliases.get(start.id)!,
          members: data.memberIds.map((id) => aliases.get(id)!),
          mode: data.graphMode,
          origin: data.origin,
        };
      });
  }
  for (const edge of edges) {
    if (!('cellId' in edge.source) || !('cellId' in edge.target))
      throw new Error('Mermaid cannot export free arrow endpoints');
    const source = aliases.get(edge.source.cellId)!,
      target = aliases.get(edge.target.cellId)!;
    const label = edge.labels?.[0]?.text;
    lines.push(
      label
        ? `  ${source} -->|${quote(label)}| ${target}`
        : `  ${source} --> ${target}`,
    );
    meta.edges!.push({
      source,
      target,
      key: edge.id,
      sourcePort: edge.source.portId,
      targetPort: edge.target.portId,
    });
  }
  lines.splice(1, 0, `%% verd:${JSON.stringify(meta)}`);
  return `${lines.join('\n')}\n`;
};

const nodeSyntax = (id: string, label: string, shape: NodeShape) => {
  const text = quote(label);
  if (shape === 'decision') return `${id}{${text}}`;
  if (shape === 'store') return `${id}[(${text})]`;
  if (shape === 'stadium') return `${id}([${text}])`;
  return `${id}[${text}]`;
};

import type { ArchitectureDocument } from './legacy/architecture-document';
import type {
  WorkflowDocument,
  WorkflowDocumentGraph,
} from './legacy/workflow-document';
import type { MindDocument } from './legacy/mind-document';
import type { MindElement } from './legacy/mind-element';
import type {
  MindDocument as HostMindDocument,
  LegacyMindHostNode,
} from './legacy/host-mind-document';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const encoded = (role: string, id: string) => `${role}/${id.length}:${id}`;

/** Assign distinct namespaces before legacy adapters can overwrite colliding record keys. */
export const normalizeArchitectureIds = (
  input: ArchitectureDocument,
): ArchitectureDocument => {
  const document = clone(input);
  const modules = new Map<string, string>();
  document.layers.forEach((layer, index) => {
    layer.id = `layer/${index}`;
    layer.nodes.forEach((node) => {
      if (modules.has(node.id))
        throw new Error(`Ambiguous legacy architecture module id: ${node.id}`);
      const id = encoded('module', node.id);
      modules.set(node.id, id);
      node.id = id;
    });
  });
  document.edges.forEach((edge, index) => {
    const source = modules.get(edge.source),
      target = modules.get(edge.target);
    if (!source || !target)
      throw new Error(`Missing legacy architecture endpoint: ${edge.id}`);
    edge.id = `edge/${index}`;
    edge.source = source;
    edge.target = target;
  });
  return document;
};

export const normalizeWorkflowIds = (
  input: WorkflowDocument,
): WorkflowDocument => {
  const document = clone(input);
  const normalize = (graph: WorkflowDocument | WorkflowDocumentGraph) => {
    const nodes = new Map<string, string>([['__start__', '__start__']]);
    graph.nodes.forEach((node) => {
      if (nodes.has(node.key))
        throw new Error(`Ambiguous legacy workflow node key: ${node.key}`);
      const key = encoded('node', node.key);
      nodes.set(node.key, key);
      node.key = key;
    });
    graph.edges.forEach((edge, index) => {
      const source = nodes.get(edge.source.nodeKey),
        target = nodes.get(edge.target.nodeKey);
      if (!source || !target)
        throw new Error(`Missing legacy workflow endpoint: ${edge.key}`);
      edge.key = `edge/${index}`;
      edge.source.nodeKey = source;
      edge.target.nodeKey = target;
    });
    graph.layout.positions = Object.fromEntries(
      Object.entries(graph.layout.positions).map(([id, point]) => {
        const mapped = nodes.get(id);
        if (!mapped) throw new Error(`Unknown legacy workflow position: ${id}`);
        return [mapped, point];
      }),
    );
  };
  normalize(document);
  document.graphs?.forEach((graph, index) => {
    graph.id = `graph/${index}`;
    normalize(graph);
  });
  return document;
};

export const normalizeMindIds = (input: MindDocument): MindDocument => {
  const document = clone(input);
  const walk = (node: MindElement, path: string) => {
    node.id = `node/${path}`;
    node.children?.forEach((child, index) => walk(child, `${path}/${index}`));
  };
  walk(document.root, '0');
  document.roots?.forEach((node, index) => walk(node, String(index + 1)));
  return document;
};

export const normalizeHostMindIds = (
  input: HostMindDocument,
): HostMindDocument => {
  const document = clone(input);
  const walk = (node: LegacyMindHostNode, path: string) => {
    node.id = `node/${path}`;
    node.children.forEach((child, index) => walk(child, `${path}/${index}`));
  };
  document.roots.forEach((node, index) => walk(node, String(index)));
  return document;
};

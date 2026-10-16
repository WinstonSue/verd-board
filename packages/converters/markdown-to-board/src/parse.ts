import {
  CellKind,
  createFrameCell,
  type Cell,
  type CellId,
  type FrameSnapshot,
  type NodeCell,
} from '@sue/board-core';
import {
  createMindChildCell,
  createMindRootCell,
  stackMindTreeRoots,
} from '@sue/board-mind';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Heading, List, PhrasingContent, RootContent } from 'mdast';
import {
  markdownBlocks,
  markdownDefinitions,
  markdownInline,
  markdownNoteDocument,
  markdownTitleDocument,
  type MarkdownDefinitions,
} from './richtext';
import type { BoardTextNode } from '@sue/board-common';

export interface MarkdownParseOptions {
  /** Title for documents that carry no usable heading of their own. */
  fallbackTitle?: string;
}

interface RawTree {
  /** The heading whose text becomes the root title; absent for wrappers. */
  heading?: Heading;
  /** Explicit root label for synthetic trees and `mainTopic` wrapping. */
  label?: string;
  /** Content processed under this tree, in document order. */
  nodes: RootContent[];
}

/** Group top-level nodes into trees: each H1 opens a tree, otherwise one. */
const splitTrees = (
  nodes: readonly RootContent[],
  headings: readonly Heading[],
  mainTopic: string | undefined,
  fallbackTitle: string,
): RawTree[] => {
  if (mainTopic !== undefined) return [{ label: mainTopic, nodes: [...nodes] }];
  const h1s = headings.filter((node) => node.depth === 1);
  if (h1s.length > 1) {
    const trees: RawTree[] = [];
    const preamble: RootContent[] = [];
    for (const node of nodes) {
      if (node.type === 'heading' && node.depth === 1) {
        trees.push({ heading: node, nodes: trees.length ? [] : preamble });
        continue;
      }
      (trees.length ? trees[trees.length - 1].nodes : preamble).push(node);
    }
    return trees;
  }
  const shallowest = headings.length
    ? Math.min(...headings.map((node) => node.depth))
    : 0;
  const centers = headings.filter((node) => node.depth === shallowest);
  if (centers.length === 1)
    return [
      {
        heading: centers[0],
        nodes: nodes.filter((node) => node !== centers[0]),
      },
    ];
  // No heading, or several equally shallow ones: a synthetic center carries
  // the fallback title and every heading hangs beneath it.
  return [{ label: fallbackTitle, nodes: [...nodes] }];
};

/** Convert Markdown directly into mind roots and branches owned by a Frame. */
export const parseMarkdownToFrameSnapshot = (
  definition: string,
  mainTopic?: string,
  options?: MarkdownParseOptions,
): FrameSnapshot => {
  const ast = unified().use(remarkParse).parse(definition);
  const definitions = markdownDefinitions(ast.children);
  const headings = ast.children.filter(
    (node): node is Heading => node.type === 'heading',
  );
  const trees = splitTrees(
    ast.children,
    headings,
    mainTopic,
    options?.fallbackTitle ?? '中心主题',
  );

  const frame = createFrameCell('markdown:frame');
  const cells: Record<CellId, Cell> = { [frame.id]: frame };
  let sequence = 0;
  const childCounts = new Map<string, number>();
  const notes = new Map<CellId, BoardTextNode[]>();

  const cell = (id: CellId) => cells[id] as NodeCell;
  const setTitle = (id: CellId, inline: PhrasingContent[] | undefined) => {
    const document = markdownTitleDocument(markdownInline(inline, definitions));
    cell(id).content = { label: document.plainText, text: document };
  };
  const note = (id: CellId, nodes: RootContent[]) => {
    // One outer blockquote layer marks note text; anything inside stays.
    const unwrapped = nodes.flatMap((node): RootContent[] =>
      node.type === 'blockquote' ? (node.children as RootContent[]) : [node],
    );
    const existing = notes.get(id) ?? [];
    existing.push(...markdownBlocks(unwrapped, definitions));
    notes.set(id, existing);
  };
  const append = (parentId: string): string => {
    const node = createMindChildCell(`markdown:node:${++sequence}`);
    node.content = { label: '', text: markdownTitleDocument([]) };
    const order = childCounts.get(parentId) ?? 0;
    childCounts.set(parentId, order + 1);
    const edge: Cell = {
      id: `markdown:branch:${sequence}`,
      kind: CellKind.mindBranch,
      cellType: 'edge',
      source: { cellId: parentId },
      target: { cellId: node.id },
      route: { mode: 'auto' },
      data: { order: String(order).padStart(8, '0') },
    };
    cells[node.id] = node;
    cells[edge.id] = edge;
    frame.children.push(node.id, edge.id);
    return node.id;
  };
  const walkList = (list: List, parentId: CellId) => {
    for (const item of list.children) {
      const blocks = item.children;
      const title =
        blocks[0]?.type === 'paragraph'
          ? (blocks[0].children as PhrasingContent[])
          : undefined;
      const id = append(parentId);
      setTitle(id, title ?? []);
      for (const child of blocks.slice(title ? 1 : 0))
        if (child.type === 'list') walkList(child, id);
        else note(id, [child]);
    }
  };

  for (const tree of trees) {
    const root = createMindRootCell(
      trees.length > 1
        ? `markdown:root:${trees.indexOf(tree)}`
        : 'markdown:root',
    );
    root.data = { layout: 'right' };
    cells[root.id] = root;
    frame.children.push(root.id);
    if (tree.heading) setTitle(root.id, tree.heading.children);
    else setTitle(root.id, [{ type: 'text', value: tree.label ?? '' }]);

    /** heading depth -> topic id; depth 0 is always the root. */
    const level = new Map<number, CellId>([[0, root.id]]);
    let currentParent = root.id;
    for (const node of tree.nodes) {
      if (node.type === 'heading') {
        for (const depth of [...level.keys()])
          if (depth >= node.depth) level.delete(depth);
        const parentDepth = [...level.keys()].sort((a, b) => b - a)[0];
        const id = append(level.get(parentDepth) ?? root.id);
        setTitle(id, node.children);
        level.set(node.depth, id);
        currentParent = id;
      } else if (node.type === 'list') {
        walkList(node, currentParent);
      } else {
        note(currentParent, [node]);
      }
    }
  }

  for (const [id, blocks] of notes) {
    const target = cell(id);
    target.data = {
      ...(target.data as object),
      note: markdownNoteDocument(blocks),
    };
  }
  const store = stackMindTreeRoots({ rootId: frame.id, cells }, frame.id);
  return { store };
};

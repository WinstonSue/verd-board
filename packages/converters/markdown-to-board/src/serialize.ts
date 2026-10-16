import {
  CellKind,
  isEdgeCell,
  isFrameCell,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import { mindChildIds } from '@sue/board-mind';
import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import type {
  BlockContent,
  ListItem,
  PhrasingContent,
  RootContent,
} from 'mdast';
import type { BoardTextDocument } from '@sue/board-common';
import { boardBlocksToMarkdown, boardInlineToMarkdown } from './richtext';

const titleInline = (cell: NodeCell): PhrasingContent[] => {
  // Rich text wins: exporting after edits must not resurrect stale labels.
  const text = (cell.content as { text?: BoardTextDocument } | undefined)?.text;
  const fromText = text?.content?.content?.[0]?.content;
  if (fromText?.length) return boardInlineToMarkdown(fromText);
  const label = (cell.content as { label?: string } | undefined)?.label;
  return label ? [{ type: 'text', value: label }] : [];
};

const noteBlocks = (cell: NodeCell): BlockContent[] => {
  const note = (cell.data as { note?: BoardTextDocument } | undefined)?.note;
  if (!note) return [];
  const blocks = note.content?.content?.length
    ? boardBlocksToMarkdown(note.content.content)
    : note.plainText?.trim()
      ? [
          {
            type: 'paragraph' as const,
            children: [{ type: 'text' as const, value: note.plainText }],
          },
        ]
      : [];
  if (!blocks.length) return [];
  // Notes export wrapped in one blockquote level so re-import keeps them
  // out of the topic tree.
  return [{ type: 'blockquote', children: blocks as BlockContent[] }];
};

/**
 * Topics at depth 1-6 serialize as headings; deeper topics become nested
 * list items whose remaining blocks carry their note and children.
 */
export const serializeFrameToMarkdown = (
  store: CellStore,
  frameId: string,
): string => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing mind frame');
  const summaries = new Set(
    Object.values(store.cells)
      .filter(
        (cell): cell is EdgeCell =>
          isEdgeCell(cell) && cell.kind === CellKind.mindSummaryEdge,
      )
      .map((edge) => ('cellId' in edge.target ? edge.target.cellId : '')),
  );

  const topicChildren = (id: string): NodeCell[] =>
    mindChildIds(store, id)
      .map((child) => store.cells[child])
      .filter(
        (cell): cell is NodeCell =>
          !!cell &&
          (cell.kind === CellKind.mindChild ||
            cell.kind === CellKind.mindRoot) &&
          !summaries.has(cell.id),
      );

  const deepItem = (cell: NodeCell, depth: number): ListItem => {
    const children = topicChildren(cell.id);
    const nested = children.length
      ? [
          {
            type: 'list' as const,
            ordered: false,
            spread: false,
            children: children.map((child) => deepItem(child, depth + 1)),
          },
        ]
      : [];
    return {
      type: 'listItem',
      spread: false,
      children: [
        { type: 'paragraph', children: titleInline(cell) },
        ...noteBlocks(cell),
        ...nested,
      ],
    };
  };

  const blocksOf = (cell: NodeCell, depth: number): RootContent[] => {
    const children = topicChildren(cell.id);
    if (depth <= 6)
      return [
        {
          type: 'heading',
          depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
          children: titleInline(cell),
        },
        ...noteBlocks(cell),
        ...children.flatMap((child) => blocksOf(child, depth + 1)),
      ];
    return [
      {
        type: 'list',
        ordered: false,
        spread: false,
        children: [deepItem(cell, depth)],
      },
    ];
  };

  const roots = frame.children
    .map((id) => store.cells[id])
    .filter(
      (cell): cell is NodeCell => !!cell && cell.kind === CellKind.mindRoot,
    );
  const content = roots.flatMap((root) => blocksOf(root, 1));
  return unified()
    .use(remarkStringify, { bullet: '-', fences: true })
    .stringify({ type: 'root', children: content });
};

import {
  Alignment,
  type BoardTextDocument,
  type BoardTextMarkNode,
  type BoardTextNode,
} from './editor-types';

/**
 * Whole-document format state shared by title and note controls. A leaf
 * absent a mark resolves to the supplied domain default; `mixed` marks a
 * value that differs across leaves.
 */
export interface BoardTextFormatDefaults {
  fontSize?: string;
  color?: string;
  align?: Alignment;
}

export type BoardTextMarkState = boolean | 'mixed';

export interface BoardTextFormatState {
  bold: BoardTextMarkState;
  italic: BoardTextMarkState;
  underline: BoardTextMarkState;
  strike: BoardTextMarkState;
  /** Common explicit color, `undefined` when every leaf follows the theme. */
  color?: string | 'mixed';
  fontSize?: string | 'mixed';
  align?: Alignment | 'mixed';
  /** No text leaves exist yet — controls needing glyphs should disable. */
  empty: boolean;
}

export interface BoardTextFormatPatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** `null` removes the explicit color so leaves follow the theme again. */
  color?: string | null;
  fontSize?: string | null;
  align?: Alignment;
  /** `null` strips the link mark; a string sets the href on every leaf. */
  href?: string | null;
}

const TOGGLES = ['bold', 'italic', 'underline', 'strike'] as const;

export const boardTextLeaves = (
  node: BoardTextNode | undefined,
): BoardTextNode[] =>
  !node
    ? []
    : node.type === 'text'
      ? [node]
      : (node.content ?? []).flatMap(boardTextLeaves);

const textStyleAttr = (node: BoardTextNode, key: string) =>
  node.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.[key];

/**
 * Effective alignment per block container; a paragraph without `textAlign`
 * inherits the document default, which itself inherits `defaults.align`.
 */
export const boardTextAlignments = (
  document: BoardTextDocument,
  defaults: BoardTextFormatDefaults = {},
): Alignment[] => {
  const fallback = document.align ?? defaults.align ?? Alignment.left;
  const result: Alignment[] = [];
  const visit = (node: BoardTextNode) => {
    if (['paragraph', 'heading'].includes(node.type)) {
      const value = node.attrs?.['textAlign'];
      result.push(
        Object.values(Alignment).includes(value as Alignment)
          ? (value as Alignment)
          : fallback,
      );
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return result.length ? result : [fallback];
};

export const boardTextFormatState = (
  document: BoardTextDocument | undefined,
  defaults: BoardTextFormatDefaults = {},
): BoardTextFormatState => {
  const leaves = boardTextLeaves(document?.content).filter(
    (leaf) => leaf.text !== '',
  );
  const mark = (type: (typeof TOGGLES)[number]): BoardTextMarkState => {
    if (!leaves.length) return false;
    const hits = leaves.filter((leaf) =>
      leaf.marks?.some((entry) => entry.type === type),
    ).length;
    return hits === leaves.length ? true : hits ? 'mixed' : false;
  };
  const common = <T>(values: T[]): T | 'mixed' | undefined =>
    !leaves.length
      ? undefined
      : values.every((value) => value === values[0])
        ? values[0]
        : 'mixed';
  const colors = common(
    leaves.map((leaf) => textStyleAttr(leaf, 'color') as string | undefined),
  );
  const sizes = common(
    leaves.map(
      (leaf) =>
        (textStyleAttr(leaf, 'fontSize') as string | undefined) ??
        defaults.fontSize,
    ),
  );
  const alignments = document
    ? common(boardTextAlignments(document, defaults))
    : undefined;
  return {
    bold: mark('bold'),
    italic: mark('italic'),
    underline: mark('underline'),
    strike: mark('strike'),
    color: colors === 'mixed' ? 'mixed' : (colors ?? undefined),
    fontSize: sizes === 'mixed' ? 'mixed' : (sizes ?? defaults.fontSize),
    align: alignments === 'mixed' ? 'mixed' : alignments,
    empty: !leaves.length,
  };
};

const cloneMarks = (marks: BoardTextMarkNode[] | undefined) =>
  (marks ?? []).map((mark) => ({
    ...mark,
    attrs: mark.attrs && { ...mark.attrs },
  }));

/**
 * Applies a whole-document patch while preserving links, paragraph
 * structure and unrelated marks. `color: null`/`fontSize: null` drop that
 * attribute from `textStyle` (and the mark itself when nothing remains).
 */
export const formatBoardText = (
  document: BoardTextDocument,
  patch: BoardTextFormatPatch,
): BoardTextDocument => {
  const visit = (node: BoardTextNode): BoardTextNode => {
    const next: BoardTextNode = {
      ...node,
      content: node.content?.map(visit),
    };
    if (patch.align && ['paragraph', 'heading'].includes(node.type))
      next.attrs = { ...node.attrs, textAlign: patch.align };
    if (node.type !== 'text') return next;
    let marks: BoardTextMarkNode[] = cloneMarks(node.marks);
    for (const type of TOGGLES) {
      if (patch[type] === undefined) continue;
      marks = marks.filter((mark) => mark.type !== type);
      if (patch[type]) marks.push({ type });
    }
    if (patch.href !== undefined) {
      marks = marks.filter((mark) => mark.type !== 'link');
      if (patch.href) marks.push({ type: 'link', attrs: { href: patch.href } });
    }
    if (patch.color !== undefined || patch.fontSize !== undefined) {
      const previous = marks.find((mark) => mark.type === 'textStyle');
      const attrs = { ...previous?.attrs };
      if (patch.color !== undefined)
        patch.color === null
          ? delete attrs['color']
          : (attrs['color'] = patch.color);
      if (patch.fontSize !== undefined)
        patch.fontSize === null
          ? delete attrs['fontSize']
          : (attrs['fontSize'] = patch.fontSize);
      marks = marks.filter((mark) => mark.type !== 'textStyle');
      if (Object.keys(attrs).length) marks.push({ type: 'textStyle', attrs });
    }
    next.marks = marks;
    return next;
  };
  return {
    ...document,
    content: visit(document.content),
    ...(patch.align ? { align: patch.align } : {}),
  };
};

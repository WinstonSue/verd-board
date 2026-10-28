import {
  isBoardTextDocument,
  type BoardTextDocument,
  type BoardTextNode,
} from './editor-types';

/** Only link marks in explicit text slots are transformed; code is literal. */
export function mapBoardTextLinks(
  value: unknown,
  rewriteHref: (href: string) => string,
): unknown {
  if (!isBoardTextDocument(value)) return value;
  const visit = (node: BoardTextNode): BoardTextNode => {
    if (node.type === 'codeBlock') return node;
    let changed = false;
    const marks = node.marks?.map((mark) => {
      if (mark.type !== 'link' || typeof mark.attrs?.['href'] !== 'string')
        return mark;
      const href = rewriteHref(mark.attrs['href']);
      if (href === mark.attrs['href']) return mark;
      changed = true;
      return { ...mark, attrs: { ...mark.attrs, href } };
    });
    const content = node.content?.map((child) => {
      const next = visit(child);
      changed ||= next !== child;
      return next;
    });
    return changed
      ? {
          ...node,
          ...(marks ? { marks } : {}),
          ...(content ? { content } : {}),
        }
      : node;
  };
  const content = visit(value.content);
  return content === value.content
    ? value
    : ({ ...value, content } satisfies BoardTextDocument);
}

/** Structural typing keeps the common package independent of the Cell model. */
export function mapStandardCellLinks<
  T extends {
    cellType: string;
    content?: { text?: unknown };
    labels?: { richText?: unknown }[];
  },
>(cell: T, rewriteHref: (href: string) => string): T {
  const text = mapBoardTextLinks(cell.content?.text, rewriteHref);
  let changed = text !== cell.content?.text;
  const labels = cell.labels?.map((label) => {
    const richText = mapBoardTextLinks(label.richText, rewriteHref);
    if (richText === label.richText) return label;
    changed = true;
    return { ...label, richText };
  });
  return changed
    ? {
        ...cell,
        ...(text !== cell.content?.text
          ? { content: { ...cell.content, text } }
          : {}),
        ...(labels ? { labels } : {}),
      }
    : cell;
}

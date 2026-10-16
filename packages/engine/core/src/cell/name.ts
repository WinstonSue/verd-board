import { isNodeCell, type Cell, type NodeCell } from './types';

/** Names never inherit rich-text marks or paragraph layout. */
export function nodeContentName(cell: NodeCell): string {
  const text = cell.content?.text;
  const plain =
    text &&
    typeof text === 'object' &&
    'plainText' in text &&
    typeof text.plainText === 'string'
      ? text.plainText
      : (cell.content?.label ?? '');
  return plain.replace(/[\r\n]+/g, ' ');
}

export function initializeNodeName(
  next: Cell,
  previous?: Cell,
  defer = false,
): Cell {
  if (!isNodeCell(next) || next.name !== undefined) return next;
  if (isNodeCell(previous)) {
    if (previous.name !== undefined) return { ...next, name: previous.name };
    if (JSON.stringify(previous.content) === JSON.stringify(next.content))
      return next;
    if (defer) return next;
    const original = nodeContentName(previous);
    if (original) return { ...next, name: original };
  }
  const name = nodeContentName(next);
  return name ? { ...next, name } : next;
}

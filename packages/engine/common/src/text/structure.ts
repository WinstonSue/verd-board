import type {
  BoardTextDocument,
  BoardTextMarkNode,
  BoardTextNode,
} from './editor-types';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoardTextMark = (value: unknown): value is BoardTextMarkNode =>
  isPlainRecord(value) &&
  typeof value['type'] === 'string' &&
  (value['attrs'] === undefined || isPlainRecord(value['attrs']));

/**
 * DOM-free structural check of one serialized rich-text node. This only
 * proves the value is well-formed JSON in the BoardTextNode shape; the
 * editor's schema decides which node/mark types are actually supported.
 */
export const isBoardTextNode = (value: unknown): value is BoardTextNode => {
  if (!isPlainRecord(value) || typeof value['type'] !== 'string') return false;
  if (value['attrs'] !== undefined && !isPlainRecord(value['attrs']))
    return false;
  if (value['text'] !== undefined && typeof value['text'] !== 'string')
    return false;
  if (
    value['marks'] !== undefined &&
    (!Array.isArray(value['marks']) || !value['marks'].every(isBoardTextMark))
  )
    return false;
  if (
    value['content'] !== undefined &&
    (!Array.isArray(value['content']) ||
      !value['content'].every(isBoardTextNode))
  )
    return false;
  return true;
};

/**
 * Envelope-level validation for a serialized BoardTextDocument: identity,
 * kind and a recursively well-formed content tree. Plain-text caches and
 * unknown node types are left to the editor schema — a file holding an
 * unsupported node must surface a diagnostic instead of losing content.
 */
export const isBoardTextDocumentShape = (
  value: unknown,
): value is BoardTextDocument => {
  if (!isPlainRecord(value)) return false;
  if (value['schemaVersion'] !== 1) return false;
  if (typeof value['id'] !== 'string' || !value['id']) return false;
  if (value['kind'] !== 'inline' && value['kind'] !== 'block') return false;
  if (!isBoardTextNode(value['content'])) return false;
  if (
    value['plainText'] !== undefined &&
    typeof value['plainText'] !== 'string'
  )
    return false;
  if (value['align'] !== undefined && typeof value['align'] !== 'string')
    return false;
  return true;
};

/** Blocks whose children are inline content (text, breaks, marks). */
const INLINE_PARENTS = new Set(['paragraph', 'heading', 'codeBlock']);

/**
 * Pure derivation of a document's readable text. The persisted `plainText`
 * field is a cache — imports and migrations recompute it from `content`, so
 * stale or missing caches never corrupt the document body. Inline content
 * concatenates; block boundaries become single newlines.
 */
export const deriveBoardTextPlainText = (
  node: BoardTextNode | undefined,
): string => {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = node.content ?? [];
  if (!children.length) return '';
  const parts = children.map((child) => deriveBoardTextPlainText(child));
  return parts.join(INLINE_PARENTS.has(node.type) ? '' : '\n');
};

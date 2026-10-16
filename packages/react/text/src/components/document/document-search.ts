import type { Node as PMNode } from '@tiptap/pm/model';

const LEAF_CHAR = '￼';

/**
 * Searches each text block independently: matches may span marks inside one
 * block but never cross paragraphs, list items, table cells or atom nodes
 * (an atom occupies an untypeable placeholder character).
 */
export function findInDocument(
  doc: PMNode,
  query: string,
  caseSensitive = false,
): { from: number; to: number }[] {
  if (!query) return [];
  const matches: { from: number; to: number }[] = [];
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, LEAF_CHAR);
    const haystack = caseSensitive ? text : text.toLowerCase();
    let offset = 0;
    for (;;) {
      const found = haystack.indexOf(needle, offset);
      if (found === -1) break;
      matches.push({
        from: mapTextOffset(node, pos, found),
        to: mapTextOffset(node, pos, found + needle.length),
      });
      offset = found + needle.length;
    }
    return false;
  });
  return matches;
}

/**
 * Maps an offset inside `node.textBetween` output to an absolute document
 * position. Inline atoms occupy one leaf character and one position.
 */
function mapTextOffset(block: PMNode, blockPos: number, textOffset: number) {
  let consumed = 0;
  let resolved: number | undefined;
  block.forEach((child, offset) => {
    if (resolved !== undefined) return;
    const start = blockPos + 1 + offset;
    if (child.isText) {
      const length = child.text?.length ?? 0;
      if (textOffset <= consumed + length) {
        resolved = start + (textOffset - consumed);
        return;
      }
      consumed += length;
      return;
    }
    consumed += LEAF_CHAR.length;
    if (textOffset < consumed) resolved = start;
  });
  return resolved ?? blockPos + 1 + Math.min(textOffset, block.content.size);
}

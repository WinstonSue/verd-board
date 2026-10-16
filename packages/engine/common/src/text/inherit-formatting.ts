import {
  isBoardTextDocument,
  type BoardTextDocument,
  type BoardTextNode,
} from './editor-types';

/** New topics inherit typography without reusing text identity, links or content. */
export const inheritTextFormatting = (
  text: BoardTextDocument,
  seed: unknown,
): BoardTextDocument => {
  if (!isBoardTextDocument(seed)) return text;
  const first = (node: BoardTextNode): BoardTextNode | undefined =>
    node.type === 'text' ? node : node.content?.map(first).find(Boolean);
  const marks = first(seed.content)?.marks?.filter(
    (mark) => mark.type !== 'link',
  );
  const firstBlock = (node: BoardTextNode): BoardTextNode | undefined =>
    ['paragraph', 'heading'].includes(node.type)
      ? node
      : node.content?.map(firstBlock).find(Boolean);
  const alignment =
    firstBlock(seed.content)?.attrs?.['textAlign'] ?? seed.align;
  const visit = (node: BoardTextNode): BoardTextNode => ({
    ...node,
    ...(node.type === 'text' && marks
      ? {
          marks: marks.map((mark) => ({
            ...mark,
            attrs: mark.attrs && { ...mark.attrs },
          })),
        }
      : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}),
    ...(['paragraph', 'heading'].includes(node.type) && alignment
      ? { attrs: { ...node.attrs, textAlign: alignment } }
      : {}),
  });
  return { ...text, align: seed.align, content: visit(text.content) };
};

import type {
  BoardTextDocument,
  BoardTextMarkNode,
  BoardTextNode,
} from './editor-types';

const cloneMarks = (marks?: BoardTextMarkNode[]) =>
  marks?.map((mark) => ({
    type: mark.type,
    attrs: mark.attrs && { ...mark.attrs },
  }));
const sameMarks = (left?: BoardTextMarkNode[], right?: BoardTextMarkNode[]) =>
  JSON.stringify(left ?? []) === JSON.stringify(right ?? []);

interface StyledChar {
  ch: string;
  marks?: BoardTextMarkNode[];
}

const leaves = (node: BoardTextNode): StyledChar[] => {
  if (node.type === 'text')
    return [...(node.text ?? '')].map((ch) => ({ ch, marks: node.marks }));
  return (node.content ?? []).flatMap(leaves);
};
const blocks = (document: BoardTextDocument): BoardTextNode[] => {
  const content = document.content.content ?? [];
  const paragraphs = content.filter((node) =>
    ['paragraph', 'heading'].includes(node.type),
  );
  return paragraphs.length ? paragraphs : [document.content];
};
const reviseChars = (previous: StyledChar[], next: string): StyledChar[] => {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix].ch === next[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix].ch === next[next.length - 1 - suffix]
  )
    suffix++;
  const inherited =
    previous[Math.min(prefix, previous.length - 1)]?.marks ??
    previous[prefix - 1]?.marks;
  return [
    ...previous
      .slice(0, prefix)
      .map((entry) => ({ ch: entry.ch, marks: cloneMarks(entry.marks) })),
    ...next
      .slice(prefix, next.length - suffix)
      .split('')
      .map((ch) => ({ ch, marks: cloneMarks(inherited) })),
    ...previous
      .slice(previous.length - suffix)
      .map((entry) => ({ ch: entry.ch, marks: cloneMarks(entry.marks) })),
  ];
};
const toNodes = (chars: StyledChar[]): BoardTextNode[] => {
  const nodes: BoardTextNode[] = [];
  chars.forEach((entry) => {
    const last = nodes.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, entry.marks))
      last.text = `${last.text ?? ''}${entry.ch}`;
    else
      nodes.push({
        type: 'text',
        text: entry.ch,
        ...(entry.marks?.length ? { marks: entry.marks } : {}),
      });
  });
  return nodes;
};
const reviseBlock = (block: BoardTextNode, text: string): BoardTextNode => ({
  ...block,
  content: text ? toNodes(reviseChars(leaves(block), text)) : [],
});

/** Change visible text without rebuilding an existing document or dropping untouched marks. */
export const reviseBoardText = (
  document: BoardTextDocument,
  plainText: string,
): BoardTextDocument => {
  if (plainText === document.plainText) return document;
  const source = blocks(document);
  const lines =
    document.kind === 'inline'
      ? [plainText.replace(/\n/g, ' ')]
      : plainText.split('\n');
  const shared = Math.min(source.length, lines.length);
  let prefix = 0;
  while (
    prefix < shared &&
    leaves(source[prefix])
      .map((entry) => entry.ch)
      .join('') === lines[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < shared - prefix &&
    leaves(source[source.length - 1 - suffix])
      .map((entry) => entry.ch)
      .join('') === lines[lines.length - 1 - suffix]
  )
    suffix++;
  const middle = lines.slice(prefix, lines.length - suffix).map((line, index) =>
    reviseBlock(
      source[Math.min(prefix + index, source.length - 1)] ?? {
        type: 'paragraph',
      },
      line,
    ),
  );
  const nextBlocks = [
    ...source.slice(0, prefix).map((block) => ({
      ...block,
      content: block.content?.map((node) => ({
        ...node,
        marks: cloneMarks(node.marks),
      })),
    })),
    ...middle,
    ...source.slice(source.length - suffix).map((block) => ({
      ...block,
      content: block.content?.map((node) => ({
        ...node,
        marks: cloneMarks(node.marks),
      })),
    })),
  ];
  return {
    ...document,
    content: { ...document.content, content: nextBlocks },
    plainText,
  };
};

/** True when two documents carry the same text, marks, and alignment. */
export function sameBoardText(
  left: BoardTextDocument,
  right: BoardTextDocument,
): boolean {
  const plain = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim();
  if (plain(left.plainText) !== plain(right.plainText)) return false;
  if ((left.align ?? null) !== (right.align ?? null)) return false;
  const blockAlignments = (node: BoardTextNode): unknown[] => [
    ...(['paragraph', 'heading'].includes(node.type)
      ? [node.attrs?.['textAlign'] ?? null]
      : []),
    ...(node.content ?? []).flatMap(blockAlignments),
  ];
  if (
    JSON.stringify(blockAlignments(left.content)) !==
    JSON.stringify(blockAlignments(right.content))
  )
    return false;
  const rightLeaves = leaves(right.content);
  const leftLeaves = leaves(left.content);
  return (
    leftLeaves.length === rightLeaves.length &&
    leftLeaves.every(
      (entry, index) =>
        entry.ch === rightLeaves[index]?.ch &&
        sameMarks(entry.marks, rightLeaves[index]?.marks),
    )
  );
}

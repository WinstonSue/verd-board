import type {
  BoardTextDocument,
  BoardTextMarkNode,
  BoardTextNode,
} from '@sue/board-common';
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  PhrasingContent,
  RootContent,
} from 'mdast';

export type MarkdownDefinitions = Map<string, { url: string; title?: string }>;

const collectDefinitions = (
  nodes: readonly RootContent[],
  into: MarkdownDefinitions = new Map(),
): MarkdownDefinitions => {
  for (const node of nodes) {
    if (node.type === 'definition')
      into.set(node.identifier.toLowerCase(), {
        url: node.url,
        ...(node.title ? { title: node.title } : {}),
      });
    if ('children' in node)
      collectDefinitions((node as { children: RootContent[] }).children, into);
  }
  return into;
};

export const markdownDefinitions = (nodes: readonly RootContent[]) =>
  collectDefinitions(nodes);

let documentSequence = 0;
const documentId = () => `md-${++documentSequence}`;

const textLeaves = (
  value: string,
  marks: BoardTextMarkNode[] | undefined,
): BoardTextNode[] =>
  value.split('\n').flatMap((part, index) => [
    ...(index ? [{ type: 'hardBreak' } satisfies BoardTextNode] : []),
    ...(part
      ? [
          {
            type: 'text',
            text: part,
            ...(marks?.length ? { marks } : {}),
          } satisfies BoardTextNode,
        ]
      : []),
  ]);

/** Phrasing content becomes inline nodes carrying bold/italic/code/link marks. */
export const markdownInline = (
  nodes: readonly PhrasingContent[] | undefined,
  definitions: MarkdownDefinitions,
  marks: BoardTextMarkNode[] = [],
): BoardTextNode[] =>
  (nodes ?? []).flatMap((node): BoardTextNode[] => {
    switch (node.type) {
      case 'strong':
        return markdownInline(node.children, definitions, [
          ...marks,
          { type: 'bold' },
        ]);
      case 'emphasis':
        return markdownInline(node.children, definitions, [
          ...marks,
          { type: 'italic' },
        ]);
      case 'delete':
        return markdownInline(node.children, definitions, [
          ...marks,
          { type: 'strike' },
        ]);
      case 'inlineCode':
        return [
          {
            type: 'text',
            text: node.value,
            marks: [...marks, { type: 'code' }],
          },
        ];
      case 'link':
        return markdownInline(node.children, definitions, [
          ...marks,
          {
            type: 'link',
            attrs: {
              href: node.url,
              ...(node.title ? { title: node.title } : {}),
            },
          },
        ]);
      case 'linkReference': {
        const target = definitions.get(node.identifier.toLowerCase());
        if (!target)
          return textLeaves(
            `[${node.children.map((child) => ('value' in child ? child.value : '')).join('')}]${node.label === undefined ? '' : `[${node.label}]`}`,
            marks,
          );
        return markdownInline(node.children, definitions, [
          ...marks,
          {
            type: 'link',
            attrs: {
              href: target.url,
              ...(target.title ? { title: target.title } : {}),
            },
          },
        ]);
      }
      case 'image':
        // Notes keep the alt text and the address; size is not restored.
        return textLeaves(node.alt || node.url, [
          ...marks,
          { type: 'link', attrs: { href: node.url } },
        ]);
      case 'imageReference': {
        const target = definitions.get(node.identifier.toLowerCase());
        const label = node.alt || node.identifier;
        return target
          ? textLeaves(node.alt || target.url, [
              ...marks,
              { type: 'link', attrs: { href: target.url } },
            ])
          : textLeaves(`![${label}]`, marks);
      }
      case 'break':
        return [{ type: 'hardBreak' }];
      case 'html':
        return textLeaves(node.value, marks);
      case 'text':
        return textLeaves(node.value, marks);
      default:
        return 'children' in node
          ? markdownInline(
              (node as { children: PhrasingContent[] }).children,
              definitions,
              marks,
            )
          : 'value' in node
            ? textLeaves(String(node.value), marks)
            : [];
    }
  });

const plainOf = (node: BoardTextNode): string =>
  node.type === 'text'
    ? (node.text ?? '')
    : node.type === 'hardBreak'
      ? '\n'
      : (node.content ?? []).map(plainOf).join('');

/** Block-level content becomes the shared rich text schema for notes. */
export const markdownBlocks = (
  nodes: readonly (RootContent | DefinitionContent | BlockContent)[],
  definitions: MarkdownDefinitions,
): BoardTextNode[] =>
  nodes.flatMap((node): BoardTextNode[] => {
    switch (node.type) {
      case 'paragraph': {
        const content = markdownInline(node.children, definitions);
        return [{ type: 'paragraph', content }];
      }
      case 'heading':
        return [
          {
            type: 'heading',
            attrs: { level: node.depth },
            content: markdownInline(node.children, definitions),
          },
        ];
      case 'blockquote':
        return [
          {
            type: 'blockquote',
            content: markdownBlocks(node.children, definitions),
          },
        ];
      case 'code':
        return [
          {
            type: 'codeBlock',
            attrs: node.lang ? { language: node.lang } : undefined,
            content: node.value ? [{ type: 'text', text: node.value }] : [],
          },
        ];
      case 'list':
        return [
          {
            type: node.ordered ? 'orderedList' : 'bulletList',
            content: node.children.map((item): BoardTextNode => ({
              type: 'listItem',
              content: markdownBlocks(item.children, definitions),
            })),
          },
        ];
      case 'thematicBreak':
        return [{ type: 'horizontalRule' }];
      case 'html':
        return [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: node.value }],
          },
        ];
      case 'table':
      case 'tableRow':
        return [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: nodeText(node) }],
          },
        ];
      case 'definition':
      case 'footnoteDefinition':
        return [];
      case 'yaml':
        return [];
      default:
        return [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: nodeText(node) }],
          },
        ];
    }
  });

const nodeText = (node: unknown): string => {
  const candidate = node as { value?: string; children?: unknown[] };
  if (typeof candidate.value === 'string') return candidate.value;
  return (candidate.children ?? []).map(nodeText).join('');
};

/** A block rich text document for a mind note. Empty input stays empty. */
export const markdownNoteDocument = (
  blocks: BoardTextNode[],
): BoardTextDocument => ({
  schemaVersion: 1,
  id: documentId(),
  kind: 'block',
  content: {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph', content: [] }],
  },
  plainText: blocks.map(plainOf).join('\n'),
});

/** An inline rich text document for a mind topic title. */
export const markdownTitleDocument = (
  inline: BoardTextNode[],
): BoardTextDocument => {
  const content: BoardTextNode[] = inline.length
    ? inline.map((node) =>
        node.type === 'hardBreak' ? { type: 'text', text: ' ' } : node,
      )
    : [{ type: 'text', text: '' }];
  return {
    schemaVersion: 1,
    id: documentId(),
    kind: 'inline',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content }],
    },
    plainText: content.map(plainOf).join(''),
  };
};

const wrapMarks = (
  leaf: PhrasingContent[],
  marks: BoardTextMarkNode[] | undefined,
): PhrasingContent[] => {
  let out = leaf;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = [{ type: 'strong', children: out }];
        break;
      case 'italic':
        out = [{ type: 'emphasis', children: out }];
        break;
      case 'code':
        // `code` applies to the whole leaf: texts become inlineCode.
        out = out.map((child) =>
          child.type === 'text'
            ? { type: 'inlineCode', value: child.value }
            : child,
        );
        break;
      case 'link':
        out = [
          {
            type: 'link',
            url: String(mark.attrs?.['href'] ?? ''),
            ...(mark.attrs?.['title']
              ? { title: String(mark.attrs['title']) }
              : {}),
            children: out,
          },
        ];
        break;
      default:
        break;
    }
  }
  return out;
};

/** Rich text leaves become mdast phrasing; unrepresentable marks drop to text. */
export const boardInlineToMarkdown = (
  nodes: readonly BoardTextNode[] | undefined,
): PhrasingContent[] =>
  (nodes ?? []).flatMap((node): PhrasingContent[] => {
    if (node.type === 'hardBreak') return [{ type: 'break' }];
    if (node.type !== 'text') return boardInlineToMarkdown(node.content);
    return wrapMarks([{ type: 'text', value: node.text ?? '' }], node.marks);
  });

const plainText = (node: BoardTextNode): string => plainOf(node);

/** Rich text blocks become mdast blocks for note export. */
export const boardBlocksToMarkdown = (
  nodes: readonly BoardTextNode[] | undefined,
): RootContent[] =>
  (nodes ?? []).flatMap((node): RootContent[] => {
    switch (node.type) {
      case 'paragraph':
        return [
          {
            type: 'paragraph',
            children: boardInlineToMarkdown(node.content),
          },
        ];
      case 'heading': {
        const level = Number(node.attrs?.['level']);
        return [
          {
            type: 'heading',
            depth: Math.min(
              6,
              Math.max(1, Number.isInteger(level) ? level : 1),
            ) as 1 | 2 | 3 | 4 | 5 | 6,
            children: boardInlineToMarkdown(node.content),
          },
        ];
      }
      case 'blockquote':
        return [
          {
            type: 'blockquote',
            children: boardBlocksToMarkdown(node.content) as (
              BlockContent | DefinitionContent
            )[],
          },
        ];
      case 'codeBlock': {
        const language = node.attrs?.['language'];
        return [
          {
            type: 'code',
            lang: typeof language === 'string' ? language : null,
            value: (node.content ?? []).map(plainText).join('\n'),
          },
        ];
      }
      case 'bulletList':
      case 'orderedList':
        return [
          {
            type: 'list',
            ordered: node.type === 'orderedList',
            children: (node.content ?? []).map(
              (item: BoardTextNode): ListItem => ({
                type: 'listItem',
                children: boardBlocksToMarkdown(item.content) as (
                  BlockContent | DefinitionContent
                )[],
              }),
            ),
          },
        ];
      case 'horizontalRule':
        return [{ type: 'thematicBreak' }];
      case 'image': {
        const src = node.attrs?.['src'];
        return typeof src === 'string' && src
          ? [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'image',
                    url: src,
                    ...(node.attrs?.['alt']
                      ? { alt: String(node.attrs['alt']) }
                      : {}),
                    ...(node.attrs?.['title']
                      ? { title: String(node.attrs['title']) }
                      : {}),
                  },
                ],
              },
            ]
          : [];
      }
      case 'table':
        // Markdown export has no table syntax; keep each row as a text line.
        return (node.content ?? []).map((row: BoardTextNode): RootContent => ({
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: (row.content ?? [])
                .map((cell: BoardTextNode) =>
                  (cell.content ?? []).map(plainText).join(' '),
                )
                .join(' | '),
            },
          ],
        }));
      default:
        return node.content?.length
          ? boardBlocksToMarkdown(node.content)
          : plainText(node)
            ? [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', value: plainText(node) }],
                },
              ]
            : [];
    }
  });

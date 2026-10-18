import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type {
  BlockContent,
  Definition,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
} from 'mdast';
import {
  Alignment,
  deriveBoardTextPlainText,
  type BoardTextDocument,
  type BoardTextMarkNode,
  type BoardTextNode,
} from '@sue/board-common';

export interface MarkdownConversionWarning {
  message: string;
}

export interface MarkdownParseResult {
  document: BoardTextDocument;
  warnings: MarkdownConversionWarning[];
}

export interface MarkdownSerializeResult {
  markdown: string;
  warnings: MarkdownConversionWarning[];
}

const generateId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const text = (value: string, marks?: BoardTextMarkNode[]): BoardTextNode => ({
  type: 'text',
  text: value,
  ...(marks?.length ? { marks } : {}),
});

const paragraph = (content: BoardTextNode[] = []): BoardTextNode => ({
  type: 'paragraph',
  ...(content.length ? { content } : {}),
});

// ---------------------------------------------------------------------------
// Markdown -> BoardTextDocument
// ---------------------------------------------------------------------------

type Warn = (message: string) => void;

const SOFT_BREAK = /\s*\n\s*/g;

/**
 * Converts phrasing content. Inline images cannot live inside our block-level
 * paragraphs, so they surface as sentinel markers the caller turns into
 * standalone image blocks (mixed paragraphs split in content order).
 */
function phrasingToNodes(
  nodes: PhrasingContent[],
  marks: BoardTextMarkNode[],
  ctx: { warn: Warn; definitions: Map<string, Definition> },
  out: (BoardTextNode | { type: '__image'; node: BoardTextNode })[],
) {
  const pushText = (value: string) => {
    if (!value) return;
    const previous = out[out.length - 1];
    if (
      previous?.type === 'text' &&
      JSON.stringify(previous.marks ?? null) ===
        JSON.stringify(marks.length ? marks : null)
    ) {
      previous.text = (previous.text ?? '') + value;
      return;
    }
    out.push(text(value, marks));
  };

  const linkFor = (url: string, title?: string | null): BoardTextMarkNode => ({
    type: 'link',
    attrs: title ? { href: url, title } : { href: url },
  });

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        pushText(node.value.replace(SOFT_BREAK, ' '));
        break;
      case 'inlineCode':
        if (marks.length)
          ctx.warn(
            `Formatting around inline code was removed: ${marks.map((mark) => mark.type).join(', ')}`,
          );
        // TipTap's code mark excludes other marks. Inheriting bold/link here
        // creates a document that the actual editor schema cannot validate.
        out.push(text(node.value, [{ type: 'code' }]));
        break;
      case 'strong':
        phrasingToNodes(node.children, [...marks, { type: 'bold' }], ctx, out);
        break;
      case 'emphasis':
        phrasingToNodes(
          node.children,
          [...marks, { type: 'italic' }],
          ctx,
          out,
        );
        break;
      case 'delete':
        phrasingToNodes(
          node.children,
          [...marks, { type: 'strike' }],
          ctx,
          out,
        );
        break;
      case 'link':
        phrasingToNodes(
          node.children,
          [...marks, linkFor(node.url, node.title)],
          ctx,
          out,
        );
        break;
      case 'linkReference': {
        const target = ctx.definitions.get(
          (node.identifier ?? '').toLowerCase(),
        );
        if (target)
          phrasingToNodes(
            node.children,
            [...marks, linkFor(target.url, target.title)],
            ctx,
            out,
          );
        else {
          ctx.warn(`Unresolved link reference: ${node.identifier}`);
          phrasingToNodes(node.children, marks, ctx, out);
        }
        break;
      }
      case 'break':
        out.push({ type: 'hardBreak' });
        break;
      case 'image':
        out.push({
          type: '__image',
          node: {
            type: 'image',
            attrs: {
              src: node.url,
              alt: node.alt ?? null,
              title: node.title ?? null,
            },
          },
        });
        break;
      case 'imageReference': {
        const target = ctx.definitions.get(
          (node.identifier ?? '').toLowerCase(),
        );
        if (target)
          out.push({
            type: '__image',
            node: {
              type: 'image',
              attrs: {
                src: target.url,
                alt: node.alt ?? null,
                title: target.title ?? null,
              },
            },
          });
        else {
          ctx.warn(`Unresolved image reference: ${node.identifier}`);
          pushText(`![${node.alt ?? ''}]`);
        }
        break;
      }
      case 'html':
        ctx.warn('HTML markup is kept as plain text, not rendered');
        pushText(node.value);
        break;
      case 'footnoteReference':
        ctx.warn('Footnotes are kept as plain text markers');
        pushText(`[^${node.identifier}]`);
        break;
      default: {
        const unknown = node as { type: string; value?: unknown };
        ctx.warn(`Unsupported inline content: ${unknown.type}`);
        if (typeof unknown.value === 'string' && unknown.value)
          pushText(unknown.value);
      }
    }
  }
}

interface ImageMarker {
  type: '__image';
  node: BoardTextNode;
}
const isImageMarker = (
  node: BoardTextNode | ImageMarker,
): node is ImageMarker => node.type === '__image';

/** Flattens marker-free phrasing output into a single node's content. */
function inlineOf(
  nodes: PhrasingContent[],
  ctx: { warn: Warn; definitions: Map<string, Definition> },
): BoardTextNode[] {
  const out: (BoardTextNode | ImageMarker)[] = [];
  phrasingToNodes(nodes, [], ctx, out);
  if (out.some(isImageMarker))
    ctx.warn('Images inside this block were dropped (inline context)');
  return out.filter((node): node is BoardTextNode => !isImageMarker(node));
}

/** Splits phrasing output into paragraphs and standalone image blocks. */
function paragraphBlocks(
  children: PhrasingContent[],
  ctx: { warn: Warn; definitions: Map<string, Definition> },
): BoardTextNode[] {
  const out: (BoardTextNode | ImageMarker)[] = [];
  phrasingToNodes(children, [], ctx, out);
  const blocks: BoardTextNode[] = [];
  let buffer: BoardTextNode[] = [];
  const flush = () => {
    if (buffer.length) {
      blocks.push(paragraph(buffer));
      buffer = [];
    }
  };
  for (const node of out) {
    if (isImageMarker(node)) {
      flush();
      blocks.push(node.node);
    } else buffer.push(node);
  }
  flush();
  return blocks.length ? blocks : [paragraph()];
}

function blockToNodes(
  node: RootContent,
  ctx: { warn: Warn; definitions: Map<string, Definition> },
): BoardTextNode[] {
  switch (node.type) {
    case 'paragraph':
      return paragraphBlocks(node.children, ctx);
    case 'heading':
      return [
        {
          type: 'heading',
          attrs: { level: Math.min(6, Math.max(1, node.depth)) },
          content: inlineOf(node.children, ctx),
        },
      ];
    case 'blockquote':
      return [
        {
          type: 'blockquote',
          content: node.children.flatMap((child) => blockToNodes(child, ctx)),
        },
      ];
    case 'list': {
      const items = node.children.map((item: ListItem) => {
        const content = item.children.flatMap((child) =>
          blockToNodes(child, ctx),
        );
        if (item.checked !== null && item.checked !== undefined) {
          ctx.warn('Task lists are imported as plain checkbox text');
          const marker = text(item.checked ? '[x] ' : '[ ] ');
          const first = content[0];
          if (first?.type === 'paragraph')
            first.content = [marker, ...(first.content ?? [])];
          else content.unshift(paragraph([marker]));
        }
        return { type: 'listItem', content } as BoardTextNode;
      });
      return [
        {
          type: node.ordered ? 'orderedList' : 'bulletList',
          ...(node.ordered && node.start && node.start !== 1
            ? { attrs: { start: node.start } }
            : {}),
          content: items,
        },
      ];
    }
    case 'code':
      return [
        {
          type: 'codeBlock',
          attrs: { language: node.lang ?? null },
          content: [text(node.value.replace(/\n$/, ''))],
        },
      ];
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }];
    case 'table':
      return [
        {
          type: 'table',
          content: node.children.map((row, rowIndex) => ({
            type: 'tableRow',
            content: row.children.map((cell: TableCell) => ({
              type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: inlineOf(cell.children, ctx),
                },
              ],
            })),
          })),
        },
      ];
    case 'html':
      ctx.warn('HTML blocks are kept as plain text, not rendered');
      return [paragraph([text(node.value)])];
    case 'footnoteDefinition':
      ctx.warn('Footnotes are kept as plain text blocks');
      return [
        paragraph([
          text(`[^${node.identifier}]: `),
          ...inlineOf(
            node.children.flatMap((child) =>
              child.type === 'paragraph' ? child.children : [],
            ),
            ctx,
          ),
        ]),
      ];
    case 'definition':
      return [];
    case 'yaml':
      ctx.warn('Frontmatter is not supported and was skipped');
      return [];
    default:
      ctx.warn(`Unsupported block content: ${node.type}`);
      return [];
  }
}

/**
 * Parses CommonMark + GFM into a `BoardTextDocument`. Unsupported structures
 * degrade to readable text plus warnings — never silently dropped.
 */
export function parseMarkdownToTextDocument(
  markdown: string,
  options: { id?: string } = {},
): MarkdownParseResult {
  const warnings: MarkdownConversionWarning[] = [];
  const warn: Warn = (message) => warnings.push({ message });
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as Root;
  const definitions = new Map<string, Definition>();
  const collect = (node: Root | RootContent | Definition) => {
    if (node.type === 'definition')
      definitions.set(node.identifier.toLowerCase(), node);
    if ('children' in node && Array.isArray(node.children))
      node.children.forEach(collect);
  };
  collect(tree);
  const ctx = { warn, definitions };
  const content: BoardTextNode = {
    type: 'doc',
    content: tree.children.flatMap((child) => blockToNodes(child, ctx)),
  };
  if (!content.content?.length) content.content = [paragraph()];
  const id = options.id ?? generateId();
  return {
    document: {
      schemaVersion: 1,
      id,
      kind: 'block',
      content,
      plainText: deriveBoardTextPlainText(content),
      align: Alignment.left,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// BoardTextDocument -> Markdown
// ---------------------------------------------------------------------------

interface SerializeContext {
  warn: Warn;
  warnedMarks: Set<string>;
}

const warnMark = (ctx: SerializeContext, mark: string) => {
  if (ctx.warnedMarks.has(mark)) return;
  ctx.warnedMarks.add(mark);
  ctx.warn(`Formatting is lost in Markdown output: ${mark}`);
};

function nodesToPhrasing(
  nodes: BoardTextNode[] | undefined,
  ctx: SerializeContext,
): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text': {
        const value = node.text ?? '';
        if (!value) break;
        const marks = node.marks ?? [];
        if (marks.some((mark) => mark.type === 'code')) {
          out.push({ type: 'inlineCode', value });
          break;
        }
        let current: PhrasingContent = { type: 'text', value };
        for (const mark of marks) {
          switch (mark.type) {
            case 'bold':
              current = { type: 'strong', children: [current] };
              break;
            case 'italic':
              current = { type: 'emphasis', children: [current] };
              break;
            case 'strike':
              current = { type: 'delete', children: [current] };
              break;
            case 'link':
              current = {
                type: 'link',
                url: String(mark.attrs?.['href'] ?? ''),
                ...(mark.attrs?.['title']
                  ? { title: String(mark.attrs['title']) }
                  : {}),
                children: [current],
              };
              break;
            default:
              warnMark(ctx, mark.type);
          }
        }
        out.push(current);
        break;
      }
      case 'hardBreak':
        out.push({ type: 'break' });
        break;
      case 'image':
        out.push({
          type: 'image',
          url: String(node.attrs?.['src'] ?? ''),
          alt: node.attrs?.['alt'] != null ? String(node.attrs['alt']) : null,
          ...(node.attrs?.['title'] != null
            ? { title: String(node.attrs['title']) }
            : {}),
        } as PhrasingContent);
        break;
      default:
        ctx.warn(`Inline content skipped in Markdown output: ${node.type}`);
    }
  }
  return out;
}

const textContentOf = (node: BoardTextNode | undefined): string => {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'image') return String(node.attrs?.['alt'] ?? '');
  return (node.content ?? []).map(textContentOf).join('');
};

function cellPhrasing(
  cell: BoardTextNode,
  ctx: SerializeContext,
): PhrasingContent[] {
  const blocks = (cell.content ?? []).filter(
    (child) =>
      child.type === 'paragraph' ||
      child.type === 'heading' ||
      child.type === 'blockquote' ||
      child.type === 'listItem' ||
      child.type === 'bulletList' ||
      child.type === 'orderedList',
  );
  const out: PhrasingContent[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) out.push({ type: 'html', value: '<br>' });
    if (block.type === 'paragraph' || block.type === 'heading')
      out.push(...nodesToPhrasing(block.content, ctx));
    else
      out.push({
        type: 'text',
        value: textContentOf(block).replace(/\n+/g, ' '),
      });
  });
  const complex = (cell.content ?? []).filter(
    (child) =>
      ![
        'paragraph',
        'heading',
        'blockquote',
        'listItem',
        'bulletList',
        'orderedList',
      ].includes(child.type),
  );
  if (complex.length)
    ctx.warn('Complex table cell content was flattened to text');
  return out.length ? out : [{ type: 'text', value: '' }];
}

function nodeToBlocks(
  node: BoardTextNode,
  ctx: SerializeContext,
): BlockContent[] {
  switch (node.type) {
    case 'paragraph':
      return [
        { type: 'paragraph', children: nodesToPhrasing(node.content, ctx) },
      ];
    case 'heading':
      return [
        {
          type: 'heading',
          depth: Math.min(
            6,
            Math.max(1, Number(node.attrs?.['level'] ?? 1)),
          ) as 1 | 2 | 3 | 4 | 5 | 6,
          children: nodesToPhrasing(node.content, ctx),
        },
      ];
    case 'blockquote':
      return [
        {
          type: 'blockquote',
          children: (node.content ?? []).flatMap((child) =>
            nodeToBlocks(child, ctx),
          ),
        },
      ];
    case 'bulletList':
    case 'orderedList':
      return [
        {
          type: 'list',
          ordered: node.type === 'orderedList',
          start:
            node.type === 'orderedList' &&
            typeof node.attrs?.['start'] === 'number'
              ? (node.attrs['start'] as number)
              : undefined,
          spread: false,
          children: (node.content ?? []).map((item) => ({
            type: 'listItem',
            spread: false,
            children: (item.content ?? []).flatMap((child) =>
              nodeToBlocks(child, ctx),
            ),
          })),
        },
      ];
    case 'codeBlock':
      return [
        {
          type: 'code',
          lang:
            typeof node.attrs?.['language'] === 'string'
              ? (node.attrs['language'] as string)
              : null,
          value: (node.content ?? []).map(textContentOf).join(''),
        },
      ];
    case 'horizontalRule':
      return [{ type: 'thematicBreak' }];
    case 'frameReference':
      ctx.warn('Embedded canvas exported as a source-file link');
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: `verd://file/${encodeURIComponent(String(node.attrs?.['targetFrameId'] ?? ''))}`,
              children: [{ type: 'text', value: '打开画布' }],
            },
          ],
        },
      ];
    case 'image':
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: String(node.attrs?.['src'] ?? ''),
              alt:
                node.attrs?.['alt'] != null ? String(node.attrs['alt']) : null,
              ...(node.attrs?.['title'] != null
                ? { title: String(node.attrs['title']) }
                : {}),
            },
          ],
        },
      ];
    case 'table': {
      const rows = node.content ?? [];
      const first = rows[0];
      const hasHeader =
        !!first && (first.content ?? []).some((c) => c.type === 'tableHeader');
      if (!hasHeader && rows.length)
        ctx.warn('Table without a header row exports a synthetic header');
      const emitRow = (row: BoardTextNode, header: boolean) => ({
        type: 'tableRow' as const,
        children: (row.content ?? []).map((cell) => {
          if (
            (Number(cell.attrs?.['colspan'] ?? 1) > 1 ||
              Number(cell.attrs?.['rowspan'] ?? 1) > 1) &&
            !ctx.warnedMarks.has('table-merged')
          ) {
            ctx.warnedMarks.add('table-merged');
            ctx.warn('Merged table cells are exported as a flat grid');
          }
          return {
            type: 'tableCell' as const,
            children: cellPhrasing(cell, ctx),
          };
        }),
      });
      const emitted = rows.map((row) => emitRow(row, false));
      if (!hasHeader && rows.length)
        emitted.unshift({
          type: 'tableRow',
          children: (rows[0]?.content ?? []).map(() => ({
            type: 'tableCell' as const,
            children: [{ type: 'text' as const, value: '' }],
          })),
        });
      return [{ type: 'table', children: emitted } as BlockContent];
    }
    default: {
      ctx.warn(`Unsupported block exported as plain text: ${node.type}`);
      const value = textContentOf(node);
      return value
        ? [{ type: 'paragraph', children: [{ type: 'text', value }] }]
        : [];
    }
  }
}

/**
 * Serializes to CommonMark + GFM. Formatting markdown cannot express keeps
 * its text and reports warnings; the source document is never modified.
 */
export function serializeTextDocumentToMarkdown(
  document: BoardTextDocument,
): MarkdownSerializeResult {
  const warnings: MarkdownConversionWarning[] = [];
  const ctx: SerializeContext = {
    warn: (message) => warnings.push({ message }),
    warnedMarks: new Set(),
  };
  const root: Root = {
    type: 'root',
    children: (document.content.content ?? []).flatMap((child) =>
      nodeToBlocks(child, ctx),
    ),
  };
  const markdown = unified()
    .use(remarkGfm)
    .use(remarkStringify)
    .stringify(root);
  return { markdown, warnings };
}

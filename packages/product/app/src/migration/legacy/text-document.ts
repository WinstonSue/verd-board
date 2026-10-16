import {
  Alignment,
  createTextDocument,
  isBoardTextDocument,
  type BoardTextDocument,
  type BoardTextKind,
  type BoardTextNode,
} from '@sue/board-common';
const generateId = () => crypto.randomUUID();
const textNode = (text: string): BoardTextNode[] =>
  text ? [{ type: 'text', text }] : [];

function legacyMarks(child: Record<string, unknown>): BoardTextNode['marks'] {
  const marks: NonNullable<BoardTextNode['marks']> = [];
  if (child['bold']) marks.push({ type: 'bold' });
  if (child['italic']) marks.push({ type: 'italic' });
  if (child['underlined'] || child['underline'])
    marks.push({ type: 'underline' });
  if (child['code']) marks.push({ type: 'code' });
  if (child['strike']) marks.push({ type: 'strike' });
  if (typeof child['color'] === 'string') {
    marks.push({ type: 'textStyle', attrs: { color: child['color'] } });
  }
  if (typeof child['font-size'] === 'string') {
    marks.push({
      type: 'textStyle',
      attrs: { fontSize: child['font-size'] },
    });
  }
  return marks.length ? marks : undefined;
}

function htmlToInlineNodes(html: string): BoardTextNode[] {
  const plain = html.replace(/<[^>]+>/g, '');
  if (!html || html === plain) {
    return textNode(plain);
  }
  if (typeof document === 'undefined') {
    return textNode(plain);
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const nodes: BoardTextNode[] = [];
  const walk = (node: Node, marks: NonNullable<BoardTextNode['marks']>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || '';
      if (value) {
        nodes.push({
          type: 'text',
          text: value,
          marks: marks.length ? [...marks] : undefined,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const nextMarks = [...marks];
    if (tag === 'strong' || tag === 'b') nextMarks.push({ type: 'bold' });
    if (tag === 'em' || tag === 'i') nextMarks.push({ type: 'italic' });
    if (tag === 'u') nextMarks.push({ type: 'underline' });
    if (tag === 'code') nextMarks.push({ type: 'code' });
    if (tag === 's' || tag === 'strike') nextMarks.push({ type: 'strike' });
    if (tag === 'a' && el.getAttribute('href')) {
      nextMarks.push({
        type: 'link',
        attrs: { href: el.getAttribute('href') },
      });
    }
    el.childNodes.forEach((child) => walk(child, nextMarks));
  };
  holder.childNodes.forEach((child) => walk(child, []));
  return nodes.length ? nodes : textNode(plain);
}

function blockFromLegacy(block: {
  type?: string;
  data?: {
    text?: string;
    level?: number;
    style?: string;
    items?: string[];
    content?: string[][];
  };
}): BoardTextNode {
  const type = block.type || 'paragraph';
  const data = block.data || {};
  if (type === 'header') {
    return {
      type: 'heading',
      attrs: { level: data.level || 2 },
      content: htmlToInlineNodes(data.text || ''),
    };
  }
  if (type === 'list') {
    return {
      type: data.style === 'ordered' ? 'orderedList' : 'bulletList',
      content: (data.items || []).map((item) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: htmlToInlineNodes(item),
          },
        ],
      })),
    };
  }
  if (type === 'table') {
    return {
      type: 'table',
      content: (data.content || []).map((row) => ({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: 'tableCell',
          content: [
            {
              type: 'paragraph',
              content: htmlToInlineNodes(cell),
            },
          ],
        })),
      })),
    };
  }
  return {
    type: 'paragraph',
    content: htmlToInlineNodes(data.text || ''),
  };
}

function collectPlainText(node: BoardTextNode): string {
  if (typeof node.text === 'string') {
    return node.text;
  }
  return (node.content || []).map(collectPlainText).join(' ');
}

export function migrateLegacyTextDocument(
  input: unknown,
  fallbackKind: BoardTextKind = 'block',
): BoardTextDocument {
  if (isBoardTextDocument(input)) {
    return input;
  }
  if (typeof input === 'string') return createTextDocument(fallbackKind, input);
  if (!input || typeof input !== 'object') {
    return createTextDocument(fallbackKind, '');
  }
  const value = input as Record<string, unknown>;
  const kind: BoardTextKind =
    value['type'] === 'line' || value['kind'] === 'inline'
      ? 'inline'
      : fallbackKind;

  if (Array.isArray(value['children'])) {
    const contentNodes = (
      value['children'] as Array<Record<string, unknown>>
    ).map((child) => ({
      type: 'text',
      text: String(child['text'] || ''),
      marks: legacyMarks(child),
    }));
    const content: BoardTextNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: contentNodes }],
    };
    return {
      schemaVersion: 1,
      id: typeof value['id'] === 'string' ? value['id'] : generateId(),
      kind,
      content,
      plainText: collectPlainText(content).trim(),
      align: value['align'] as Alignment | undefined,
    };
  }

  const raw = value['raw'] as
    | { blocks?: Array<{ type?: string; data?: Record<string, unknown> }> }
    | undefined;
  if (raw?.blocks?.length) {
    const content: BoardTextNode = {
      type: 'doc',
      content: raw.blocks.map((block) => blockFromLegacy(block)),
    };
    const meta = value['meta'] as { plainText?: string } | undefined;
    return {
      schemaVersion: 1,
      id: typeof value['id'] === 'string' ? value['id'] : generateId(),
      kind,
      content,
      plainText: meta?.plainText || collectPlainText(content).trim(),
      align: value['align'] as Alignment | undefined,
    };
  }

  const fallbackText =
    (typeof (value['meta'] as { plainText?: string } | undefined)?.plainText ===
    'string'
      ? (value['meta'] as { plainText: string }).plainText
      : '') || '';
  return createTextDocument(
    kind,
    fallbackText,
    value['align'] as Alignment | undefined,
  );
}

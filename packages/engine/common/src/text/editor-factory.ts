import {
  Alignment,
  BoardTextDocument,
  BoardTextKind,
  BoardTextNode,
} from './editor-types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function textNode(text: string): BoardTextNode[] {
  if (!text) {
    return [];
  }
  return [{ type: 'text', text }];
}

export function createDocContent(text = ''): BoardTextNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: textNode(text),
      },
    ],
  };
}

export function createTextDocument(
  kind: BoardTextKind,
  text = '',
  align?: Alignment,
): BoardTextDocument {
  return {
    schemaVersion: 1,
    id: generateId(),
    kind,
    content: createDocContent(text),
    plainText: text,
    align,
  };
}

export function createInlineText(text = ''): BoardTextDocument {
  return createTextDocument('inline', text);
}

export function createBlockText(
  text = '',
  align?: Alignment,
): BoardTextDocument {
  return createTextDocument('block', text, align);
}

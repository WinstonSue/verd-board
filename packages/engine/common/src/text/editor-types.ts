export enum Alignment {
  left = 'left',
  center = 'center',
  right = 'right',
}

export type BoardTextAlign = Alignment;
export type BoardTextKind = 'inline' | 'block';

export interface BoardTextMarkNode {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface BoardTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BoardTextNode[];
  marks?: BoardTextMarkNode[];
  text?: string;
}

export interface BoardTextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  fontSize?: string;
}

export interface BoardTextLink {
  href: string;
  title?: string;
}

export interface BoardTextSelection {
  from: number;
  to: number;
  collapsed: boolean;
}

export interface BoardTextDocument {
  schemaVersion: 1;
  id: string;
  kind: BoardTextKind;
  content: BoardTextNode;
  plainText: string;
  align?: BoardTextAlign;
}

export interface BoardTextChange {
  document: BoardTextDocument;
  source: 'input' | 'composition' | 'flush' | 'readonly-exit';
  size: { width: number; height: number };
}

export interface BoardTextController {
  readonly document: BoardTextDocument;
  focus(): void;
  blur(): void;
  selectAll(): void;
  selectRange(from: number, to: number): void;
  getSelection(): BoardTextSelection | null;
  getActiveMarks(): BoardTextMarks;
  getActiveLink(): BoardTextLink | null;
  getActiveAlign?(): BoardTextAlign;
  applyMark(
    mark: keyof BoardTextMarks,
    value?: boolean | string | number,
  ): void;
  toggleMark(mark: keyof BoardTextMarks): void;
  setLink(link: BoardTextLink | null): void;
  setAlign(align: BoardTextAlign): void;
  commit(): BoardTextDocument;
  measure(): { width: number; height: number };
}

export type EditorText = {
  text: string;
} & BoardTextMarks;

export function isBoardTextDocument(
  value: unknown,
): value is BoardTextDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BoardTextDocument).schemaVersion === 1 &&
    typeof (value as BoardTextDocument).kind === 'string' &&
    typeof (value as BoardTextDocument).content === 'object'
  );
}

export const BoardTextUtils = {
  isInline(value: unknown): value is BoardTextDocument {
    return isBoardTextDocument(value) && value.kind === 'inline';
  },
  isBlock(value: unknown): value is BoardTextDocument {
    return isBoardTextDocument(value) && value.kind === 'block';
  },
  plainText(value: unknown): string {
    if (isBoardTextDocument(value)) {
      return value.plainText || '';
    }
    return '';
  },
};

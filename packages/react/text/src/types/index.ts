import {
  type TextEditorProps,
  type BoardTextDocument,
  type BoardTextController,
} from '@sue/board-common';

export type { TextEditorProps, BoardTextDocument };

export type TextComponentProps = TextEditorProps;
export type ParagraphTextProps = TextEditorProps;

export interface LineTextProps {
  element?: BoardTextDocument;
  text: BoardTextDocument;
  /** Defaults to true so existing editors still focus themselves. */
  autoFocus?: boolean;
  onChange?: (data: TextChangeData) => void;
  onSizeChange?: (size: { width: number; height: number }) => void;
  readonly?: boolean;
  placeholder?: string;
  attributes?: Record<string, string>;
  afterInit?: (editor: BoardTextController) => void;
}

export * from './document';

export interface LineTextRef {
  getSize: () => { width: number; height: number };
  measureSize: () => { width: number; height: number };
  focus: () => void;
}

export interface EditorSize {
  width?: number;
  height?: number;
}

export interface TextChangeData {
  newText: BoardTextDocument;
  oldText?: BoardTextDocument;
  width?: number;
  height?: number;
}

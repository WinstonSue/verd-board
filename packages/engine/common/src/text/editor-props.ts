import type { BoardTextController, BoardTextDocument } from './editor-types';
export interface TextEditorProps {
  text: BoardTextDocument;
  /** Defaults to the existing focus-on-mount behavior. Property fields pass false. */
  autoFocus?: boolean;
  readonly?: boolean;
  onChange?: (data: EditorTextChangeData) => void;
  afterInit?: (editor: BoardTextController) => void;
  onComposition?: (data: CompositionEvent) => void;
}
export interface EditorTextChangeData {
  newText: BoardTextDocument;
  width?: number;
  height?: number;
}

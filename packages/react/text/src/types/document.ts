import type {
  Alignment,
  BoardTextDocument,
  BoardTextMarks,
  BoardTextSelection,
} from '@sue/board-common';

export type DocumentSelection = BoardTextSelection;

/**
 * Why the document changed. The workspace uses it for history labels and to
 * keep distinct interaction kinds in separate undo groups.
 */
export type DocumentChangeSource =
  | 'input'
  | 'composition'
  | 'paste'
  | 'drop'
  | 'format'
  | 'insert'
  | 'replace'
  | 'flush';

export interface DocumentEditorChange {
  value: BoardTextDocument;
  changeId: string;
  source: DocumentChangeSource;
  /**
   * Opaque merge key for the workspace history. Consecutive changes sharing
   * the same key collapse into one undo step.
   */
  historyGroup: string;
  selectionBefore: DocumentSelection;
  selectionAfter: DocumentSelection;
}

/**
 * Workspace-provided history entry point. When present the editor disables
 * its local TipTap history and routes undo/redo through the adapter.
 */
export interface DocumentHistoryAdapter {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
}

export interface DocumentEditorProps {
  renderFrameReference?: import('../components/document/document-frame-reference').DocumentFrameReferenceRenderer;
  value: BoardTextDocument;
  readonly?: boolean;
  history?: DocumentHistoryAdapter;
  onChange(change: DocumentEditorChange): void;
  onReady?(controller: DocumentEditorController | null): void;
  /**
   * Explicit content replay (undo/redo, adopt-disk, external sync). Bumping
   * `revision` pushes `value` back into the editor without emitting a change.
   */
  restore?: {
    revision: number;
    selection?: DocumentSelection;
  };
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /**
   * Converts a picked/pasted/dropped image file into an insertable `src`
   * (usually a data URL). Returning null or rejecting cancels the insert.
   */
  onImageFile?(file: File): Promise<string | null>;
}

export type DocumentBlockKind =
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList';

export interface DocumentToolbarState {
  marks: BoardTextMarks & {
    highlight?: string;
    superscript?: boolean;
    subscript?: boolean;
  };
  block: DocumentBlockKind;
  /** Only meaningful when `block === 'heading'`. */
  headingLevel?: number;
  align: Alignment;
  link?: string;
  inTable: boolean;
  editable: boolean;
}

export type DocumentCommandName =
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'toggleStrike'
  | 'toggleCode'
  | 'toggleSuperscript'
  | 'toggleSubscript'
  | 'setParagraph'
  | 'setHeading'
  | 'toggleBlockquote'
  | 'toggleCodeBlock'
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'setTextAlign'
  | 'insertHorizontalRule'
  | 'insertTable'
  | 'addTableRowBefore'
  | 'addTableRowAfter'
  | 'addTableColumnBefore'
  | 'addTableColumnAfter'
  | 'deleteTableRow'
  | 'deleteTableColumn'
  | 'deleteTable'
  | 'toggleTableHeaderRow'
  | 'toggleTableHeaderColumn'
  | 'toggleTableHeaderCell'
  | 'clearFormatting'
  | 'undo'
  | 'redo';

export interface DocumentHeading {
  level: number;
  /** Visible text; empty when the heading has no text. */
  text: string;
  /** GitHub-compatible fragment, derived in document order; never persisted. */
  anchor: string;
  /** Runtime position inside the editor; never persisted. */
  pos: number;
}

export interface DocumentSearchMatch {
  from: number;
  to: number;
  index: number;
}

export interface DocumentSearchOptions {
  caseSensitive?: boolean;
}

/**
 * Product-facing handle for the document editor. Deliberately free of TipTap
 * types so the workspace layer stays schema-agnostic.
 */
export interface DocumentEditorController {
  focus(position?: 'start' | 'end' | 'preserve'): void;
  /** Emits any pending change and returns the current document. */
  commit(): BoardTextDocument;
  getDocument(): BoardTextDocument;
  getSelection(): DocumentSelection | null;

  toggleMark(
    mark:
      | keyof Pick<
          BoardTextMarks,
          'bold' | 'italic' | 'underline' | 'strike' | 'code'
        >
      | 'superscript'
      | 'subscript',
  ): void;
  setTextColor(color: string | null): void;
  setFontSize(size: string | null): void;
  setHighlight(color: string | null): void;
  setLink(href: string | null): void;
  clearFormatting(): void;

  setParagraph(): void;
  setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): void;
  toggleBlockquote(): void;
  toggleCodeBlock(): void;
  toggleBulletList(): void;
  toggleOrderedList(): void;
  setTextAlign(align: Alignment): void;
  insertHorizontalRule(): void;

  insertImage(image: { src: string; alt?: string; title?: string }): void;
  insertFrameReference(targetFrameId: string): void;
  insertTable(options?: {
    rows?: number;
    cols?: number;
    withHeaderRow?: boolean;
  }): void;
  addTableRow(position: 'before' | 'after'): void;
  addTableColumn(position: 'before' | 'after'): void;
  deleteTableRow(): void;
  deleteTableColumn(): void;
  deleteTable(): void;
  toggleTableHeader(kind: 'row' | 'column' | 'cell'): void;

  can(command: DocumentCommandName): boolean;
  getToolbarState(): DocumentToolbarState;
  /** Fires when toolbar-relevant state may have changed. */
  subscribe(listener: () => void): () => void;

  getHeadings(): DocumentHeading[];
  /** Scrolls a heading into view and places the caret inside it. */
  locateHeading(pos: number): void;

  find(query: string, options?: DocumentSearchOptions): DocumentSearchMatch[];
  selectMatch(match: DocumentSearchMatch): void;
  replace(match: DocumentSearchMatch, text: string): void;
  /** One transaction = one undo step. Returns the match count. */
  replaceAll(
    query: string,
    text: string,
    options?: DocumentSearchOptions,
  ): number;

  /** Non-whitespace character count for the status bar. */
  getCharacterCount(): number;

  undo(): void;
  redo(): void;
}

import type {
  Alignment,
  ActionInvocation,
  ActionResult,
  ActionState,
  BoundAction,
  BoardTextDocument,
  BoardTextMarks,
  BoardTextSelection,
} from '@sue/board-common';

export type DocumentSelection = BoardTextSelection;
export type DocumentChangeReceipt =
  | void
  | ActionResult
  | {
      ok: boolean;
      diagnostics?: readonly { message: string }[];
    };

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
  undo(): void | Promise<unknown>;
  redo(): void | Promise<unknown>;
}

export interface DocumentEditorProps {
  folding?: import('../components/document/folding-store').DocumentFoldingAdapter;
  foldingKey?: string;
  onAttachmentFile?: import('../components/document/document-resources').DocumentResourceHost['store'];
  renderAttachment?: import('../components/document/document-resources').DocumentResourceHost['renderAttachment'];
  renderWebEmbed?: import('../components/document/document-resources').DocumentResourceHost['renderWebEmbed'];
  renderFrameReference?: import('../components/document/document-frame-reference').DocumentFrameReferenceRenderer;
  value: BoardTextDocument;
  readonly?: boolean;
  history?: DocumentHistoryAdapter;
  onChange(
    change: DocumentEditorChange,
  ): DocumentChangeReceipt | Promise<DocumentChangeReceipt>;
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
  /** Formula source is searchable, but edited through its LaTeX dialog. */
  replaceable?: boolean;
}

export interface DocumentSearchOptions {
  caseSensitive?: boolean;
}

/**
 * Product-facing handle for the document editor. Deliberately free of TipTap
 * types so the workspace layer stays schema-agnostic.
 */
export interface DocumentEditorController {
  clearReveal?(): void;
  focus(position?: 'start' | 'end' | 'preserve'): void;
  commit(): BoardTextDocument;
  /** Waits for IME-safe content emission and the host's actual commit receipt. */
  flushEditing(): Promise<ActionResult>;
  getDocument(): BoardTextDocument;
  getSelection(): DocumentSelection | null;
  restoreSelection(selection: DocumentSelection): void;
  getToolbarState(): DocumentToolbarState;
  subscribe(listener: () => void): () => void;
  readonly revision: number;
  actions(): readonly BoundAction[];
  getActionState(id: string, args?: unknown): ActionState;
  executeAction(
    id: string,
    args?: unknown,
    invocation?: ActionInvocation,
  ): Promise<ActionResult>;
  getHeadings(): DocumentHeading[];
  locateHeading(pos: number): void;
  /** Reveals the zero-based direct embed occurrence in the current body. */
  locateFrameReference(targetFrameId: string, occurrence: number): boolean;
  find(query: string, options?: DocumentSearchOptions): DocumentSearchMatch[];
  selectMatch(match: DocumentSearchMatch): void;
  getCharacterCount(): number;
}
